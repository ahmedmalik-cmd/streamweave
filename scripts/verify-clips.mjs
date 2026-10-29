import { findFFmpeg, run } from "../lib/video.mjs";
import { Store } from "../lib/store.mjs";
import { statSync } from "node:fs";
import path from "node:path";
const db = new Store("data"),
  ready = db.all().filter((m) => m.videoState === "ready");
if (!ready.length)
  throw new Error("No verified clips. Run a demo session first.");
for (const m of ready) {
  for (const format of ["wide", "vertical"]) {
    const file = path.resolve("data", m[format].slice(1));
    const log = await run(findFFmpeg(), ["-i", file, "-f", "null", "-"]);
    const dims = format === "wide" ? "960x540" : "1080x1920";
    if (!log.includes(dims)) throw new Error(`Expected ${dims}`);
    console.log(
      `${m.id} ${format}: ${statSync(file).size} bytes, ${dims}, decoded successfully`,
    );
  }
}
db.close();
