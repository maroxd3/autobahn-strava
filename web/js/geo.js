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

  // True inside the Capacitor shell, false in a browser or an installed PWA.
  function isNative() {
    const C = global.Capacitor;
    return !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  }

  function nativePlugin() {
    const C = global.Capacitor;
    return (C && C.Plugins && C.Plugins.BackgroundGeolocation) || null;
  }

  Recorder.prototype.start = function () {
    this.samples = [];
    // The browser API stops the moment the screen locks or the user switches
    // apps, which is precisely when a drive is being recorded. Inside the native
    // shell, use the background watcher so a locked phone in a mount keeps
    // recording — this is the reason the app is wrapped natively at all.
    return isNative() && nativePlugin() ? this._startNative() : this._startWeb();
  };

  Recorder.prototype._startWeb = function () {
    if (!("geolocation" in navigator)) throw new Error("Geolocation not supported on this device.");
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._push(pos),
      (err) => this.onSample({ error: err.message || String(err) }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return this;
  };

  Recorder.prototype._startNative = function () {
    const plugin = nativePlugin();
    this.native = plugin;
    plugin
      .addWatcher(
        {
          // Shown in the Android notification and the iOS location indicator.
          backgroundMessage: "Fahrt wird aufgezeichnet.",
          backgroundTitle: "Autobahn Strava",
          requestPermissions: true,
          stale: false,
          distanceFilter: 10,
        },
        (location, error) => {
          if (error) {
            // The user can deny "always" permission and still grant it later, so
            // surface it rather than silently recording nothing.
            this.onSample({ error: error.message || String(error.code || error) });
            return;
          }
          if (!location) return;
          // Normalise the plugin's shape into the browser Position shape so
          // _push stays the single place that builds a sample.
          this._push({
            timestamp: location.time || Date.now(),
            coords: {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              speed: typeof location.speed === "number" ? location.speed : null,
            },
          });
        }
      )
      .then((id) => {
        this.watchId = id;
      })
      .catch((e) => this.onSample({ error: e.message || String(e) }));
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
    if (this.watchId !== null) {
      if (this.native) this.native.removeWatcher({ id: this.watchId }).catch(() => {});
      else navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
    this.native = null;
    return this.samples.slice();
  };

  // Exposed so the UI can tell the user whether a locked screen will keep
  // recording, instead of letting them find out after a ruined drive.
  Recorder.backgroundCapable = () => isNative() && !!nativePlugin();

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
