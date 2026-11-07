import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
export function acquireLock(dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "server.lock");
  const claim = () => writeFileSync(file, String(process.pid), { flag: "wx" });
  try {
    claim();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(readFileSync(file, "utf8"));
    let alive = false;
    if (Number.isInteger(pid) && pid > 0)
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (error) {
        alive = error.code !== "ESRCH";
      }
    if (alive)
      throw new Error(
        `Streamweave is already running (PID ${pid}). Open the existing server.`,
      );
    unlinkSync(file);
    claim();
  }
  return () => {
    try {
      if (readFileSync(file, "utf8") === String(process.pid)) unlinkSync(file);
    } catch {}
  };
}
