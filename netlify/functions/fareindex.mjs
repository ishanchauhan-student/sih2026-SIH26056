import {
  getHealth,
  getIndex,
  getRawData,
  runScrape,
} from "../lib/fareindex-store.mjs";

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

function getPath(event) {
  const requestPath = event.rawUrl
    ? new URL(event.rawUrl).pathname
    : event.path || "/";
  return requestPath.includes("/api/")
    ? requestPath.slice(requestPath.indexOf("/api") + 4)
    : requestPath.replace(/^.*?\/fareindex/, "") || "/";
}

export async function handler(event) {
  const path = getPath(event);
  if (event.httpMethod === "OPTIONS") return json({}, 204);
  if (path === "/healthz" && event.httpMethod === "GET") return json(await getHealth());
  if (path === "/index" && event.httpMethod === "GET") return json(await getIndex());
  if (path === "/raw-data" && event.httpMethod === "GET") return json(await getRawData());
  if (path === "/trigger-scrape" && event.httpMethod === "POST") {
    try {
      return json(await runScrape());
    } catch (error) {
      return json(
        {
          error: "Live source unavailable",
          message: error instanceof Error ? error.message : "The live airfare source failed.",
        },
        503,
      );
    }
  }
  return json({ error: "Not found" }, 404);
}