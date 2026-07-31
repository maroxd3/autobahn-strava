// Ghost Replay — race a recorded drive against the segment leader.
//
// The point of this screen is to make the app's thesis visible instead of
// argued: the aggressive driver surges, stalls and brakes hard, the calm driver
// holds a line — and they arrive within a minute of each other. That gap is the
// whole case for driving calmly, and a number in a table never sells it.
//
// It runs purely off the stored speed track (time + km/h). No coordinates are
// used or needed, so nothing here can expose a route.

(function (global) {
  "use strict";

  const MS_TO_KMH = 3.6;

  // Cumulative distance (metres) at each sample of a {t, v} track.
  function distanceCurve(track) {
    const out = [{ t: 0, d: 0, v: track.length ? track[0].v : 0 }];
    for (let i = 1; i < track.length; i++) {
      const dt = track[i].t - track[i - 1].t;
      const vAvg = (track[i].v + track[i - 1].v) / 2 / MS_TO_KMH; // m/s
      out.push({ t: track[i].t, d: out[i - 1].d + vAvg * dt, v: track[i].v });
    }
    return out;
  }

  // Distance and speed at an arbitrary time, linearly interpolated.
  function sampleAt(curve, t) {
    if (!curve.length) return { d: 0, v: 0 };
    if (t <= curve[0].t) return { d: curve[0].d, v: curve[0].v };
    const last = curve[curve.length - 1];
    if (t >= last.t) return { d: last.d, v: last.v };
    let lo = 0, hi = curve.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (curve[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = curve[lo], b = curve[hi];
    const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    return { d: a.d + (b.d - a.d) * f, v: a.v + (b.v - a.v) * f };
  }

  // Times (in track seconds) where the driver braked hard, for the red flashes.
  function brakePoints(track, threshold) {
    threshold = threshold || -3.0;
    const out = [];
    for (let i = 1; i < track.length; i++) {
      const dt = track[i].t - track[i - 1].t;
      if (dt <= 0) continue;
      const a = (track[i].v - track[i - 1].v) / MS_TO_KMH / dt;
      if (a <= threshold) out.push(track[i].t);
    }
    return out;
  }

  // A plausible speed track for a leaderboard entry that has only summary stats
  // (the seeded demo ghosts). Deterministic from the entry itself, so the same
  // ghost always drives the same way. Clearly synthetic — these rows are labelled
  // as demo everywhere they appear.
  function syntheticTrack(entry, durationSec) {
    const avg = entry.avgKmh;
    const peak = entry.sustainedKmh;
    const brakes = entry.hardBraking || 0;
    const dt = 2;
    const n = Math.max(8, Math.round(durationSec / dt));
    // Seed the wobble from the nickname so it is stable across reloads.
    let seed = 0;
    for (const ch of String(entry.nickname)) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    const track = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      let v = avg + (peak - avg) * Math.sin(f * Math.PI * 1.3 + (seed % 7) * 0.4) * 0.8;
      // Each hard brake becomes a sharp dip, spaced through the drive.
      for (let b = 0; b < brakes; b++) {
        const at = (b + 1) / (brakes + 1);
        const near = Math.abs(f - at);
        if (near < 0.03) v -= 45 * (1 - near / 0.03);
      }
      if (f < 0.04) v = 30 + f * 1500;
      if (f > 0.96) v = 30 + (1 - f) * 1500;
      track.push({ t: i * dt, v: Math.max(6, Math.round(v)) });
    }
    return track;
  }

  // ---- Rendering ------------------------------------------------------------

  function drawFrame(ctx, W, H, state) {
    const { you, rival, t, finished } = state;
    ctx.clearRect(0, 0, W, H);

    const padX = 46;
    const laneW = W - padX * 2;
    const lanes = [H * 0.36, H * 0.68];

    // Road strips.
    for (const y of lanes) {
      ctx.fillStyle = "#1b1f27";
      ctx.fillRect(padX, y - 15, laneW, 30);
      ctx.strokeStyle = "#2c333f";
      ctx.setLineDash([9, 11]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + laneW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Finish line.
    ctx.strokeStyle = "#57606f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX + laneW, lanes[0] - 22);
    ctx.lineTo(padX + laneW, lanes[1] + 22);
    ctx.stroke();

    const runners = [
      { r: you, y: lanes[0], color: "#ffd21e", label: "Du" },
      { r: rival, y: lanes[1], color: "#3ea6ff", label: rival.label },
    ];

    for (const { r, y, color, label } of runners) {
      const p = Math.min(1, r.progress);
      const x = padX + laneW * p;

      // Trail.
      const grad = ctx.createLinearGradient(padX, 0, x, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, color + "55");
      ctx.fillStyle = grad;
      ctx.fillRect(padX, y - 6, Math.max(0, x - padX), 12);

      // Hard brake flash.
      if (r.braking) {
        ctx.fillStyle = "rgba(255,71,87,0.85)";
        ctx.beginPath();
        ctx.arc(x, y, 19, 0, Math.PI * 2);
        ctx.fill();
      }

      // Car.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();

      // Labels.
      ctx.fillStyle = "#e8ecf3";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, padX, y - 24);
      ctx.textAlign = "right";
      ctx.fillStyle = r.braking ? "#ff4757" : "#9aa4b2";
      ctx.fillText(Math.round(r.v) + " km/h", padX + laneW, y - 24);
    }

    // Clock.
    ctx.fillStyle = "#9aa4b2";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    ctx.fillText(`${mm}:${String(ss).padStart(2, "0")}`, W / 2, 20);

    if (finished) {
      ctx.fillStyle = "#e8ecf3";
      ctx.font = "700 14px system-ui, sans-serif";
      ctx.fillText("Ziel", W / 2, H - 6);
    }
  }

  // Animate the race. Returns a stop() handle so callers can cancel cleanly.
  function race(canvas, opts) {
    const yourTrack = opts.yourTrack || [];
    const rivalTrack = opts.rivalTrack || [];
    const onEnd = opts.onEnd || function () {};
    const speedUp = opts.speedUp || 60; // 60x real time

    const cy = distanceCurve(yourTrack);
    const cr = distanceCurve(rivalTrack);
    const yourTotal = cy.length ? cy[cy.length - 1].d : 1;
    const rivalTotal = cr.length ? cr[cr.length - 1].d : 1;
    const yourEnd = cy.length ? cy[cy.length - 1].t : 0;
    const rivalEnd = cr.length ? cr[cr.length - 1].t : 0;
    const yourBrakes = brakePoints(yourTrack);
    const rivalBrakes = brakePoints(rivalTrack);

    const ctx = canvas.getContext("2d");
    const dpr = global.devicePixelRatio || 1;
    const W = canvas.clientWidth || 320;
    const H = 150;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + "px";
    ctx.scale(dpr, dpr);

    const nearBrake = (list, t) => list.some((bt) => Math.abs(bt - t) < 1.2);
    const total = Math.max(yourEnd, rivalEnd);
    let raf = null;
    let startWall = null;
    let stopped = false;

    function step(now) {
      if (stopped) return;
      if (startWall === null) startWall = now;
      const t = ((now - startWall) / 1000) * speedUp;
      const clamped = Math.min(t, total);

      const sy = sampleAt(cy, clamped);
      const sr = sampleAt(cr, clamped);
      drawFrame(ctx, W, H, {
        t: clamped,
        finished: t >= total,
        you: {
          progress: yourTotal ? sy.d / yourTotal : 0,
          v: clamped >= yourEnd ? 0 : sy.v,
          braking: nearBrake(yourBrakes, clamped),
        },
        rival: {
          progress: rivalTotal ? sr.d / rivalTotal : 0,
          v: clamped >= rivalEnd ? 0 : sr.v,
          braking: nearBrake(rivalBrakes, clamped),
          label: opts.rivalLabel || "Bester",
        },
      });

      if (t < total) raf = global.requestAnimationFrame(step);
      else onEnd({ yourEnd, rivalEnd, gap: yourEnd - rivalEnd });
    }
    raf = global.requestAnimationFrame(step);

    return function stop() {
      stopped = true;
      if (raf) global.cancelAnimationFrame(raf);
    };
  }

  global.Replay = { race, syntheticTrack, distanceCurve, sampleAt, brakePoints };
})(typeof window !== "undefined" ? window : globalThis);
