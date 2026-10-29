import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Store } from "./lib/store.mjs";
import { Detector } from "./lib/detector.mjs";
import { DemoAdapter, TwitchAdapter } from "./lib/adapters.mjs";
import { RollingBuffer } from "./lib/video.mjs";
import { acquireLock } from "./lib/lock.mjs";
const root = path.dirname(fileURLToPath(import.meta.url)),
  data = path.join(root, "data");
const releaseLock = acquireLock(data);
process.on("exit", releaseLock);
const store = new Store(data),
  clients = new Set();
let session = { state: "stopped", mode: "demo", started: null };
let messages = [],
  metrics = {},
  history = [],
  detector = new Detector();
let health = {
  twitch: { state: "offline", detail: "Not connected" },
  youtube: { state: "offline", detail: "Demo adapter" },
  tiktok: { state: "offline", detail: "Demo adapter" },
};
const emit = (type, value) => {
  for (const c of clients) {
    if (c.writableLength > 1000000) {
      c.destroy();
      clients.delete(c);
    } else c.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
  }
};
const video = new RollingBuffer(path.join(data, "media"), (s) =>
  emit("video", s),
);
function recover() {
  video.cleanupBuffers();
  for (const m of store.all()) {
    if (["collecting", "rendering"].includes(m.videoState))
      store.put({
        ...m,
        videoState: "cancelled",
        videoError: "Capture interrupted by application restart",
      });
  }
}
const incoming = (m) => {
  messages.push(m);
  messages = messages.slice(-600);
  detector.add(m);
  emit("chat", m);
};
const demo = new DemoAdapter(incoming),
  twitch = new TwitchAdapter(incoming, (s) => {
    health.twitch = s;
    emit("health", health);
  });
