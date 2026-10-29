import { randomUUID } from "node:crypto";
export function parseIRC(line, now = Date.now()) {
  const match = line.match(/^(?:@([^ ]+) )?:([^! ]+)!.* PRIVMSG #[^ ]+ :(.*)$/);
  if (!match) return null;
  const tags = Object.fromEntries(
    (match[1] ?? "").split(";").map((s) => s.split("=")),
  );
  return {
    id: tags.id || randomUUID(),
    at: now,
    platform: "twitch",
    user: tags["display-name"] || match[2],
    text: match[3],
    badge: (tags.badges ?? "").includes("moderator") ? "mod" : "",
    demo: false,
  };
}
export class TwitchAdapter {
  constructor(onMessage, onHealth) {
    this.onMessage = onMessage;
    this.onHealth = onHealth;
    this.stopped = true;
    this.attempt = 0;
  }
  start(channel) {
    this.stop();
    this.channel = channel;
    this.stopped = false;
    this.connect();
  }
  connect() {
    if (this.stopped) return;
    this.onHealth({
      state: "connecting",
      detail: `#${this.channel} · anonymous read-only`,
    });
    const ws = (this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443"));
    const watchdog = setTimeout(() => ws.close(), 15000);
    ws.onopen = () => {
      if (this.stopped || this.ws !== ws) return ws.close();
      ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(Math.random() * 900000 + 100000)}`);
      ws.send(`JOIN #${this.channel}`);
    };
    ws.onmessage = (e) => {
      if (this.stopped || this.ws !== ws) return;
      for (const line of String(e.data).split("\r\n")) {
        if (line.startsWith("PING")) ws.send(line.replace("PING", "PONG"));
        if (line.includes(" JOIN ") || line.includes(" ROOMSTATE ")) {
          clearTimeout(watchdog);
          this.attempt = 0;
          this.onHealth({
            state: "connected",
            detail: `#${this.channel} · read-only`,
          });
        }
        const m = parseIRC(line);
        if (m) this.onMessage(m);
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      clearTimeout(watchdog);
      if (this.stopped || this.ws !== ws) return;
      const delay = Math.min(30000, 2000 * 2 ** Math.min(this.attempt++, 4));
      this.onHealth({
        state: "retrying",
        detail: `Connection unavailable; retry in ${delay / 1000}s`,
      });
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.onHealth({ state: "offline", detail: "Not connected" });
  }
}
const names = [
  "nora",
  "pixelpilot",
  "jules",
  "lowkey",
  "mika",
  "orbit",
  "eli",
  "cass",
  "fern",
  "retrocam",
  "sam",
  "ash",
];
const normal = [
  "that timing was clean",
  "what a view",
  "audio sounds good",
  "watch the left side",
  "new route today?",
  "this run is looking good",
  "settling in for the stream",
  "love this section",
];
const hype = [
  "NO WAY that worked",
  "CLUTCH!",
  "clip it right now",
  "OMG the timing",
  "lets go!",
  "that was insane",
  "Pog what a finish",
  "WOW",
];
export class DemoAdapter {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.serial = 0;
  }
  start() {
    this.stop();
    this.startAt = Date.now();
    this.timer = setInterval(() => {
      const seconds = (Date.now() - this.startAt) / 1000;
      const spike = seconds % 100 >= 38 && seconds % 100 < 46;
      this.emit(spike ? 5 : 1, spike);
    }, 1000);
  }
  emit(count, spike) {
    for (let i = 0; i < count; i++) {
      const n = this.serial++;
      this.onMessage({
        id: randomUUID(),
        at: Date.now(),
        platform: ["twitch", "youtube", "tiktok"][n % 3],
        user: names[n % names.length],
        text: (spike ? hype : normal)[
          n % (spike ? hype.length : normal.length)
        ],
        badge: n % 17 === 0 ? "mod" : "",
        demo: true,
      });
    }
  }
  stop() {
    clearInterval(this.timer);
  }
}
