import { TwitchAdapter } from "../lib/adapters.mjs";
const channel = process.argv[2] || "twitch";
if (!/^[a-zA-Z0-9_]{1,25}$/.test(channel)) throw new Error("Invalid channel");
let joined = false,
  count = 0;
const adapter = new TwitchAdapter(
  () => count++,
  (state) => {
    console.log(state.state, state.detail);
    if (state.state === "connected") joined = true;
  },
);
adapter.start(channel);
setTimeout(() => {
  adapter.stop();
  console.log(JSON.stringify({ joined, messages: count }));
  process.exitCode = joined ? 0 : 1;
}, 15000);
