# Safety & legal design

Autobahn Strava is built so that it **cannot** function as a public-road racing app.
This document records the decisions that keep it on the right side of German road law and
road safety.

## 1. No public-road top-speed contest

Ranking public-road drives by "who was fastest" would encourage competition on live
traffic. Under **§ 315d StGB**, organising or participating in illegal motor-vehicle races
is a criminal offence — and so is driving alone, grossly against traffic rules and
recklessly, in order to reach the highest possible speed. A "who hit the highest km/h"
leaderboard could push drivers toward exactly that.

**Design response:** the public-road leaderboard's ranking metric is the **Legal-Drive
Score** (lawfulness, smoothness, calm braking, efficiency). Instantaneous top speed is
displayed for a driver's own trip but is **never** the ranking key, and the "fastest
journey" view is restricted to *legal* drives only.

## 2. Duty of control, even where no limit applies

On unrestricted Autobahn stretches there is still no right to "drive as fast as possible".
Drivers must keep control and adapt speed to traffic, visibility, weather, road condition
and personal ability. Germany also publishes a **130 km/h Richtgeschwindigkeit** (advisory
speed) where no lower limit applies.

**Design response:** where a segment has no fixed limit, the lawfulness component gently
rewards staying near 130 km/h and the trip's speed chart draws a 130 km/h reference line.
Going faster is discouraged in scoring, not celebrated.

## 3. Dynamic limits are uncertain

Many Autobahn stretches use variable electronic signs. The app cannot know with certainty
which limit was displayed at a given moment.

**Design response:** speeds carry a small tolerance; the app never presents a result as a
legal determination and never issues "you broke the law" verdicts — only relative scores.
Where a segment carries a known posted limit, overspeed is penalised; where limits are
dynamic/unknown, the softer Richtgeschwindigkeit guidance is used instead.

## 4. No phone-in-hand operation

A driver may not hold or actively operate a phone while driving; a mounted phone may only
get a brief, traffic-appropriate glance.

**Design response:** recording is designed to be **started before departure** and to run
fully automatically — no interaction is needed while moving. The record screen shows a
standing reminder to start before moving and mount the device.

## 5. Track mode is separated

Top-speed and acceleration are legitimate on **closed / private tracks**.

**Design response:** a distinct **Track mode** exists for that purpose. Track results are
labelled as such and are **never** mixed into public-road leaderboards.

## 6. GPS is an estimate

Location speed is informational: the true speed can change between location updates.

**Design response:** every speed in the UI is labelled a GPS estimate, not a police-grade
or legally certified measurement.

## 7. No dashcam by default

Continuous recording of surrounding vehicles, licence plates and people raises dashcam and
data-protection problems, including the risk of extensive permanent surveillance.

**Design response:** the app records **no video**. Only the driver's own GPS trace is used,
and even that is trimmed and never published as a raw route (see [`PRIVACY.md`](PRIVACY.md)).
