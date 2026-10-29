import {
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
if (!existsSync("node_modules/lucide/dist/umd/lucide.min.js"))
  throw new Error("Run npm install first");
mkdirSync("dist", { recursive: true });
cpSync("public", "dist", { recursive: true });
cpSync("node_modules/lucide/dist/umd/lucide.min.js", "dist/lucide.js");
const files = ["index.html", "app.js", "style.css", "lucide.js"];
writeFileSync(
  "dist/manifest.json",
  JSON.stringify(
    Object.fromEntries(
      files.map((f) => [
        f,
        createHash("sha256")
          .update(readFileSync(`dist/${f}`))
          .digest("hex"),
      ]),
    ),
    null,
    2,
  ),
);
console.log("Production assets built: " + files.join(", "));
