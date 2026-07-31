// Persistence, privacy trimming, and a seeded demo leaderboard.
//
// Storage is entirely local (localStorage) for the MVP — no data leaves the
// device. A shared online leaderboard is a documented later step.

(function (global) {
  "use strict";

  const KEY_TRIPS = "as_trips";
  const KEY_PROFILE = "as_profile";
  const H = global.Segments.haversine;

  // ---- Profile --------------------------------------------------------------

  function getProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY_PROFILE) || "null");
      if (p && p.nickname) return p;
    } catch (e) {}
    const fresh = { nickname: randomNickname(), trimEnds: true, defaultPrivate: true };
    localStorage.setItem(KEY_PROFILE, JSON.stringify(fresh));
    return fresh;
  }

  function saveProfile(p) {
    localStorage.setItem(KEY_PROFILE, JSON.stringify(p));
    return p;
  }

  function randomNickname() {
    const a = ["Ruhig", "Sanft", "Stetig", "Cruise", "Eco", "Gelassen", "Smooth", "Vernünftig"];
    const b = ["Falke", "Biber", "Luchs", "Otter", "Igel", "Dachs", "Reh", "Specht"];
    const n = 10 + Math.floor(Math.random() * 89);
    return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)] + n;
  }

  // ---- Privacy trimming -----------------------------------------------------

  // Drop the first and last `metres` of the route so home / destination aren't
  // exposed. Returns a new sample array (never mutates the input).
  function trimEnds(samples, metres) {
    metres = metres || 500;
    if (samples.length < 4) return samples.slice();

    // Trim from the start.
    let startIdx = 0;
    let acc = 0;
    for (let i = 1; i < samples.length; i++) {
      acc += H(samples[i - 1], samples[i]);
      if (acc >= metres) {
        startIdx = i;
        break;
      }
    }
    // Trim from the end.
    let endIdx = samples.length - 1;
    acc = 0;
    for (let i = samples.length - 1; i > 0; i--) {
      acc += H(samples[i - 1], samples[i]);
      if (acc >= metres) {
        endIdx = i;
        break;
      }
    }
    if (endIdx <= startIdx) return samples.slice(); // trip too short to trim safely
    return samples.slice(startIdx, endIdx + 1);
  }

  // ---- Trips ----------------------------------------------------------------

  function getTrips() {
    try {
      return JSON.parse(localStorage.getItem(KEY_TRIPS) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveTrip(trip) {
    const trips = getTrips();
    trips.unshift(trip);
    localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
    return trip;
  }

  function deleteTrip(id) {
    const trips = getTrips().filter((t) => t.id !== id);
    localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
  }

  function setTripPrivacy(id, isPrivate) {
    const trips = getTrips();
    const t = trips.find((x) => x.id === id);
    if (t) {
      t.private = isPrivate;
      localStorage.setItem(KEY_TRIPS, JSON.stringify(trips));
    }
  }

  function deleteAll() {
    localStorage.removeItem(KEY_TRIPS);
    localStorage.removeItem(KEY_PROFILE);
  }

  function newId() {
    return "t_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- Seeded demo ghosts (so the leaderboard isn't empty on first run) ------
  // These are clearly-labelled synthetic entries, not real people.
  const DEMO = [
    { segmentId: "a2-hannover-braunschweig", nickname: "GelassenOtter42", score: 94, avgKmh: 118, sustainedKmh: 129, hardBraking: 0, mode: "public", demo: true },
    { segmentId: "a2-hannover-braunschweig", nickname: "EcoDachs17", score: 88, avgKmh: 112, sustainedKmh: 126, hardBraking: 1, mode: "public", demo: true },
    { segmentId: "a2-hannover-braunschweig", nickname: "SmoothReh63", score: 81, avgKmh: 124, sustainedKmh: 138, hardBraking: 2, mode: "public", demo: true },
    { segmentId: "a2-braunschweig-hannover", nickname: "RuhigFalke28", score: 90, avgKmh: 116, sustainedKmh: 131, hardBraking: 0, mode: "public", demo: true },
    { segmentId: "a7-hannover-hildesheim", nickname: "StetigLuchs55", score: 86, avgKmh: 109, sustainedKmh: 124, hardBraking: 1, mode: "public", demo: true },
    { segmentId: "a81-stuttgart-heilbronn", nickname: "VernünftigIgel11", score: 92, avgKmh: 108, sustainedKmh: 119, hardBraking: 0, mode: "public", demo: true },
  ];

  // Leaderboard for a segment: demo ghosts + this device's own eligible trips.
  // `sort`: "score" (default) or "legalSpeed" (fastest, limited to lawful drives).
  function leaderboard(segmentId, sort) {
    sort = sort || "score";
    const seg = global.Segments.byId(segmentId);

    const mine = getTrips()
      .filter((t) => t.segmentId === segmentId && t.mode === "public" && !t.private && t.eligible)
      .map((t) => ({
        id: t.id,
        segmentId: t.segmentId,
        nickname: t.nickname,
        score: t.score.total,
        avgKmh: Math.round(t.avgKmh),
        sustainedKmh: Math.round(t.sustainedKmh),
        hardBraking: t.score.hardBrakingEvents,
        mode: "public",
        mine: true,
      }));

    let rows = DEMO.filter((d) => d.segmentId === segmentId).concat(mine);

    if (sort === "legalSpeed") {
      // "Fastest LEGAL journey": only lawful drives, ranked by sustained speed.
      const lawful = seg && seg.limitKmh;
      rows = rows.filter((r) => (lawful ? r.sustainedKmh <= seg.limitKmh + 3 : true) && r.score >= 70);
      rows.sort((a, b) => b.sustainedKmh - a.sustainedKmh);
    } else {
      rows.sort((a, b) => b.score - a.score);
    }
    return rows;
  }

  global.Store = {
    getProfile,
    saveProfile,
    randomNickname,
    trimEnds,
    getTrips,
    saveTrip,
    deleteTrip,
    setTripPrivacy,
    deleteAll,
    newId,
    leaderboard,
  };
})(typeof window !== "undefined" ? window : globalThis);
