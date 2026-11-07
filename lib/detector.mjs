export const defaults = {
  windowMs: 10000,
  warmupMs: 30000,
  cooldownMs: 60000,
  minMessages: 8,
  minUsers: 4,
  ratio: 2.4,
  hype: 0.25,
};
export const isHype = (text) =>
  /\b(lol|lmao|wow|omg|pog|poggers|lets go|let's go|insane|clutch|no way|clip it|wild|hype)\b|[🔥😂🤯]/i.test(
    text,
  );
export class Detector {
  constructor(start = Date.now(), config = {}) {
    this.config = { ...defaults, ...config };
    this.start = start;
    this.messages = [];
    this.baseline = null;
    this.lastTrigger = -Infinity;
    this.lastTick = start;
  }
  add(message) {
    this.messages.push(message);
  }
  // The streamer calling a moment by hand: no thresholds, and the cooldown stops an instant repeat.
  mark(now = Date.now()) {
    this.lastTrigger = now;
    const chats = this.messages.filter(
      (m) => m.at > now - this.config.windowMs && m.at <= now,
    );
    return {
      at: now,
      score: 100,
      title: `Marked moment ${new Date(now).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`,
      reason: "Marked by hand",
      chats: chats.slice(-80),
      metrics: {},
      source: "manual",
    };
  }
  tick(now = Date.now()) {
    const c = this.config;
    this.messages = this.messages.filter(
      (m) => m.at > now - c.windowMs && m.at <= now,
    );
    const count = this.messages.length,
      users = new Set(this.messages.map((m) => `${m.platform}:${m.user}`)).size;
    const density = count
      ? this.messages.filter((m) => isHype(m.text)).length / count
      : 0;
    const rate = count / (c.windowMs / 1000);
    if (this.baseline === null && now - this.start >= c.windowMs)
      this.baseline = Math.max(rate, 0.1);
    const baseline = this.baseline ?? Math.max(rate, 0.1),
      ratio = rate / Math.max(baseline, 0.1);
    const warmup = Math.max(
      0,
      Math.ceil((c.warmupMs - (now - this.start)) / 1000),
    );
    const cooldown = Math.max(
      0,
      Math.ceil((c.cooldownMs - (now - this.lastTrigger)) / 1000),
    );
    let moment = null;
    if (
      !warmup &&
      !cooldown &&
      count >= c.minMessages &&
      users >= c.minUsers &&
      ratio >= c.ratio &&
      density >= c.hype
    ) {
      this.lastTrigger = now;
      moment = {
        at: now,
        score: Math.min(
          100,
          Math.round(
            35 + Math.min(ratio, 6) * 7 + density * 20 + Math.min(users, 20),
          ),
        ),
        reason: `${ratio.toFixed(1)}x baseline · ${Math.round(density * 100)}% hype · ${users} unique chatters`,
        chats: this.messages.slice(-80),
        metrics: { count, users, density, ratio, baseline },
        source: "chat spike",
      };
    }
    // Time-adjusted EMA prevents tick frequency from changing detector sensitivity.
    if (this.baseline !== null) {
      const alpha = ratio > 1.6 ? 0.004 : 0.04;
      this.baseline +=
        (rate - this.baseline) *
        (1 - Math.pow(1 - alpha, Math.max(0, now - this.lastTick) / 1000));
    }
    this.lastTick = now;
    return {
      count,
      users,
      density,
      ratio,
      baseline,
      rate,
      warmup,
      cooldown: moment ? 60 : cooldown,
      moment,
    };
  }
}
