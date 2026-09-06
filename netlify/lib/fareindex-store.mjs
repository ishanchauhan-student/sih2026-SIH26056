import { getStore } from "@netlify/blobs";

const STORE_NAME = "fareindex-data";
const STATE_KEY = "state";

export const routeSeed = [
  { code: "DEL-BOM", origin: "Delhi", destination: "Mumbai", weight: 0.5, baseFare: 5000 },
  { code: "BLR-DEL", origin: "Bengaluru", destination: "Delhi", weight: 0.35, baseFare: 4000 },
  { code: "BOM-GOI", origin: "Mumbai", destination: "Goa", weight: 0.15, baseFare: 3000 },
];

const factors = [
  [1, 1, 1],
  [1.018, 0.992, 1.031],
  [1.036, 1.014, 1.052],
  [1.028, 1.029, 1.071],
  [1.067, 1.051, 1.094],
  [1.081, 1.068, 1.112],
  [1.096, 1.089, 1.13],
];

const store = getStore(STORE_NAME);

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function calculateIndex(fares) {
  return routeSeed.reduce(
    (total, route, index) => total + route.weight * (fares[index] / route.baseFare),
    0,
  ) * 100;
}

function createSeedState() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  const state = {
    observations: [],
    history: [],
    nextId: 1,
    lastUpdatedAt: null,
    lastSource: "seed",
    lastError: null,
  };

  factors.forEach((dayFactors, day) => {
    const observedDate = dateOnly(new Date(start.getTime() + day * 86400000));
    const fares = routeSeed.map((route, index) => Math.round(route.baseFare * dayFactors[index]));
    fares.forEach((fare, index) => {
      state.observations.push({
        id: state.nextId++,
        ...routeSeed[index],
        fare,
        date: observedDate,
        bookingWindow: "T-30",
        isBase: day === 0,
      });
    });
    state.history.push({ date: observedDate, indexValue: calculateIndex(fares) });
  });

  return state;
}

function normalizeState(value) {
  if (!value || !Array.isArray(value.observations) || !Array.isArray(value.history)) {
    return createSeedState();
  }
  const maxId = value.observations.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  return {
    observations: value.observations,
    history: value.history,
    nextId: Math.max(Number(value.nextId) || 1, maxId + 1),
    lastUpdatedAt: value.lastUpdatedAt ?? null,
    lastSource: value.lastSource ?? "seed",
    lastError: value.lastError ?? null,
  };
}

export async function loadState() {
  const stored = await store.get(STATE_KEY, { type: "json" });
  if (stored) return normalizeState(stored);
  const seeded = createSeedState();
  await store.setJSON(STATE_KEY, seeded);
  return seeded;
}

async function saveState(state) {
  await store.setJSON(STATE_KEY, state);
}

function parseRecords(payload) {
  const source = payload?.data ?? payload?.fares ?? payload;
  if (Array.isArray(source)) return source;
  if (source && typeof source === "object") {
    return Object.entries(source).map(([route, fare]) => ({ route, fare }));
  }
  return [];
}

async function fetchLiveFares() {
  const sourceUrl = process.env.FAREINDEX_LIVE_API_URL;
  if (!sourceUrl) throw new Error("FAREINDEX_LIVE_API_URL is not configured.");

  let response;
  try {
    response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("The live airfare source could not be reached.");
  }
  if (!response.ok) throw new Error(`The live airfare source returned HTTP ${response.status}.`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The live airfare source returned invalid JSON.");
  }

  const fares = new Map(
    parseRecords(payload).flatMap((record) => {
      if (!record || typeof record !== "object") return [];
      const value = record;
      const route = String(value.route ?? value.code ?? "").trim().toUpperCase();
      const fare = Number(value.fare ?? value.price ?? value.currentFare);
      return route && Number.isFinite(fare) && fare > 0 ? [[route, fare]] : [];
    }),
  );
  const missingRoutes = routeSeed.filter((route) => !fares.has(route.code)).map((route) => route.code);
  if (missingRoutes.length > 0) {
    throw new Error(`The live airfare source is missing routes: ${missingRoutes.join(", ")}.`);
  }
  return fares;
}

export async function runScrape() {
  const state = await loadState();
  let liveFares;
  try {
    liveFares = await fetchLiveFares();
  } catch (error) {
    state.lastSource = "live";
    state.lastError = error instanceof Error ? error.message : "The live airfare source failed.";
    await saveState(state);
    throw error;
  }
  const today = dateOnly(new Date());
  const latestDate = state.history.at(-1)?.date;
  const observedDate = latestDate && latestDate > today ? latestDate : today;
  const observations = routeSeed.map((route) => ({
    id: state.nextId++,
    ...route,
    fare: Math.round(liveFares.get(route.code)),
    date: observedDate,
    bookingWindow: "T-30",
    isBase: false,
  }));

  state.observations = state.observations.filter((observation) => observation.date !== observedDate);
  state.observations.push(...observations);
  state.history = state.history.filter((point) => point.date !== observedDate);
  state.history.push({
    date: observedDate,
    indexValue: calculateIndex(observations),
  });
  state.history.sort((a, b) => a.date.localeCompare(b.date));
  state.lastUpdatedAt = new Date().toISOString();
  state.lastSource = "live";
  state.lastError = null;
  await saveState(state);

  return {
    date: observedDate,
    indexValue: Number(calculateIndex(observations).toFixed(2)),
    message: "Live route fares captured and the index was recalculated.",
    observations,
  };
}

export async function getIndex() {
  const state = await loadState();
  return state.history.map((point, index) => ({
    ...point,
    indexValue: Number(point.indexValue.toFixed(2)),
    changePercent:
      index === 0
        ? 0
        : Number(
            (((point.indexValue - state.history[index - 1].indexValue) /
              state.history[index - 1].indexValue) *
              100).toFixed(2),
          ),
    isLatest: index === state.history.length - 1,
  }));
}

export async function getRawData() {
  const state = await loadState();
  const latestDate = state.observations.at(-1)?.date;
  return state.observations.map((observation) => ({
    ...observation,
    isBase: observation.isBase || observation.fare === observation.baseFare && observation.date === latestDate,
  }));
}

export async function getHealth() {
  const state = await loadState();
  const sourceConfigured = Boolean(process.env.FAREINDEX_LIVE_API_URL);
  return {
    status: sourceConfigured && state.lastSource === "live" && !state.lastError ? "ok" : "degraded",
    sourceConfigured,
    lastUpdatedAt: state.lastUpdatedAt,
    lastSource: state.lastSource,
    lastError: state.lastError,
    lastDataDate: state.history.at(-1)?.date ?? null,
    scheduledRefresh: "daily at 00:30 UTC",
  };
}