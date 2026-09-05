import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  fareindexHistoryTable,
  fareindexObservationsTable,
  fareindexRoutesTable,
} from "@workspace/db";
import {
  GetIndexResponse,
  GetRawDataResponse,
  TriggerScrapeResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ROUTES = [
  {
    code: "DEL-BOM",
    origin: "Delhi",
    destination: "Mumbai",
    weight: 0.5,
    baseFare: 5000,
  },
  {
    code: "BLR-DEL",
    origin: "Bengaluru",
    destination: "Delhi",
    weight: 0.35,
    baseFare: 4000,
  },
  {
    code: "BOM-GOI",
    origin: "Mumbai",
    destination: "Goa",
    weight: 0.15,
    baseFare: 3000,
  },
] as const;

const SEEDED_FACTORS = [
  [1, 1, 1],
  [1.018, 0.992, 1.031],
  [1.036, 1.014, 1.052],
  [1.028, 1.029, 1.071],
  [1.067, 1.051, 1.094],
  [1.081, 1.068, 1.112],
  [1.096, 1.089, 1.13],
];

const asIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (dateString: string, days: number) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return asIsoDate(date);
};

const calculateIndex = (
  fares: Array<{ weight: number; fare: number; baseFare: number }>,
) =>
  fares.reduce(
    (total, item) =>
      total + item.weight * (item.fare / item.baseFare),
    0,
  ) * 100;

let seedPromise: Promise<void> | undefined;

const ensureSeeded = () => {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const [{ routeCount }] = await db
      .select({ routeCount: count() })
      .from(fareindexRoutesTable);
    if (Number(routeCount) > 0) return;

    const routes = await db
      .insert(fareindexRoutesTable)
      .values([...ROUTES])
      .returning();

    for (let day = 0; day < SEEDED_FACTORS.length; day += 1) {
      const date = addDays(asIsoDate(new Date()), day - 6);
      const observations = routes.map((route, routeIndex) => ({
        routeId: route.id,
        fare: Math.round(route.baseFare * SEEDED_FACTORS[day][routeIndex]),
        observedDate: date,
        bookingWindow: "T-30",
      }));

      await db.insert(fareindexObservationsTable).values(observations);
      const indexValue = calculateIndex(
        routes.map((route, routeIndex) => ({
          weight: route.weight,
          baseFare: route.baseFare,
          fare: observations[routeIndex].fare,
        })),
      );
      await db
        .insert(fareindexHistoryTable)
        .values({ observedDate: date, indexValue });
    }
  })();
  seedPromise.catch(() => {
    seedPromise = undefined;
  });
  return seedPromise;
};

const fetchLiveFares = async () => {
  const sourceUrl = process.env.FAREINDEX_LIVE_API_URL;
  if (!sourceUrl) return new Map<string, number>();

  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return new Map<string, number>();
    const payload: unknown = await response.json();
    const records = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object"
        ? Object.entries(payload).map(([route, value]) => ({ route, fare: value }))
        : [];
    return new Map(
      records.flatMap((record) => {
        if (!record || typeof record !== "object") return [];
        const value = record as Record<string, unknown>;
        const route = String(value.route ?? value.code ?? "");
        const fare = Number(value.fare ?? value.price ?? value.currentFare);
        return route && Number.isFinite(fare) ? [[route, fare] as const] : [];
      }),
    );
  } catch {
    return new Map<string, number>();
  }
};

const getRawData = async () => {
  const rows = await db
    .select({
      id: fareindexObservationsTable.id,
      route: fareindexRoutesTable.code,
      origin: fareindexRoutesTable.origin,
      destination: fareindexRoutesTable.destination,
      fare: fareindexObservationsTable.fare,
      date: fareindexObservationsTable.observedDate,
      bookingWindow: fareindexObservationsTable.bookingWindow,
      baseFare: fareindexRoutesTable.baseFare,
    })
    .from(fareindexObservationsTable)
    .innerJoin(
      fareindexRoutesTable,
      eq(fareindexObservationsTable.routeId, fareindexRoutesTable.id),
    )
    .orderBy(desc(fareindexObservationsTable.observedDate), asc(fareindexObservationsTable.id));

  return rows.map((row) => ({
    id: row.id,
    route: row.route,
    origin: row.origin,
    destination: row.destination,
    fare: row.fare,
    date: row.date,
    bookingWindow: row.bookingWindow,
    isBase: row.fare === row.baseFare && row.date === rows.at(-1)?.date,
  }));
};

router.get("/index", async (req, res) => {
  await ensureSeeded();
  const history = await db
    .select()
    .from(fareindexHistoryTable)
    .orderBy(asc(fareindexHistoryTable.observedDate));

  const result = history.map((item, index) => ({
    date: item.observedDate,
    indexValue: Number(item.indexValue.toFixed(2)),
    changePercent:
      index === 0
        ? 0
        : Number(
            (
              ((item.indexValue - history[index - 1].indexValue) /
                history[index - 1].indexValue) *
              100
            ).toFixed(2),
          ),
    isLatest: index === history.length - 1,
  }));

  req.log.info({ days: result.length }, "FareIndex history read");
  res.json(GetIndexResponse.parse(result));
});

router.get("/raw-data", async (_req, res) => {
  await ensureSeeded();
  res.json(GetRawDataResponse.parse(await getRawData()));
});

router.post("/trigger-scrape", async (req, res) => {
  await ensureSeeded();

  const [latest] = await db
    .select({ observedDate: fareindexHistoryTable.observedDate })
    .from(fareindexHistoryTable)
    .orderBy(desc(fareindexHistoryTable.observedDate))
    .limit(1);
  const nextDate = addDays(latest.observedDate, 1);
  const routes = await db.select().from(fareindexRoutesTable).orderBy(asc(fareindexRoutesTable.id));
  const liveFares = await fetchLiveFares();

  const observations = routes.map((route) => {
    const fluctuation = 1 + (Math.random() * 0.1 - 0.05);
    const festivalSurge = Math.random() < 0.15 ? 1.4 : 1;
    return {
      routeId: route.id,
      fare: Math.round(
        liveFares.get(route.code) ?? route.baseFare * fluctuation * festivalSurge,
      ),
      observedDate: nextDate,
      bookingWindow: "T-30",
    };
  });

  await db.insert(fareindexObservationsTable).values(observations);
  const indexValue = calculateIndex(
    routes.map((route, index) => ({
      weight: route.weight,
      baseFare: route.baseFare,
      fare: observations[index].fare,
    })),
  );
  await db
    .insert(fareindexHistoryTable)
    .values({ observedDate: nextDate, indexValue });

  const rawData = await getRawData();
  const newObservations = rawData.filter((item) => item.date === nextDate);
  const result = {
    date: nextDate,
    indexValue: Number(indexValue.toFixed(2)),
    message:
      liveFares.size > 0
        ? "Live route fares captured and the index was recalculated."
        : "New route fares captured and the index was recalculated.",
    observations: newObservations,
  };

  req.log.info({ date: nextDate, indexValue }, "FareIndex scrape triggered");
  res.json(TriggerScrapeResponse.parse(result));
});

export default router;