import { test } from "node:test";
import assert from "node:assert/strict";
import { Detector } from "../lib/detector.mjs";
import { parseIRC } from "../lib/adapters.mjs";
import { fixtures, replay } from "./fixtures.mjs";
for (const [name, fixture] of Object.entries(fixtures))
  test(name, () => {
    const result = replay(fixture);
    assert.equal(result.length, fixture.expected);
    if (result.length) {
      assert.ok(result[0].score >= 60);
      assert.ok(result[0].chats.length >= 8);
    }
  });
test("cooldown blocks duplicate moments", () => {
  const d = new Detector(0);
  let hits = 0;
  for (let t = 1000; t <= 80000; t += 1000) {
    for (let i = 0; i < (t > 35000 ? 6 : 1); i++)
      d.add({
        at: t,
        user: `u${i}`,
        platform: "twitch",
        text: t > 35000 ? "OMG" : "hello",
      });
    if (d.tick(t).moment) hits++;
  }
  assert.equal(hits, 1);
});
test("IRC metadata and untrusted text are preserved as data", () => {
  const m = parseIRC(
    "@id=abc;display-name=Nora;badges=moderator/1 :nora!nora@nora.tmi.twitch.tv PRIVMSG #demo :<script> hi",
    100,
  );
  assert.equal(m.user, "Nora");
  assert.equal(m.badge, "mod");
  assert.equal(m.text, "<script> hi");
  assert.equal(parseIRC("PING :tmi.twitch.tv"), null);
});
