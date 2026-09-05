import { readFile, writeFile } from "node:fs/promises";

const templatePath = new URL("../index.template.html", import.meta.url);
const outputPath = new URL("../index.html", import.meta.url);
const template = await readFile(templatePath, "utf8");
const entrypoint = [
  "<scr",
  'ipt type="module" src="/src/main.tsx">',
  "</scr",
  "ipt>",
].join("");

if (!template.includes("<!-- FAREINDEX_ENTRYPOINT -->")) {
  throw new Error("FareIndex HTML template is missing its entrypoint marker.");
}

await writeFile(
  outputPath,
  template.replace("<!-- FAREINDEX_ENTRYPOINT -->", entrypoint),
);