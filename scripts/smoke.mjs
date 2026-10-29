import assert from "node:assert/strict";
const base = process.env.STREAMHUB_URL || "http://127.0.0.1:4317";
const state = await fetch(base + "/api/state").then((r) => r.json());
assert.ok(state.capabilities.ffmpeg);
const ready = state.moments.find((m) => m.videoState === "ready");
assert.ok(ready, "Run a demo capture before this check");
for (const format of ["wide", "vertical"]) {
  const r = await fetch(base + ready[format], {
    headers: { Range: "bytes=0-1023" },
  });
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 1024);
  assert.equal(r.headers.get("content-type"), "video/mp4");
}
const pack = await fetch(`${base}/api/moments/${ready.id}/package`).then((r) =>
  r.json(),
);
assert.equal(pack.mediaSource, "synthetic demo");
assert.ok(pack.posts.tiktok.copy);
assert.equal(
  (
    await fetch(base + "/api/stop", {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
    })
  ).status,
  403,
);
assert.equal(
  (await fetch(base + "/media/%2e%2e/streamhub.sqlite")).status,
  404,
);
const cancelled = state.moments.find((m) => m.videoState === "cancelled");
if (cancelled)
  assert.equal(
    (
      await fetch(`${base}/api/moments/${cancelled.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ review: "approved" }),
      })
    ).status,
    400,
  );
console.log(
  "PASS: actual clip ranges, media types, package export, origin restriction, traversal rejection, incomplete-video approval guard",
);