const snapshot = () => ({
  session,
  settings: store.settings(),
  health,
  metrics,
  history,
  messages,
  moments: store.all(),
  video: video.state,
  capabilities: {
    ffmpeg: !!video.ffmpeg,
    streamlink:
      spawnSync("streamlink", ["--version"], {
        windowsHide: true,
        timeout: 2000,
      }).status === 0,
  },
});
function addMoment(m) {
  const id = randomUUID();
  const value = {
    ...m,
    id,
    title: `Audience spike ${new Date(m.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
    review: "pending",
    videoState: session.mode === "demo" ? "collecting" : "unavailable",
    videoError:
      session.mode === "demo"
        ? null
        : "Live Twitch video is not connected. Chat evidence only.",
    mediaSource: session.mode === "demo" ? "synthetic demo" : "none",
    posts: {
      tiktok: {
        copy: "The moment chat lost it. #streamclips #gaming",
        ready: false,
      },
      shorts: { copy: "Chat saw it coming. Did you? #Shorts", ready: false },
      reels: {
        copy: "One moment. Every audience. #streamhighlights",
        ready: false,
      },
    },
  };
  store.put(value);
  emit("moment", value);
  if (session.mode === "demo")
    video
      .clip(value, (patch) => {
        const current = store.get(id);
        if (current) {
          store.put({ ...current, ...patch });
          emit("moment", store.get(id));
        }
      })
      .catch((e) => {
        store.put({
          ...store.get(id),
          videoState: "error",
          videoError: e.message,
        });
        emit("moment", store.get(id));
      });
}
setInterval(() => {
  if (session.state !== "running") return;
  const result = detector.tick();
  const { moment, ...rest } = result;
  metrics = rest;
  history.push({ at: Date.now(), rate: rest.rate, baseline: rest.baseline });
  history = history.slice(-90);
  emit("metrics", { metrics, history });
  if (moment) addMoment(moment);
}, 1000).unref();
setInterval(() => {
  for (const c of clients) c.write(": heartbeat\n\n");
}, 15000).unref();
function stop() {
  session = { ...session, state: "stopped" };
  demo.stop();
  twitch.stop();
  video.stop();
  health.youtube = { state: "offline", detail: "Demo adapter" };
  health.tiktok = { state: "offline", detail: "Demo adapter" };
  emit("session", session);
  emit("health", health);
}
async function start(mode, channel) {
  if (session.state !== "stopped")
    throw new Error("Stop the current session first");
  if (mode !== "demo" && mode !== "twitch")
    throw new Error("Unknown source mode");
  if (mode === "twitch" && !/^[a-zA-Z0-9_]{1,25}$/.test(channel))
    throw new Error("Enter a valid Twitch channel name");
  session = { state: "starting", mode, started: Date.now() };
  emit("session", session);
  try {
    if (mode === "demo") await video.start();
    if (session.state !== "starting") return;
    messages = [];
    history = [];
    metrics = {};
    detector = new Detector();
    session = { ...session, state: "running", started: Date.now() };
    if (mode === "demo") {
      demo.start();
      for (const p of Object.keys(health))
        health[p] = { state: "demo", detail: "Simulated chat" };
    } else twitch.start(channel);
    store.saveSettings({ ...store.settings(), setup: true, channel });
    emit("health", health);
    emit("session", session);
  } catch (e) {
    stop();
    throw e;
  }
}
async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 30000) throw new Error("Request too large");
  }
  return text ? JSON.parse(text) : {};
}
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
};
function serve(req, res, base, relative) {
  const target = path.resolve(base, relative);
  if (
    !target.startsWith(path.resolve(base) + path.sep) ||
    !existsSync(target) ||
    !statSync(target).isFile()
  ) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const size = statSync(target).size,
    range = req.headers.range;
  const headers = {
    "Content-Type": mime[path.extname(target)] || "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  if (range) {
    const m = range.match(/^bytes=(\d+)-(\d*)$/);
    if (!m) {
      res.writeHead(416);
      return res.end();
    }
    const from = Number(m[1]),
      to = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (from > to || from >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...headers,
      "Content-Length": to - from + 1,
      "Content-Range": `bytes ${from}-${to}/${size}`,
    });
    createReadStream(target, { start: from, end: to }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": size });
    createReadStream(target).pipe(res);
  }
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  );
  const host = req.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host))
    return json(res, { error: "Local access only" }, 403);
  if (req.headers.origin && req.headers.origin !== `http://${host}`)
    return json(res, { error: "Origin rejected" }, 403);
  const url = new URL(req.url, `http://${host}`),
    route = url.pathname;
  try {
    if (req.method === "GET" && route === "/api/state")
      return json(res, snapshot());
    if (req.method === "GET" && route === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "POST" && route === "/api/start") {
      const b = await body(req);
      await start(b.mode, b.channel ?? "");
      return json(res, { ok: true });
    }
    if (req.method === "POST" && route === "/api/stop") {
      stop();
      return json(res, { ok: true });
    }
    if (req.method === "POST" && route === "/api/settings") {
      const b = await body(req);
      return json(
        res,
        store.saveSettings({
          ...store.settings(),
          channel: String(b.channel ?? "").slice(0, 25),
          setup: true,
        }),
      );
    }
    const match = route.match(
      /^\/api\/moments\/([a-f0-9-]+)(\/cancel|\/package)?$/,
    );
    if (match) {
      const m = store.get(match[1]);
      if (!m) return json(res, { error: "Moment not found" }, 404);
      if (req.method === "GET" && match[2] === "/package") {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="streamhub-${m.id}.json"`,
        );
        return json(res, {
          title: m.title,
          review: m.review,
          mediaSource: m.mediaSource,
          posts: m.posts,
          files: { wide: m.wide, vertical: m.vertical },
          reason: m.reason,
        });
      }
      if (req.method === "POST" && match[2] === "/cancel") {
        video.cancel(m.id);
        return json(res, { ok: true });
      }
      if (req.method === "PATCH" && !match[2]) {
        const b = await body(req);
        if (b.review !== undefined) {
          if (!["pending", "approved", "rejected"].includes(b.review))
            throw new Error("Invalid review status");
          if (b.review === "approved" && m.videoState !== "ready")
            throw new Error("Wait for verified video before approving");
          m.review = b.review;
        }
        if (b.title !== undefined) m.title = String(b.title).slice(0, 120);
        if (b.posts) {
          for (const p of ["tiktok", "shorts", "reels"])
            if (b.posts[p])
              m.posts[p] = {
                copy: String(b.posts[p].copy ?? m.posts[p].copy).slice(0, 2200),
                ready: !!b.posts[p].ready,
              };
        }
        store.put(m);
        emit("moment", m);
        return json(res, m);
      }
    }
    if (req.method === "GET" && route.startsWith("/media/")) {
      const rel = decodeURIComponent(route.slice(7));
      if (
        !/^(demo\.mp4|poster\.jpg|clips\/[a-f0-9-]+\/(wide\.mp4|vertical\.mp4|poster\.jpg))$/.test(
          rel,
        )
      )
        return json(res, { error: "Not found" }, 404);
      return serve(req, res, path.join(data, "media"), rel);
    }
    if (req.method === "GET")
      return serve(
        req,
        res,
        path.join(root, "dist"),
        route === "/" ? "index.html" : decodeURIComponent(route.slice(1)),
      );
    json(res, { error: "Not found" }, 404);
  } catch (e) {
    json(res, { error: e.message }, 400);
  }
});
const port = Number(process.env.PORT || 4317);
server.listen(port, "127.0.0.1", () => {
  recover();
  console.log(`StreamHub: http://127.0.0.1:${port}`);
});
server.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    for (const c of clients) c.end();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
