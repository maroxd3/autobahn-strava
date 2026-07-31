# Privacy design

Location histories are personal data under the **GDPR**. This MVP is built to minimise what
is collected, keep it on the user's own device, and make deletion trivial.

## What is stored

- Stored **only in the browser's `localStorage`** on the user's device. Nothing is uploaded;
  there is no server in the MVP.
- Per trip: mode, detected segment id, distance, duration, average / sustained speed,
  driving-quality scores, and a **downsampled speed-over-time track**.
- **The raw GPS route (lat/lon points) is not persisted.** Once metrics are computed, only
  speed samples are kept — so the exact roads, home and destination cannot be reconstructed
  from stored data.

## Data-minimisation & anonymity

- **Nicknames, not real names.** A random nickname is generated on first run and can be changed.
- **First & last 500 m trimmed** from every trip before any metric or segment match (on by
  default), so start and end locations are obscured.
- **Segment comparison, not route sharing.** The leaderboard shows scores and speeds for a
  named Autobahn section — never a map of anyone's path.
- **Private by default.** New trips are private unless the user chooses to share them.

## User controls

- Toggle any trip between private and shared.
- Delete any single trip.
- **Delete everything** (all trips + profile) with one action in Settings.

## When a backend is added (roadmap)

A shared online leaderboard will require, in line with the GDPR:

- a clear legal basis and concise privacy information at sign-up;
- transmission of **derived metrics and the trimmed speed track only** — never the raw route;
- server-side storage limits, encryption in transit and at rest, and access controls;
- self-service export and deletion (right to erasure);
- retention limits and data minimisation by default.

## Not collected

- No video / dashcam footage.
- No contacts, no advertising identifiers.
- No continuous background tracking — recording runs only between explicit Start and Stop.
