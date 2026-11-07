<img src="public/logo.svg" width="96" alt="Streamweave logo: three strands braided together">

# Streamweave

**One dashboard for streamers who go live on several platforms at once.** Every chat lands in one feed, a detector watches that feed for the moments worth clipping, and each moment is cut from a rolling video buffer and turned into a post draft for TikTok, YouTube Shorts and Instagram Reels.

A working prototype by **Ahmed Jamal Malik**. Node 24, no framework, one runtime dependency (the icon set).

## Why

Multistreamers juggle three chats, and the audience on the platform they're not watching drifts off. The same unified feed is also the best clip signal there is: a real moment shows up as a spike in chat (more messages, more people, more "CLIP IT"), and it arrives a few seconds *after* the moment itself. A tool that already merges every chat can see a moment that erupts across three audiences at once, which a single-platform clipper can't.

## What's real and what's simulated

| | |
|---|---|
| Twitch chat | **Real.** Anonymous IRC, any live channel, no API key |
| YouTube and TikTok chat | Simulated audiences behind the same adapter interface |
| Moment detector | **Real**, running on the unified feed, plus a Mark clip button for calling a moment by hand |
| Rolling video buffer and clip cutting | **Real** FFmpeg: 4-second segments, each clip cut from 30 s before the spike to 12 s after |
| Video source | A generated test pattern for now; connecting your actual stream output is the next step |
| Post packages | Title, caption and per-platform drafts are saved; posting to the platforms isn't wired up |

## How it works

```
Twitch IRC ─┐
demo feeds ─┼─► unified feed ─► detector ─► moment ─► clip from the video buffer ─► review ─► post drafts
            │       │                                       ▲
            │       └─► dashboard (Server-Sent Events)       FFmpeg segments (4 s)
```

- **Server:** `node:http` with Server-Sent Events pushing chat, metrics and moments to the browser (`server.mjs`).
- **Detector** (`lib/detector.mjs`): a 10-second sliding window against a baseline chat rate. A moment fires when the rate is at least 2.4× the baseline, with at least 8 messages from at least 4 different chatters and a hype density of 25% or more ("pog", "clutch", "clip it", 🔥 and so on). There's a 30-second warm-up and a 60-second cooldown, so one spammer or ordinary fast chat doesn't trigger it.
- **Storage** (`lib/store.mjs`): SQLite through Node's built-in `node:sqlite` (`kv` and `moments` tables) for settings, moments, review decisions and drafts.
- **Video** (`lib/video.mjs`): FFmpeg writes a rolling buffer of `.ts` segments; a clip is cut from the window around each moment and only marked ready once the file has been verified.
- **Remote view** (optional, `scripts/remote.mjs`): a password-protected proxy on `127.0.0.1:4318`. The credentials are generated on first run into `data/remote-access.json`. It only listens locally, so put a tunnel in front of it if you want to check in from your phone.

### Detection notes

The baseline is a slow, time-adjusted moving average of chat velocity, and it nearly freezes (its rate drops from 0.04 to 0.004) while velocity is above 1.6× baseline. Without that, a fast chat absorbs the spike into its own baseline before the ratio can cross the trigger, which showed up when testing against a busy live Twitch chat. The unique-chatter minimum and the hype-density requirement mean a raid of identical spam from one account can't fire it.

### Next

1. Real YouTube and TikTok adapters (YouTube Data API live chat; TikTok Live).
2. Recording the streamer's own output (from OBS) instead of the test pattern. An earlier build pulled the live Twitch stream with streamlink.
3. Posting through the TikTok, YouTube and Instagram APIs, behind the existing review step.
4. Burned-in captions: transcribe each clip and style the subtitles.
5. Twitch login, so replies can go out to every chat at once (an earlier build had this), then the same for the other platforms.
6. Moderation across platforms: one ban or timeout everywhere.

## Run it

Needs [Node.js 24+](https://nodejs.org) and [FFmpeg](https://ffmpeg.org) on your `PATH` (or set `FFMPEG_PATH`).

```bash
npm install
npm run build      # copies public/ and the icon set into dist/
npm start          # http://127.0.0.1:4317
```

On Windows, `start.ps1` does the same. Start a session in demo mode and the simulated audiences erupt for a few seconds every 100 seconds, enough to watch the detector fire and a clip get cut; enter a live Twitch channel to see real chat.

```bash
npm test                                  # detector, storage and video-pipeline tests (also run on every push)
node scripts/check-twitch.mjs <channel>   # check that a live Twitch channel's chat comes through
node scripts/remote.mjs                   # optional password-protected remote view
```

Everything the app writes (database, video buffers, clips, credentials) goes into `data/`, which is git-ignored.

---

Code under the [MIT License](LICENSE).
