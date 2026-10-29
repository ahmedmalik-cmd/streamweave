import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
export class Store {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(`${dir}/streamhub.sqlite`);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS moments (id TEXT PRIMARY KEY, at INTEGER NOT NULL, value TEXT NOT NULL);",
    );
  }
  settings() {
    return JSON.parse(
      this.db.prepare("SELECT value FROM kv WHERE key=?").get("settings")
        ?.value ?? '{"setup":false,"channel":""}',
    );
  }
  saveSettings(s) {
    this.db
      .prepare("INSERT OR REPLACE INTO kv VALUES (?,?)")
      .run("settings", JSON.stringify(s));
    return s;
  }
  all() {
    return this.db
      .prepare("SELECT value FROM moments ORDER BY at DESC")
      .all()
      .map((r) => JSON.parse(r.value));
  }
  get(id) {
    const r = this.db.prepare("SELECT value FROM moments WHERE id=?").get(id);
    return r ? JSON.parse(r.value) : null;
  }
  put(m) {
    this.db
      .prepare("INSERT OR REPLACE INTO moments VALUES (?,?,?)")
      .run(m.id, m.at, JSON.stringify(m));
    return m;
  }
  close() {
    this.db.close();
  }
}
