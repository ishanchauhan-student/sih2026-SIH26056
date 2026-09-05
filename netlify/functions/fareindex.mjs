const routeSeed = [
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

const state = globalThis.__fareIndexState ??= {
  observations: [],
  history: [],
  nextId: 1,
};

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function calculateIndex(fares) {
  return routeSeed.reduce((total, route, index) => (
    total + route.weight * (fares[index] / route.baseFare)
  ), 0) * 100;
}

function ensureSeeded() {
  if (state.history.length > 0) return;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
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
}

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}

async function fetchLiveFares() {
  if (!process.env.FAREINDEX_LIVE_API_URL) return new Map();
  try {
    const response = await fetch(process.env.FAREINDEX_LIVE_API_URL, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return new Map();
    const payload = await response.json();
    const records = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object"
        ? Object.entries(payload).map(([route, fare]) => ({ route, fare }))
        : [];
    return new Map(records.flatMap((record) => {
      if (!record || typeof record !== "object") return [];
      const route = String(record.route ?? record.code ?? "");
      const fare = Number(record.fare ?? record.price ?? record.currentFare);
      return route && Number.isFinite(fare) ? [[route, fare]] : [];
    }));
  } catch {
    return new Map();
  }
}

export async function handler(event) {
  ensureSeeded();
  const requestPath = event.rawUrl
    ? new URL(event.rawUrl).pathname
    : event.path || "/";
  const path = requestPath.includes("/api/")
    ? requestPath.slice(requestPath.indexOf("/api") + 4)
    : requestPath.replace(/^.*?\/fareindex/, "") || "/";
  if (event.httpMethod === "OPTIONS") return json({}, 204);
  if (path === "/healthz") return json({ status: "ok" });
  if (path === "/index" && event.httpMethod === "GET") {
    return json(state.history.map((point, index) => ({
      ...point,
      indexValue: Number(point.indexValue.toFixed(2)),
      changePercent: index === 0 ? 0 : Number((((point.indexValue - state.history[index - 1].indexValue) / state.history[index - 1].indexValue) * 100).toFixed(2)),
      isLatest: index === state.history.length - 1,
    })));
  }
  if (path === "/raw-data" && event.httpMethod === "GET") return json(state.observations);
  if (path === "/trigger-scrape" && event.httpMethod === "POST") {
    const nextDate = shiftDate(state.history.at(-1).date, 1);
    const liveFares = await fetchLiveFares();
    const observations = routeSeed.map((route) => {
      const festivalSurge = Math.random() < 0.15 ? 1.4 : 1;
      const fare = Math.round(liveFares.get(route.code) ?? route.baseFare * (1 + Math.random() * 0.1 - 0.05) * festivalSurge);
      return { id: state.nextId++, ...route, fare, date: nextDate, bookingWindow: "T-30", isBase: false };
    });
    const indexValue = calculateIndex(observations.map((observation) => observation.fare));
    state.observations.push(...observations);
    state.history.push({ date: nextDate, indexValue });
    return json({
      date: nextDate,
      indexValue: Number(indexValue.toFixed(2)),
      message: liveFares.size > 0
        ? "Live route fares captured and the index was recalculated."
        : "New route fares captured and the index was recalculated.",
      observations,
    });
  }
  return json({ error: "Not found" }, 404);
}