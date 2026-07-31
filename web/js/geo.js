// GPS recording + trip maths.
//
// A recorder wraps navigator.geolocation.watchPosition and accumulates samples.
// Each sample: { t (ms), lat, lon, acc (m), spd (m/s or null), src }.
// Speed prefers the GPS-reported value; when the device doesn't supply one we
// derive it from consecutive positions. All speeds here are ESTIMATES.

(function (global) {
  "use strict";

  const H = global.Segments.haversine;
  const MS_TO_KMH = 3.6;

  function Recorder(onSample) {
    this.samples = [];
    this.watchId = null;
    this.onSample = onSample || function () {};
  }

  Recorder.prototype.start = function () {
    if (!("geolocation" in navigator)) throw new Error("Geolocation not supported on this device.");
    this.samples = [];
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._push(pos),
      (err) => this.onSample({ error: err.message || String(err) }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return this;
  };

  Recorder.prototype._push = function (pos) {
    const c = pos.coords;
    const prev = this.samples[this.samples.length - 1];
    let spd = typeof c.speed === "number" && c.speed >= 0 ? c.speed : null;
    let src = spd !== null ? "gps" : "derived";
    if (spd === null && prev) {
      const dt = (pos.timestamp - prev.t) / 1000;
      if (dt > 0) {
        const d = H({ lat: prev.lat, lon: prev.lon }, { lat: c.latitude, lon: c.longitude });
        spd = d / dt;
      }
    }
    const s = {
      t: pos.timestamp,
      lat: c.latitude,
      lon: c.longitude,
      acc: typeof c.accuracy === "number" ? c.accuracy : null,
      spd: spd === null ? 0 : spd,
      src,
    };
    this.samples.push(s);
    this.onSample({ sample: s, count: this.samples.length });
  };

  Recorder.prototype.stop = function () {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    return this.samples.slice();
  };

  // ---- Derived trip metrics from a list of samples --------------------------

  // Cumulative distance (m) along the sample path.
  function totalDistance(samples) {
    let d = 0;
    for (let i = 1; i < samples.length; i++) {
      d += H(samples[i - 1], samples[i]);
    }
    return d;
  }

  // Duration in seconds between first and last sample.
  function durationSec(samples) {
    if (samples.length < 2) return 0;
    return (samples[samples.length - 1].t - samples[0].t) / 1000;
  }

  // Average MOVING speed (km/h): ignores samples below a small threshold so
  // stops at junctions don't drag the average down.
  function avgMovingKmh(samples) {
    const MOVING = 3 / MS_TO_KMH; // ~3 km/h
    let dist = 0;
    let time = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000;
      if (dt <= 0) continue;
      const seg = H(samples[i - 1], samples[i]);
      const v = seg / dt;
      if (v >= MOVING) {
        dist += seg;
        time += dt;
      }
    }
    return time > 0 ? (dist / time) * MS_TO_KMH : 0;
  }

  // Sustained max (km/h): fastest rolling window of about `windowSec` seconds,
  // using distance/time over the window rather than a single GPS spike. Robust
  // to coarse sampling — if the sample spacing is wider than the window, it
  // falls back to the honest speed over a single interval.
  function sustainedMaxKmh(samples, windowSec) {
    windowSec = windowSec || 5;
    if (samples.length < 2) return 0;
    let best = 0;
    for (let hi = 1; hi < samples.length; hi++) {
      // Expand the window back to ~windowSec, but always keep at least one interval.
      let lo = hi - 1;
      while (lo > 0 && (samples[hi].t - samples[lo - 1].t) / 1000 <= windowSec) lo--;
      const dt = (samples[hi].t - samples[lo].t) / 1000;
      if (dt <= 0) continue;
      let d = 0;
      for (let k = lo + 1; k <= hi; k++) d += H(samples[k - 1], samples[k]);
      const v = (d / dt) * MS_TO_KMH;
      if (v > best) best = v;
    }
    return best;
  }

  // Instantaneous peak (km/h) from reported/derived per-sample speed. Kept for
  // display and cheat checks — deliberately NOT used for ranking.
  function peakKmh(samples) {
    let m = 0;
    for (const s of samples) if (s.spd * MS_TO_KMH > m) m = s.spd * MS_TO_KMH;
    return m;
  }

  // Median GPS accuracy (m), a quality indicator.
  function medianAccuracy(samples) {
    const accs = samples.map((s) => s.acc).filter((a) => typeof a === "number").sort((a, b) => a - b);
    if (!accs.length) return null;
    return accs[Math.floor(accs.length / 2)];
  }

  global.Geo = {
    Recorder,
    totalDistance,
    durationSec,
    avgMovingKmh,
    sustainedMaxKmh,
    peakKmh,
    medianAccuracy,
    MS_TO_KMH,
  };
})(typeof window !== "undefined" ? window : globalThis);
