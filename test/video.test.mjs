import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { RollingBuffer } from "../lib/video.mjs";
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "streamweave-video-"));
  return { root, clean: () => rmSync(root, { recursive: true, force: true }) };
}
test("missing FFmpeg leaves an actionable error, not a starting state", async () => {
  const f = fixture();
  try {
    const video = new RollingBuffer(f.root, () => {}, { ffmpeg: null });
    await assert.rejects(video.start(), /FFmpeg was not found/);
    assert.equal(video.active, false);
    assert.equal(video.state.state, "error");
  } finally {
    f.clean();
  }
});
test("cancel during collection terminates the job without output claims", async () => {
  const f = fixture();
  try {
    const states = [],
      video = new RollingBuffer(f.root, () => {}, { ffmpeg: null });
    video.active = true;
    video.started = Date.now() - 40000;
    video.dir = f.root;
    const job = video.clip({ id: "test", at: Date.now() }, (s) =>
      states.push(s),
    );
    video.cancel("test");
    await job;
    assert.deepEqual(
      states.map((s) => s.videoState),
      ["collecting", "cancelled"],
    );
    assert.equal(video.jobs.size, 0);
  } finally {
    f.clean();
  }
});
test("no completed segments produces an error, never Ready", async () => {
  const f = fixture();
  try {
    const states = [],
      video = new RollingBuffer(f.root, () => {}, { ffmpeg: null });
    video.active = true;
    video.started = Date.now() - 60000;
    video.dir = f.root;
    await video.clip({ id: "test", at: Date.now() - 20000 }, (s) =>
      states.push(s),
    );
    assert.equal(states.at(-1).videoState, "error");
    assert.match(states.at(-1).videoError, /No completed video segments/);
  } finally {
    f.clean();
  }
});
test("startup discards old generated buffers but retains clip files", () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.root, "buffer-123"));
    mkdirSync(path.join(f.root, "clips"));
    writeFileSync(path.join(f.root, "clips", "keep.mp4"), "fixture");
    new RollingBuffer(f.root, () => {}, { ffmpeg: null }).cleanupBuffers();
    assert.equal(existsSync(path.join(f.root, "buffer-123")), false);
    assert.equal(existsSync(path.join(f.root, "clips", "keep.mp4")), true);
  } finally {
    f.clean();
  }
});
