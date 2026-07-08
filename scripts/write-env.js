import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const apiBaseUrl = process.env.PUBLIC_API_BASE_URL || "";
const target = join(__dirname, "..", "public", "env.js");

await writeFile(
  target,
  `window.INSTALL_QUEUE_CONFIG = ${JSON.stringify({ apiBaseUrl }, null, 2)};\n`
);

console.log(`Wrote public/env.js with apiBaseUrl=${apiBaseUrl || "(same origin)"}`);
