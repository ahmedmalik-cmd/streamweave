import http from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(path.join(root, "data"), { recursive: true });
const file = path.join(root, "data", "remote-access.json");
if (!existsSync(file))
  writeFileSync(
    file,
    JSON.stringify({
      username: "streamweave",
      password: randomBytes(18).toString("base64url"),
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
const credentials = JSON.parse(readFileSync(file, "utf8"));
const expected =
  "Basic " +
  Buffer.from(`${credentials.username}:${credentials.password}`).toString(
    "base64",
  );
const digest = (s) => createHash("sha256").update(s).digest();
http
  .createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !timingSafeEqual(
        digest(req.headers.authorization || ""),
        digest(expected),
      )
    ) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Streamweave private preview"',
      });
      return res.end("Sign in to Streamweave.");
    }
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          throw new Error();
      } catch {
        res.writeHead(403);
        return res.end("Origin rejected");
      }
    }
    if (!req.url.startsWith("/") || req.url.startsWith("//")) {
      res.writeHead(400);
      return res.end();
    }
    const headers = { ...req.headers, host: "127.0.0.1:4317" };
    delete headers.authorization;
    delete headers["forwarded"];
    delete headers["x-forwarded-host"];
    if (headers.origin) headers.origin = "http://127.0.0.1:4317";
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: 4317,
        path: req.url,
        method: req.method,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode, {
          ...response.headers,
          "cache-control": "no-store",
        });
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("Streamweave is not running.");
    });
    upstream.setTimeout(210000, () => upstream.destroy());
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  })
  .listen(4318, "127.0.0.1", () =>
    console.log("Password-protected Streamweave proxy: 127.0.0.1:4318"),
  );
