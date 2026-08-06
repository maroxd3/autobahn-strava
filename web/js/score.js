// Legal-Drive scoring, driving-quality events, and GPS-cheat detection.
//
// The public-road score deliberately does NOT reward top speed. It rewards
// staying lawful, driving smoothly, braking calmly and cruising efficiently.

(function (global) {
  "use strict";

  const MS_TO_KMH = global.Geo.MS_TO_KMH;
  const RICHTGESCHWINDIGKEIT = 130; // km/h advisory where no fixed limit applies

  // Per-sample speed (km/h) and per-interval acceleration (m/s^2).
  function kinematics(samples) {
    const speeds = samples.map((s) => s.spd * MS_TO_KMH);
    const accels = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000;
      if (dt <= 0) {
        accels.push(0);
        continue;
      }
      const dv = samples[i].spd - samples[i - 1].spd; // m/s
      accels.push(dv / dt);
    }
    return { speeds, accels };
  }

  // Hard-braking events: decelerations stronger than `threshold` m/s^2.
  // ~ -3.0 m/s^2 is a firm brake; we count sustained onsets, not every sample.
  function hardBrakingEvents(samples, threshold) {
    threshold = threshold || -3.0;
    const { accels } = kinematics(samples);
    let count = 0;
    let inEvent = false;
    for (const a of accels) {
      if (a <= threshold) {
        if (!inEvent) {
          count++;
          inEvent = true;
        }
      } else if (a > threshold * 0.5) {
        inEvent = false;
      }
    }
    return count;
  }

  // Smoothness 0..100 from jerk (rate of change of acceleration). Lower jerk
  // variance → higher score.
  function smoothnessScore(samples) {
    const { accels } = kinematics(samples);
    if (accels.length < 2) return 100;
    const jerks = [];
    for (let i = 1; i < accels.length; i++) jerks.push(Math.abs(accels[i] - accels[i - 1]));
    const mean = jerks.reduce((a, b) => a + b, 0) / jerks.length;
    // Map mean jerk (m/s^3) to a score: 0 → 100, ~2.5 → ~0.
    return clamp(100 - (mean / 2.5) * 100, 0, 100);
  }

  // Efficiency 0..100: rewards steady cruising (low speed variance), the
  // fuel-friendly pattern. Judged over CRUISE phases only (> 30 km/h): traffic
  // lights, jams and junction stops are the road's fault, not the driver's, and
  // must not tank the score. Returns null when there is too little cruising to
  // judge — the composite then redistributes the weight.
  function efficiencyScore(samples) {
    const { speeds } = kinematics(samples);
    const cruise = speeds.filter((v) => v > 30);
    if (cruise.length < 20) return null;
    const mean = cruise.reduce((a, b) => a + b, 0) / cruise.length;
    const variance = cruise.reduce((a, b) => a + (b - mean) ** 2, 0) / cruise.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1; // coefficient of variation
    return clamp(100 - cv * 180, 0, 100);
  }

  // Lawfulness 0..100. If the segment carries a known limit, penalise time spent
  // over it (hard). Where no fixed limit applies, gently reward staying near the
  // 130 km/h Richtgeschwindigkeit — overspeed here is discouraged, not illegal.
  function lawfulnessScore(samples, limitKmh) {
    const { speeds } = kinematics(samples);
    const moving = speeds.filter((v) => v > 5);
    if (!moving.length) return 100;

    if (limitKmh) {
      const over = moving.filter((v) => v > limitKmh + 3); // 3 km/h GPS tolerance
      const fracOver = over.length / moving.length;
      const avgExcess = over.length
        ? over.reduce((a, v) => a + (v - limitKmh), 0) / over.length
        : 0;
      // Being over at all costs a lot; being far over costs more.
      return clamp(100 - fracOver * 120 - avgExcess * 1.5, 0, 100);
    }

    // No fixed limit: soft guidance toward Richtgeschwindigkeit.
    const above = moving.filter((v) => v > RICHTGESCHWINDIGKEIT);
    const fracAbove = above.length / moving.length;
    const avgAbove = above.length
      ? above.reduce((a, v) => a + (v - RICHTGESCHWINDIGKEIT), 0) / above.length
      : 0;
    return clamp(100 - fracAbove * 25 - avgAbove * 0.4, 0, 100);
  }

  // Composite Legal-Drive Score.
  function legalDriveScore(samples, segment) {
    const limit = segment ? segment.limitKmh : null;
    const law = lawfulnessScore(samples, limit);
    const smooth = smoothnessScore(samples);
    const braking = hardBrakingEvents(samples);
    const eff = efficiencyScore(samples);

    // Braking → sub-score: 0 events = 100, degrade per event.
    const brakingScore = clamp(100 - braking * 12, 0, 100);

    // Too little cruising to judge efficiency (pure city hops): drop the
    // component and renormalise the remaining weights instead of guessing.
    const total =
      eff === null
        ? (law * 0.4 + smooth * 0.25 + brakingScore * 0.2) / 0.85
        : law * 0.4 + smooth * 0.25 + brakingScore * 0.2 + eff * 0.15;

    return {
      total: Math.round(total),
      components: {
        lawfulness: Math.round(law),
        smoothness: Math.round(smooth),
        calmBraking: Math.round(brakingScore),
        efficiency: eff === null ? null : Math.round(eff),
      },
      hardBrakingEvents: braking,
    };
  }

  // GPS-cheat detection. Returns { ok, flags[] }. A flagged trip is kept but
  // excluded from ranking.
  function cheatCheck(samples, metrics) {
    const flags = [];
    if (samples.length < 8) flags.push("too-few-gps-samples");

    const peak = metrics.peakKmh;
    if (peak > 300) flags.push("implausible-peak-speed");

    // Teleport: any interval implying > 400 km/h is physically impossible.
    const H = global.Segments.haversine;
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000;
      if (dt <= 0) continue;
      const v = (H(samples[i - 1], samples[i]) / dt) * MS_TO_KMH;
      if (v > 400) {
        flags.push("teleport-jump");
        break;
      }
    }

    // Junk accuracy throughout → untrustworthy.
    if (metrics.medianAccuracy !== null && metrics.medianAccuracy > 60) {
      flags.push("poor-gps-accuracy");
    }

    // Suspiciously constant speed (e.g. a replayed/faked track) — near-zero
    // variance over a long moving trip.
    const { speeds } = kinematics(samples);
    const moving = speeds.filter((v) => v > 20);
    if (moving.length > 30) {
      const mean = moving.reduce((a, b) => a + b, 0) / moving.length;
      const varc = moving.reduce((a, b) => a + (b - mean) ** 2, 0) / moving.length;
      if (varc < 0.5) flags.push("unnaturally-constant-speed");
    }

    return { ok: flags.length === 0, flags };
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  global.Score = {
    legalDriveScore,
    hardBrakingEvents,
    smoothnessScore,
    efficiencyScore,
    lawfulnessScore,
    cheatCheck,
    RICHTGESCHWINDIGKEIT,
  };
})(typeof window !== "undefined" ? window : globalThis);
