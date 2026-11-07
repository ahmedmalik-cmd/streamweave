import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../lib/store.mjs";
import { acquireLock } from "../lib/lock.mjs";
test("a second instance cannot use the same data directory", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "streamweave-lock-"));
  try {
    const release = acquireLock(dir);
    assert.throws(() => acquireLock(dir), /already running/);
    release();
    acquireLock(dir)();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("settings, review decisions and post drafts survive reopening SQLite", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "streamweave-test-"));
  try {
    let s = new Store(dir);
    s.saveSettings({ setup: true, channel: "example" });
    s.put({
      id: "first",
      at: 1,
      review: "approved",
      posts: { tiktok: { copy: "A saved caption", ready: true } },
    });
    s.close();
    s = new Store(dir);
    assert.equal(s.settings().channel, "example");
    assert.equal(s.get("first").review, "approved");
    assert.equal(s.get("first").posts.tiktok.copy, "A saved caption");
    assert.equal(s.get("missing"), null);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
