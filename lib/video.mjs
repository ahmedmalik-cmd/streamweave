import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  statSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import path from "node:path";
export function findFFmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "ffmpeg",
  ].filter(Boolean);
  return (
    candidates.find(
      (p) =>
        spawnSync(p, ["-version"], { windowsHide: true, timeout: 5000 })
          .status === 0,
    ) || null
  );
}
export function run(bin, args, { signal, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const p = spawn(bin, args, { windowsHide: true, signal });
    p.stderr?.on("data", (b) => (stderr = (stderr + b).slice(-6000)));
    const t = setTimeout(() => p.kill(), timeout);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0
        ? resolve(stderr)
        : reject(
            new Error(
              signal?.aborted
                ? "Cancelled"
                : `FFmpeg exited ${code}: ${stderr.slice(-1200)}`,
            ),
          );
    });
  });
}
export class RollingBuffer {
  constructor(root, onState, { ffmpeg = findFFmpeg() } = {}) {
    this.root = root;
    this.onState = onState;
    this.ffmpeg = ffmpeg;
    this.active = false;
    this.jobs = new Map();
    this.state = { state: "idle", detail: "No source running", seconds: 0 };
    mkdirSync(root, { recursive: true });
  }
  cleanupBuffers() {
    const root = this.root;
    // Only generated rolling-buffer directories are disposable; retain clip outputs.
    for (const name of readdirSync(root))
      if (/^buffer-\d+$/.test(name)) {
        const target = path.resolve(root, name);
        if (target.startsWith(path.resolve(root) + path.sep))
          rmSync(target, { recursive: true, force: true });
      }
  }
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }
  async prepare(signal) {
    if (!this.ffmpeg)
      throw new Error("FFmpeg was not found. Set FFMPEG_PATH and restart.");
    const demo = path.join(this.root, "demo.mp4");
    if (!existsSync(demo)) {
      this.set({
        state: "preparing",
        detail: "Generating local motion test source",
      });
      const temp = path.join(this.root, "demo.part.mp4");
      await run(
        this.ffmpeg,
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=960x540:rate=24",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=220:sample_rate=44100",
          "-t",
          "48",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "24",
          "-pix_fmt",
          "yuv420p",
          "-g",
          "96",
          "-c:a",
          "aac",
          "-b:a",
          "64k",
          "-movflags",
          "+faststart",
          temp,
        ],
        { signal },
      );
      const { renameSync } = await import("node:fs");
      renameSync(temp, demo);
    }
    const poster = path.join(this.root, "poster.jpg");
    if (!existsSync(poster))
      await run(
        this.ffmpeg,
        ["-y", "-ss", "12", "-i", demo, "-frames:v", "1", poster],
        { signal },
      );
    return demo;
  }
  async start() {
    if (this.active) throw new Error("Video source already active");
    this.active = true;
    this.controller = new AbortController();
    try {
      const source = await this.prepare(this.controller.signal);
      if (!this.active) return;
      this.dir = path.join(this.root, `buffer-${Date.now()}`);
      mkdirSync(this.dir, { recursive: true });
      this.started = Date.now();
      const proc = (this.proc = spawn(
        this.ffmpeg,
        [
          "-y",
          "-re",
          "-stream_loop",
          "-1",
          "-i",
          source,
          "-c",
          "copy",
          "-f",
          "segment",
          "-segment_time",
          "4",
          "-reset_timestamps",
          "1",
          path.join(this.dir, "%06d.ts"),
        ],
        { windowsHide: true },
      ));
      let error = "";
      proc.stderr.on("data", (b) => (error = (error + b).slice(-1000)));
      proc.on("error", (e) => {
        if (this.proc !== proc) return;
        this.active = false;
        this.set({ state: "error", detail: e.message });
      });
      proc.on("close", () => {
        if (this.proc !== proc) return;
        clearInterval(this.interval);
        if (this.active) {
          this.active = false;
          this.set({ state: "error", detail: error || "Video source stopped" });
        }
      });
      this.set({
        state: "buffering",
        detail: "Synthetic motion source · 4s segments",
        seconds: 0,
      });
      this.interval = setInterval(() => {
        const files = this.segments();
        const latest = files.at(-1)?.index ?? 0;
        for (const f of files)
          if (f.index < latest - 60)
            try {
              unlinkSync(f.path);
            } catch {}
        this.set({ seconds: Math.min(240, files.length * 4) });
      }, 2000);
    } catch (e) {
      this.active = false;
      this.set({
        state: this.controller.signal.aborted ? "idle" : "error",
        detail: e.message,
      });
      throw e;
    }
  }
  segments() {
    if (!this.dir) return [];
    return readdirSync(this.dir)
      .filter((f) => /^\d+\.ts$/.test(f))
      .sort()
      .slice(0, -1)
      .map((f) => ({
        path: path.join(this.dir, f),
        index: Number(f.slice(0, 6)),
      }));
  }
  async clip(moment, onUpdate) {
    if (!this.active) throw new Error("Video source is not running");
    const control = new AbortController();
    this.jobs.set(moment.id, control);
    const signal = control.signal;
    const start = this.started,
      dir = this.dir;
    try {
      onUpdate({ videoState: "collecting", videoError: null });
      const wait = Math.max(0, moment.at + 16000 - Date.now());
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, wait);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new Error("Cancelled"));
          },
          { once: true },
        );
      });
      if (dir !== this.dir) throw new Error("Source changed during capture");
      const from = Math.max(0, (moment.at - 30000 - start) / 1000),
        to = (moment.at + 12000 - start) / 1000;
      const segments = this.segments().filter(
        (f) => f.index * 4 < to && (f.index + 1) * 4 > from,
      );
      if (!segments.length)
        throw new Error("No completed video segments available");
      onUpdate({ videoState: "rendering" });
      const out = path.join(this.root, "clips", moment.id);
      mkdirSync(out, { recursive: true });
      const list = path.join(out, "input.txt");
      writeFileSync(
        list,
        segments
          .map(
            (f) =>
              `file '${f.path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`,
          )
          .join("\n"),
      );
      const wide = path.join(out, "wide.mp4"),
        vertical = path.join(out, "vertical.mp4");
      const duration = Math.min(to, (segments.at(-1).index + 1) * 4) - from;
      await run(
        this.ffmpeg,
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-ss",
          String(Math.max(0, from - segments[0].index * 4)),
          "-t",
          String(duration),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-threads",
          "2",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          wide,
        ],
        { signal },
      );
      await run(
        this.ffmpeg,
        [
          "-y",
          "-i",
          wide,
          "-vf",
          "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "25",
          "-threads",
          "2",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          vertical,
        ],
        { signal },
      );
      for (const file of [wide, vertical]) {
        if (!existsSync(file) || statSync(file).size < 1024)
          throw new Error("Output file is missing or empty");
        await run(
          this.ffmpeg,
          ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
          {
            signal,
          },
        );
      }
      await run(
        this.ffmpeg,
        [
          "-y",
          "-ss",
          "2",
          "-i",
          wide,
          "-frames:v",
          "1",
          path.join(out, "poster.jpg"),
        ],
        { signal },
      );
      onUpdate({
        videoState: "ready",
        duration: Math.round(duration),
        wide: `/media/clips/${moment.id}/wide.mp4`,
        vertical: `/media/clips/${moment.id}/vertical.mp4`,
        poster: `/media/clips/${moment.id}/poster.jpg`,
        videoError: null,
      });
    } catch (e) {
      onUpdate({
        videoState: signal.aborted ? "cancelled" : "error",
        videoError: e.message,
      });
    } finally {
      this.jobs.delete(moment.id);
    }
  }
  cancel(id) {
    this.jobs.get(id)?.abort();
  }
  stop() {
    this.active = false;
    this.controller?.abort();
    clearInterval(this.interval);
    this.proc?.kill();
    for (const c of this.jobs.values()) c.abort();
    this.set({ state: "idle", detail: "Source stopped", seconds: 0 });
  }
}
