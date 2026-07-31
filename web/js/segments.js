// Known Autobahn sections and segment detection.
//
// A "segment" is a directed stretch between two junctions. A recorded trip is
// matched to a segment when its (privacy-trimmed) start is near the segment's
// start, its end is near the segment's end, and its length is roughly right.
// Coordinates are approximate junction locations — good enough for MVP matching.

(function (global) {
  "use strict";

  const SEGMENTS = [
    {
      id: "a2-hannover-braunschweig",
      autobahn: "A2",
      name: "Hannover → Braunschweig",
      from: { name: "Kreuz Hannover-Ost", lat: 52.3897, lon: 9.8471 },
      to: { name: "Kreuz Braunschweig-Nord", lat: 52.3167, lon: 10.5045 },
      // Distance-free stretch of the A2 in this direction (no fixed general limit
      // over most of it). Where a dynamic sign shows a limit, that limit applies.
      limitKmh: null, // null = no fixed general limit → Richtgeschwindigkeit 130 applies
    },
    {
      id: "a2-braunschweig-hannover",
      autobahn: "A2",
      name: "Braunschweig → Hannover",
      from: { name: "Kreuz Braunschweig-Nord", lat: 52.3167, lon: 10.5045 },
      to: { name: "Kreuz Hannover-Ost", lat: 52.3897, lon: 9.8471 },
      limitKmh: null,
    },
    {
      id: "a7-hannover-hildesheim",
      autobahn: "A7",
      name: "Hannover → Hildesheim",
      from: { name: "Kreuz Hannover-Süd", lat: 52.2861, lon: 9.8079 },
      to: { name: "Dreieck Hildesheim", lat: 52.1361, lon: 9.9846 },
      limitKmh: null,
    },
    {
      id: "a9-nuernberg-ingolstadt",
      autobahn: "A9",
      name: "Nürnberg → Ingolstadt",
      from: { name: "Kreuz Nürnberg", lat: 49.4, lon: 11.09 },
      to: { name: "Kreuz Ingolstadt-Nord", lat: 48.8167, lon: 11.45 },
      limitKmh: null,
    },
    {
      id: "a7-b3-hannover-celle",
      autobahn: "A7/B3",
      name: "Hannover → Celle",
      from: { name: "AS Hannover-Kirchhorst (A7)", lat: 52.44, lon: 9.88 },
      to: { name: "Celle Süd", lat: 52.6, lon: 10.06 },
      // Mixed route: a short A7 stretch, then the B3 north to Celle. The B3 is a
      // Bundesstraße — 100 km/h general limit outside built-up areas — so we score
      // the whole segment against the stricter 100 rather than treating it as
      // derestricted Autobahn. Erring strict is the safe default on a mixed route.
      limitKmh: 100,
    },
    {
      id: "b3-a7-celle-hannover",
      autobahn: "B3/A7",
      name: "Celle → Hannover",
      from: { name: "Celle Süd", lat: 52.6, lon: 10.06 },
      to: { name: "AS Hannover-Kirchhorst (A7)", lat: 52.44, lon: 9.88 },
      limitKmh: 100,
    },
    {
      id: "a81-stuttgart-heilbronn",
      autobahn: "A81",
      name: "Stuttgart → Heilbronn",
      from: { name: "Kreuz Stuttgart", lat: 48.8667, lon: 9.15 },
      to: { name: "Weinsberg", lat: 49.15, lon: 9.28 },
      limitKmh: 120, // stretches here carry a posted limit
    },
  ];

  // Haversine distance in metres.
  function haversine(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Match a trip (array of {lat, lon}) to the best segment, or null.
  // START_RADIUS / END_RADIUS give tolerance around junction points.
  function detectSegment(points, opts) {
    opts = opts || {};
    const startRadius = opts.startRadius || 6000; // metres
    const endRadius = opts.endRadius || 6000;
    if (!points || points.length < 2) return null;

    const start = points[0];
    const end = points[points.length - 1];

    let best = null;
    for (const seg of SEGMENTS) {
      const dStart = haversine(start, seg.from);
      const dEnd = haversine(end, seg.to);
      if (dStart <= startRadius && dEnd <= endRadius) {
        const cost = dStart + dEnd;
        if (!best || cost < best.cost) best = { segment: seg, cost };
      }
    }
    return best ? best.segment : null;
  }

  function byId(id) {
    return SEGMENTS.find((s) => s.id === id) || null;
  }

  global.Segments = { list: SEGMENTS, haversine, detectSegment, byId };
})(typeof window !== "undefined" ? window : globalThis);
