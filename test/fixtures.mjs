import { Detector } from "../lib/detector.mjs";
export const fixtures = {
  "normal traffic": {
    expected: 0,
    count: (t) => 1,
    user: (t, i) => `u${t % 10}`,
    text: () => "hello",
  },
  "one-user spam": {
    expected: 0,
    count: (t) => (t > 35 ? 8 : 1),
    user: () => "spammer",
    text: () => "OMG",
  },
  "sustained fast chat": {
    expected: 0,
    count: () => 8,
    user: (t, i) => `u${i}`,
    text: () => "OMG",
  },
  "genuine multi-user spike": {
    expected: 1,
    count: (t) => (t > 38 && t < 47 ? 6 : 1),
    user: (t, i) => `u${(t + i) % 20}`,
    text: (t) => (t > 38 && t < 47 ? "clip it OMG" : "hello"),
  },
};
export function replay(f) {
  const d = new Detector(0),
    hits = [];
  for (let t = 1; t <= 95; t++) {
    for (let i = 0; i < f.count(t); i++)
      d.add({
        at: t * 1000,
        user: f.user(t, i),
        platform: "twitch",
        text: f.text(t),
      });
    const m = d.tick(t * 1000).moment;
    if (m) hits.push(m);
  }
  return hits;
}
