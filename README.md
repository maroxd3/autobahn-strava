# Autobahn Strava 🛣️

**Strava for Autobahn journeys — but the winning metric is *best legal drive*, not top speed.**

Record a drive with your phone's GPS, then compare it against other people who drove the
same Autobahn section. Instead of rewarding whoever went fastest, the leaderboard rewards
**lawful, smooth and efficient** driving.

> ⚠️ This is not a racing app. Top-speed ranking on public roads is deliberately **not**
> a feature — see [Safety & the law](#safety--the-law).

---

## What it does (MVP)

- 🔴 **Start / stop trip recording** — GPS position, time, speed, accuracy, sampled continuously.
- 🗺️ **Automatic Autobahn-segment detection** — matches your drive to a known section
  (e.g. *A2 Hannover → Braunschweig*) by start/end position and direction.
- 📈 **Speed graph + trip stats** — distance, duration, average moving speed, and a
  **sustained max** (fastest rolling 5-second average, not a single GPS spike).
- 🏆 **Same-segment leaderboard** ranked by a **Legal-Drive Score**, not by top speed.
- 👤 **Anonymous nicknames** — no real names required.
- 🔒 **Privacy controls** — trips default to private, the first & last 500 m of every route
  are trimmed, the raw GPS path is never shown on the leaderboard, and any trip (or your
  whole account) can be deleted.
- 🕵️ **GPS-cheating detection** — implausible speeds, teleport jumps and junk-accuracy
  traces are flagged and excluded from ranking.
- 🏁 **Track mode** — a separate mode where top-speed / acceleration are allowed, intended
  for **closed / private tracks only**. Track results never mix with public-road leaderboards.

Everything runs **client-side in the browser** and stores data in `localStorage`, so the
MVP works with zero backend setup. A shared/online leaderboard is a documented later step.

---

## The Legal-Drive Score

A public-road drive is scored 0–100 from four components — **none of them is "who was fastest".**

| Component | Weight | Rewards |
|---|---|---|
| **Lawfulness** | 40% | Staying at/under the applicable limit; where none applies, staying near the 130 km/h *Richtgeschwindigkeit*. Exceeding a known limit is penalised hard. |
| **Smoothness** | 25% | Low jerk — gentle, steady speed changes rather than surging. |
| **Calm braking** | 20% | Few hard-braking events (strong decelerations). |
| **Efficiency** | 15% | Steady cruising speed, the fuel-friendly band. |

The leaderboard's default sort is **Legal-Drive Score ↓**. "Fastest *legal* journey" is
available as a view, but it only ranks drives that stayed within the limit.

---

## Run it

```bash
npm run serve
# → http://localhost:8123
```

Or just open `web/index.html` in a browser. On a phone, serve it over HTTPS (Geolocation
requires a secure context) — e.g. GitHub Pages or any static host.

**Recording a real drive:** press **Start before you move**, mount the phone in a holder,
and don't touch it while driving. Recording is fully automatic — see below.

---

## Safety & the law

This app is designed around German road law and the GDPR:

- **No public-road top-speed contest.** Organising or joining illegal races, and lone
  reckless driving to reach the highest possible speed, are criminal offences
  (§315d StGB). The public-road leaderboard therefore ranks *legal* driving quality only.
- **Even where no limit applies**, drivers must stay in control and adapt to traffic,
  weather, visibility and road conditions; Germany recommends **130 km/h** *Richtgeschwindigkeit*.
- **No phone-in-hand.** Start recording before departure; the app never needs to be touched
  while driving.
- **GPS speed is an estimate**, not a police-grade or legally certified measurement — the
  true speed can change between location updates.
- **Privacy by design (GDPR):** nicknames instead of names, private-by-default trips,
  first/last 500 m trimmed, no raw route on the leaderboard, one-tap trip & account deletion,
  no video/dashcam recording.

See [`SAFETY.md`](SAFETY.md) and [`PRIVACY.md`](PRIVACY.md) for detail.

---

## Project layout

```
web/
  index.html        app shell (Record / Trips / Leaderboard / Settings)
  css/app.css       styles
  js/
    segments.js     known Autobahn sections + segment detection
    geo.js          GPS recording, haversine, speed & sustained-max maths
    score.js        Legal-Drive Score + hard-braking / smoothness / cheating checks
    store.js        localStorage persistence, privacy trimming, seeded demo ghosts
    app.js          UI wiring
scripts/serve.js    tiny static server for local preview
```

## Roadmap

- Shared online leaderboard (backend) with server-side cheat validation.
- Optional **OBD-II** connection for higher accuracy and anti-fraud.
- Weather / traffic condition tags per trip.
- Vehicle categories.

## License

MIT — see [`LICENSE`](LICENSE).
