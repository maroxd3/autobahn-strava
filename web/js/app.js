// UI wiring for Autobahn Strava.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const MS_TO_KMH = Geo.MS_TO_KMH;

  let recorder = null;
  let ticker = null;
  let startedAt = 0;

  // ---- Tabs -----------------------------------------------------------------
  $$(".tabbar button").forEach((b) => {
    b.addEventListener("click", () => showTab(b.dataset.tab));
  });
  function showTab(name) {
    $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $$(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
    if (name === "trips") renderTrips();
    if (name === "board") renderBoard();
  }

  // ---- Mode -----------------------------------------------------------------
  $$('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      const track = currentMode() === "track";
      $("#modeHint").textContent = track
        ? "Track-Modus: Tempo/Beschleunigung nur auf gesperrter/privater Strecke. Zählt nicht für die öffentliche Rangliste."
        : "Bewertet nur legales, ruhiges & effizientes Fahren. Kein Tempo-Ranking.";
      $("#safetyNote").hidden = track;
    })
  );
  const currentMode = () => document.querySelector('input[name="mode"]:checked').value;

  // ---- Profile header -------------------------------------------------------
  function refreshWho() {
    $("#whoami").textContent = "👤 " + Store.getProfile().nickname;
  }

  // ---- Recording ------------------------------------------------------------
  $("#btnStart").addEventListener("click", startRecording);
  $("#btnStop").addEventListener("click", stopRecording);
  $("#btnSim").addEventListener("click", simulateDrive);

  function startRecording() {
    try {
      recorder = new Geo.Recorder(onSample).start();
    } catch (e) {
      alert(e.message + "\n(Standort benötigt HTTPS und Freigabe.)");
      return;
    }
    startedAt = Date.now();
    $("#btnStart").hidden = true;
    $("#btnStop").hidden = false;
    $("#btnSim").hidden = true;
    ticker = setInterval(updateLiveTime, 500);
  }

  function onSample(ev) {
    if (ev.error) {
      $("#liveAcc").textContent = "!";
      return;
    }
    const s = ev.sample;
    $("#liveSpeed").textContent = Math.round(s.spd * MS_TO_KMH);
    $("#liveAcc").textContent = s.acc !== null ? Math.round(s.acc) : "–";
    const dist = Geo.totalDistance(recorder.samples);
    $("#liveDist").textContent = (dist / 1000).toFixed(1);
  }

  function updateLiveTime() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    $("#liveDur").textContent = fmtDur(sec);
  }

  function stopRecording() {
    const samples = recorder ? recorder.stop() : [];
    clearInterval(ticker);
    recorder = null;
    resetLive();
    $("#btnStart").hidden = false;
    $("#btnStop").hidden = true;
    $("#btnSim").hidden = false;
    if (samples.length < 5) {
      alert("Zu wenige GPS-Punkte aufgenommen — Fahrt verworfen.");
      return;
    }
    finalizeTrip(samples, currentMode());
  }

  function resetLive() {
    $("#liveSpeed").textContent = "–";
    $("#liveDist").textContent = "0.0";
    $("#liveDur").textContent = "0:00";
    $("#liveAcc").textContent = "–";
  }

  // ---- Finalize: trim, detect, score, cheat-check, save ---------------------
  function finalizeTrip(rawSamples, mode) {
    const profile = Store.getProfile();
    const samples = profile.trimEnds ? Store.trimEnds(rawSamples, 500) : rawSamples;

    const segment = mode === "public" ? Segments.detectSegment(samples) : null;

    const metrics = {
      distanceM: Geo.totalDistance(samples),
      durationSec: Geo.durationSec(samples),
      avgKmh: Geo.avgMovingKmh(samples),
      sustainedKmh: Geo.sustainedMaxKmh(samples, 5),
      peakKmh: Geo.peakKmh(samples),
      medianAccuracy: Geo.medianAccuracy(samples),
    };

    const score = Score.legalDriveScore(samples, segment);
    const cheat = Score.cheatCheck(samples, metrics);

    const trip = {
      id: Store.newId(),
      createdAt: Date.now(),
      nickname: profile.nickname,
      mode,
      segmentId: segment ? segment.id : null,
      segmentName: segment ? segment.autobahn + " " + segment.name : "Kein Segment erkannt",
      private: profile.defaultPrivate,
      eligible: mode === "public" && !!segment && cheat.ok,
      cheatFlags: cheat.flags,
      distanceM: metrics.distanceM,
      durationSec: metrics.durationSec,
      avgKmh: metrics.avgKmh,
      sustainedKmh: metrics.sustainedKmh,
      peakKmh: metrics.peakKmh,
      medianAccuracy: metrics.medianAccuracy,
      score,
      // Downsampled speed track for the chart (no raw lat/lon persisted →
      // the exact route is never stored or shown).
      speedTrack: downsampleSpeeds(samples, 60),
    };

    Store.saveTrip(trip);
    showTab("trips");
    openTrip(trip.id);
  }

  // Keep only per-point speed (km/h) + relative time — deliberately drops lat/lon.
  function downsampleSpeeds(samples, maxPts) {
    const step = Math.max(1, Math.ceil(samples.length / maxPts));
    const out = [];
    const t0 = samples[0].t;
    for (let i = 0; i < samples.length; i += step) {
      out.push({ t: Math.round((samples[i].t - t0) / 1000), v: Math.round(samples[i].spd * MS_TO_KMH) });
    }
    return out;
  }

  // ---- Trips list -----------------------------------------------------------
  function renderTrips() {
    const trips = Store.getTrips();
    const el = $("#tripList");
    if (!trips.length) {
      el.innerHTML = `<p class="muted tiny">Noch keine Fahrten. Starte eine Aufnahme oder simuliere eine Beispiel-Fahrt.</p>`;
      return;
    }
    el.innerHTML = trips.map(tripCardHTML).join("");
    $$("#tripList .item").forEach((c) => c.addEventListener("click", () => openTrip(c.dataset.id)));
  }

  function tripCardHTML(t) {
    return `<div class="item" data-id="${t.id}">
      <div class="top">
        <div>
          <div class="seg">${esc(t.segmentName)}</div>
          <div class="sub">${fmtDate(t.createdAt)} · ${(t.distanceM / 1000).toFixed(1)} km · ⌀ ${Math.round(t.avgKmh)} km/h</div>
        </div>
        <span class="score-chip ${scoreClass(t.score.total)}">${t.score.total}</span>
      </div>
      <div class="badges">
        ${t.mode === "track" ? `<span class="badge track">🏁 Track</span>` : ``}
        ${t.private ? `<span class="badge">🔒 privat</span>` : `<span class="badge">🌍 geteilt</span>`}
        ${t.eligible && !t.private ? `<span class="badge mine">in Rangliste</span>` : ``}
        ${t.eligible && t.private ? `<span class="badge">wertbar · privat</span>` : ``}
        ${t.cheatFlags && t.cheatFlags.length ? `<span class="badge warn">⚠︎ geprüft</span>` : ``}
      </div>
    </div>`;
  }

  // ---- Trip detail modal ----------------------------------------------------
  function openTrip(id) {
    const t = Store.getTrips().find((x) => x.id === id);
    if (!t) return;
    const c = t.score.components;
    const box = $("#modalBox");
    box.innerHTML = `
      <div class="top" style="margin-bottom:12px">
        <div>
          <div class="seg" style="font-size:18px">${esc(t.segmentName)}</div>
          <div class="sub">${fmtDate(t.createdAt)} · ${t.mode === "track" ? "Track-Modus" : "Öffentliche Straße"}</div>
        </div>
        <span class="score-chip ${scoreClass(t.score.total)}">${t.score.total}</span>
      </div>
      ${speedChartSVG(t.speedTrack)}
      <div class="comp-bars">
        ${bar("Legalität", c.lawfulness)}
        ${bar("Ruhe / Smoothness", c.smoothness)}
        ${bar("Sanftes Bremsen", c.calmBraking)}
        ${bar("Effizienz", c.efficiency)}
      </div>
      <div style="margin-top:12px">
        ${kv("Distanz", (t.distanceM / 1000).toFixed(1) + " km")}
        ${kv("Dauer", fmtDur(Math.round(t.durationSec)))}
        ${kv("⌀ Fahrtempo", Math.round(t.avgKmh) + " km/h")}
        ${kv("Gehaltenes Max (5 s)", Math.round(t.sustainedKmh) + " km/h")}
        ${kv("Starke Bremsungen", String(t.score.hardBrakingEvents))}
        ${kv("GPS-Genauigkeit (Median)", t.medianAccuracy !== null ? "± " + Math.round(t.medianAccuracy) + " m" : "–")}
      </div>
      ${t.cheatFlags && t.cheatFlags.length ? `<p class="tiny" style="color:var(--warn);margin-top:10px">⚠︎ Plausibilitätshinweise: ${t.cheatFlags.join(", ")} — nicht für die Rangliste gewertet.</p>` : ``}
      ${!t.eligible && t.mode === "public" && (!t.cheatFlags || !t.cheatFlags.length) && !t.segmentId ? `<p class="tiny muted" style="margin-top:10px">Kein bekanntes Autobahn-Segment erkannt — zählt nicht für eine Rangliste.</p>` : ``}
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" id="mPriv">${t.private ? "🌍 Teilen" : "🔒 Privat"}</button>
        <button class="btn btn-danger" id="mDel">Löschen</button>
      </div>
      <button class="btn btn-ghost" id="mClose">Schließen</button>
    `;
    $("#modal").hidden = false;
    $("#mClose").addEventListener("click", closeModal);
    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
    $("#mDel").addEventListener("click", () => {
      if (confirm("Diese Fahrt löschen?")) { Store.deleteTrip(t.id); closeModal(); renderTrips(); }
    });
    $("#mPriv").addEventListener("click", () => {
      Store.setTripPrivacy(t.id, !t.private);
      openTrip(t.id);
      renderTrips();
    });
  }
  function closeModal() { $("#modal").hidden = true; }

  function bar(label, val) {
    return `<div class="comp-bar"><div class="lab"><span>${label}</span><span>${val}</span></div>
      <div class="track"><div class="fill" style="width:${val}%"></div></div></div>`;
  }
  function kv(k, v) { return `<div class="kv"><span>${k}</span><b>${v}</b></div>`; }

  // SVG speed graph from downsampled speed track.
  function speedChartSVG(track) {
    if (!track || track.length < 2) return "";
    const W = 600, HGT = 120, pad = 6;
    const maxV = Math.max(60, ...track.map((p) => p.v));
    const maxT = track[track.length - 1].t || 1;
    const pts = track
      .map((p) => {
        const x = pad + (p.t / maxT) * (W - 2 * pad);
        const y = HGT - pad - (p.v / maxV) * (HGT - 2 * pad);
        return x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    // 130 km/h Richtgeschwindigkeit reference line.
    const yRef = HGT - pad - (130 / maxV) * (HGT - 2 * pad);
    const refLine = 130 <= maxV
      ? `<line x1="${pad}" y1="${yRef.toFixed(1)}" x2="${W - pad}" y2="${yRef.toFixed(1)}" stroke="#ff9f43" stroke-dasharray="4 4" stroke-width="1"/>
         <text x="${W - pad}" y="${(yRef - 4).toFixed(1)}" fill="#ff9f43" font-size="10" text-anchor="end">130 (Richtgeschw.)</text>`
      : "";
    return `<svg class="chart" viewBox="0 0 ${W} ${HGT}" preserveAspectRatio="none">
      ${refLine}
      <polyline points="${pts}" fill="none" stroke="#3ea6ff" stroke-width="2" />
    </svg>`;
  }

  // ---- Leaderboard ----------------------------------------------------------
  function initBoardControls() {
    const sel = $("#boardSegment");
    sel.innerHTML = Segments.list.map((s) => `<option value="${s.id}">${s.autobahn} ${s.name}</option>`).join("");
    sel.addEventListener("change", renderBoard);
    $("#boardSort").addEventListener("change", renderBoard);
  }

  function renderBoard() {
    const segId = $("#boardSegment").value || Segments.list[0].id;
    const sort = $("#boardSort").value;
    const rows = Store.leaderboard(segId, sort);
    const el = $("#boardList");
    if (!rows.length) {
      el.innerHTML = `<p class="muted tiny">Noch keine gewerteten Fahrten für dieses Segment.</p>`;
      return;
    }
    el.innerHTML = rows
      .map((r, i) => {
        const primary = sort === "legalSpeed"
          ? `${r.sustainedKmh} km/h <span class="lb-sub">legal gehalten</span>`
          : `<span class="score-chip ${scoreClass(r.score)}">${r.score}</span>`;
        return `<div class="item"><div class="lb-row">
          <div class="lb-rank">${medal(i)}</div>
          <div class="lb-main">
            <div class="lb-name">${esc(r.nickname)}
              ${r.demo ? `<span class="badge demo">Demo</span>` : ``}
              ${r.mine ? `<span class="badge mine">Du</span>` : ``}
            </div>
            <div class="lb-sub">⌀ ${r.avgKmh} km/h · gehalten ${r.sustainedKmh} km/h · ${r.hardBraking} starke Bremsungen</div>
          </div>
          <div>${primary}</div>
        </div></div>`;
      })
      .join("");
  }
  function medal(i) { return ["🥇", "🥈", "🥉"][i] || i + 1; }

  // ---- Settings -------------------------------------------------------------
  function initSettings() {
    const p = Store.getProfile();
    $("#nick").value = p.nickname;
    $("#optTrim").checked = !!p.trimEnds;
    $("#optPrivate").checked = !!p.defaultPrivate;
    $("#btnReroll").addEventListener("click", () => { $("#nick").value = Store.randomNickname(); });
    $("#btnSaveProfile").addEventListener("click", () => {
      const nick = $("#nick").value.trim() || Store.randomNickname();
      Store.saveProfile({ nickname: nick, trimEnds: $("#optTrim").checked, defaultPrivate: $("#optPrivate").checked });
      refreshWho();
      alert("Gespeichert.");
    });
    $("#btnWipe").addEventListener("click", () => {
      if (confirm("Wirklich ALLE Fahrten und dein Profil löschen? Das kann nicht rückgängig gemacht werden.")) {
        Store.deleteAll();
        refreshWho();
        renderTrips();
        alert("Alle lokalen Daten gelöscht.");
      }
    });
  }

  // ---- Simulated drive (for trying the app without a real trip) -------------
  // Marches along the A2 Hannover → Braunschweig segment at ~2 s steps, moving
  // positions by the actual speed so distance, average, sustained-max and the
  // speed chart are all mutually consistent. Gentle ~120 km/h cruise with one
  // mild traffic slowdown and start/stop ramps — a clean, cheat-free trip.
  function simulateDrive() {
    const seg = Segments.byId("a2-hannover-braunschweig");
    const from = seg.from, to = seg.to;
    const D = Segments.haversine(from, to); // straight-line metres
    const dt = 2; // seconds between samples
    const samples = [];
    let dist = 0;
    let t = Date.now() - 25 * 60 * 1000;
    let i = 0;
    while (dist < D) {
      const f = dist / D;
      // Cruise ~120 with a smooth wobble; dip to ~70 in a mid traffic patch.
      let kmh = 120 + 7 * Math.sin(f * 8);
      if (f > 0.55 && f < 0.66) kmh -= 50;
      if (f < 0.04) kmh = 30 + f * 2000; // acceleration ramp
      if (f > 0.96) kmh = 30 + (1 - f) * 2000; // deceleration ramp
      kmh = Math.max(8, kmh + Math.sin(i * 1.7) * 1.2); // small noise
      const lat = from.lat + (to.lat - from.lat) * f;
      const lon = from.lon + (to.lon - from.lon) * f;
      samples.push({ t, lat, lon, acc: 8 + Math.abs(Math.sin(i)) * 4, spd: kmh / MS_TO_KMH, src: "gps" });
      dist += (kmh / MS_TO_KMH) * dt;
      t += dt * 1000;
      i++;
    }
    samples.push({ t, lat: to.lat, lon: to.lon, acc: 8, spd: samples[samples.length - 1].spd, src: "gps" });
    finalizeTrip(samples, "public");
  }

  // ---- Helpers --------------------------------------------------------------
  function scoreClass(s) { return s >= 85 ? "score-good" : s >= 65 ? "score-mid" : "score-low"; }
  function fmtDur(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m >= 60) { const h = Math.floor(m / 60); return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function fmtDate(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" }) + " " +
      d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---- Boot -----------------------------------------------------------------
  refreshWho();
  initBoardControls();
  initSettings();
  renderTrips();
})();
