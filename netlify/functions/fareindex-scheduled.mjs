import { runScrape } from "../lib/fareindex-store.mjs";

export default async (request) => {
  const payload = await request.json().catch(() => ({}));
  const result = await runScrape();
  console.log("FareIndex scheduled refresh completed", {
    nextRun: payload.next_run ?? null,
    date: result.date,
    indexValue: result.indexValue,
  });
  return new Response("FareIndex refresh completed.", { status: 200 });
};

export const config = {
  schedule: "30 0 * * *",
};