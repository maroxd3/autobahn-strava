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
      // Track mode has no public segments, so declaring a route is meaningless.
      $("#routeField").hidden = track;
      $("#routeHint").hidden = track;
    })
  );
  const currentMode = () => document.querySelector('input[name="mode"]:checked').value;

  // ---- Declared route -------------------------------------------------------
  // Saying where you're going up front beats guessing after the fact: it fixes
  // which leaderboard the trip belongs to, and lets us show the applicable limit
  // before you set off rather than after.
  function initRouteControls() {
    const rt = $("#roadTypeSelect");
    rt.innerHTML = Object.entries(Segments.ROAD_TYPES)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
      .join("");
    rt.addEventListener("change", updateRouteHint);
    fillRouteSelect();
    $("#routeSelect").addEventListener("change", updateRouteHint);
    updateRouteHint();
  }

  // Rebuilt after every drive, because a drive can create a new segment.
  function fillRouteSelect() {
    const sel = $("#routeSelect");
    const keep = sel.value;
    sel.innerHTML =
      `<option value="">Automatisch — neue Strecke anlegen</option>` +
      Segments.all().map((s) => `<option value="${s.id}">${s.autobahn} ${s.name}</option>`).join("");
    sel.value = keep;
  }

  const currentRoadType = () => $("#roadTypeSelect").value;

  function declaredRoute() {
    return Segments.byId($("#routeSelect").value) || null;
  }

  function updateRouteHint() {
    const seg = declaredRoute();
    const el = $("#routeHint");
    $("#btnSim").textContent = `▷ Beispiel-Fahrt simulieren (${seg ? seg.autobahn : "A2"})`;
    // Point the leaderboard at the route you just declared.
    if (seg) $("#boardSegment").value = seg.id;
    // The road type only decides the limit for a route we haven't seen before.
    $("#roadTypeField").hidden = !!seg;
    if (!seg) {
      const rt = Segments.ROAD_TYPES[currentRoadType()];
      el.textContent =
        `Passt die Fahrt zu keiner bekannten Strecke, wird sie als neue Strecke angelegt — ` +
        (rt.limitKmh
          ? `gewertet gegen ${rt.limitKmh} km/h.`
          : `gewertet gegen die Richtgeschwindigkeit ${Score.RICHTGESCHWINDIGKEIT} km/h.`);
      return;
    }
    el.textContent = seg.limitKmh
      ? `${seg.autobahn} ${seg.name} — ${seg.limitKmh} km/h Limit. Wertung gegen dieses Limit.`
      : `${seg.autobahn} ${seg.name} — kein festes Limit, Richtgeschwindigkeit ${Score.RICHTGESCHWINDIGKEIT} km/h.`;
  }

  // ---- Profile header -------------------------------------------------------
  function refreshWho() {
    $("#whoami").textContent = "👤 " + Store.getProfile().nickname;
  }

  // ---- Recording ------------------------------------------------------------
  $("#btnStart").addEventListener("click", startRecording);
  $("#btnStop").addEventListener("click", stopRecording);
  $("#btnSim").addEventListener("click", simulateDrive);

  // Keep the screen awake during a recording. Without this, the "leave the
  // screen on" warning asks the user to fight their own phone; with it, the
  // phone simply stays on. Re-acquired on tab return because the OS silently
  // releases the lock whenever the page loses visibility.
  let wakeLock = null;
  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      /* not granted (e.g. low battery) — recording still works, screen may sleep */
    }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }
  document.addEventListener("visibilitychange", () => {
    if (recorder && document.visibilityState === "visible") acquireWakeLock();
  });

  function startRecording() {
    try {
      recorder = new Geo.Recorder(onSample).start();
    } catch (e) {
      alert(e.message + "\n(Standort benötigt HTTPS und Freigabe.)");
      return;
    }
    startedAt = Date.now();
    acquireWakeLock();
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
    if (ev.badAccuracy) {
      // Sample rejected for poor accuracy — show why, record nothing.
      $("#liveAcc").textContent = Math.round(ev.badAccuracy) + "⚠";
      return;
    }
    const s = ev.sample;
    $("#liveSpeed").textContent = Math.round(s.spd * MS_TO_KMH);
    $("#liveSpeed").classList.remove("idle");
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
    releaseWakeLock();
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
    $("#liveSpeed").classList.add("idle");
    $("#liveDist").textContent = "0.0";
    $("#liveDur").textContent = "0:00";
    $("#liveAcc").textContent = "–";
  }

  // ---- Finalize: trim, detect, score, cheat-check, save ---------------------
  function finalizeTrip(rawSamples, mode) {
    const profile = Store.getProfile();
    const samples = profile.trimEnds ? Store.trimEnds(rawSamples, 500) : rawSamples;

    // A declared route only counts if the recorded track actually backs it up —
    // otherwise you could pick an easy segment and drive somewhere else entirely.
    // When the two disagree, the GPS wins and we say so on the trip.
    // No declaration means "whatever this drive was" — match a known segment, or
    // mint one from the drive itself so every trip lands on some leaderboard.
    const declared = mode === "public" ? declaredRoute() : null;
    const detected =
      mode === "public"
        ? declared
          ? Segments.detectSegment(samples)
          : Segments.matchOrCreate(samples, currentRoadType())
        : null;
    const routeMismatch = !!declared && (!detected || detected.id !== declared.id);
    const segment = detected;

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
      declaredSegmentId: declared ? declared.id : null,
      routeMismatch,
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
    // The drive may have created a segment — get it into both pickers.
    fillRouteSelect();
    fillBoardSelect();
    if (segment) $("#boardSegment").value = segment.id;
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
          <div class="seg">${segLabel(t.segmentId, t.segmentName)}</div>
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
          <div class="seg" style="font-size:18px">${segLabel(t.segmentId, t.segmentName)}</div>
          <div class="sub">${fmtDate(t.createdAt)} · ${t.mode === "track" ? "Track-Modus" : "Öffentliche Straße"}</div>
        </div>
        <span class="score-chip ${scoreClass(t.score.total)}">${t.score.total}</span>
      </div>
      ${speedChartSVG(t.speedTrack, t.segmentId ? (Segments.byId(t.segmentId) || {}).limitKmh : null)}
      <div class="comp-bars">
        ${bar("Legalität", c.lawfulness)}
        ${bar("Ruhe / Smoothness", c.smoothness)}
        ${bar("Sanftes Bremsen", c.calmBraking)}
        ${c.efficiency !== null && c.efficiency !== undefined
          ? bar("Effizienz", c.efficiency)
          : `<p class="tiny muted" style="margin:6px 0 0">Effizienz: zu wenig Cruise-Anteil zum Bewerten — nicht gewertet.</p>`}
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
      ${t.routeMismatch ? `<p class="tiny" style="color:var(--warn);margin-top:10px">⚠︎ Deine deklarierte Route passt nicht zur gefahrenen Strecke — gewertet wurde, was das GPS sagt.</p>` : ``}
      ${!t.eligible && t.mode === "public" && (!t.cheatFlags || !t.cheatFlags.length) && !t.segmentId ? `<p class="tiny muted" style="margin-top:10px">Kein bekanntes Autobahn-Segment erkannt — zählt nicht für eine Rangliste.</p>` : ``}
      ${ghostRival(t) ? `
        <div id="replayWrap" style="margin-top:14px" hidden>
          <canvas id="replayCanvas" style="width:100%;display:block"></canvas>
          <p class="tiny muted" id="replayResult"></p>
        </div>
        <button class="btn btn-ghost" id="mReplay" style="margin-top:10px">👻 Ghost-Replay gegen ${esc(ghostRival(t).nickname)}</button>
      ` : ``}
      ${Cloud.isEnabled() && t.eligible && t.mode === "public" ? `
        <button class="btn btn-ghost" id="mPublish" style="margin-top:10px"${t.publishedId ? " disabled" : ""}>
          ${t.publishedId ? "✓ In der Online-Rangliste" : "🌐 In Online-Rangliste veröffentlichen"}
        </button>
      ` : ``}
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" id="mShare">📤 Score teilen</button>
        <button class="btn" id="mPriv">${t.private ? "🌍 Freigeben" : "🔒 Privat"}</button>
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
    if ($("#mReplay")) $("#mReplay").addEventListener("click", () => startGhostReplay(t));
    $("#mShare").addEventListener("click", async () => {
      // The viral path: score as a brag + the app link, into the OS share sheet.
      const text = `Legal-Drive-Score ${t.score.total}/100 auf ${t.segmentName} 🛣️ — schlag mich (legal):`;
      const url = "https://autobahn-strava.web.app";
      try {
        if (navigator.share) await navigator.share({ title: "Autobahn Strava", text, url });
        else {
          await navigator.clipboard.writeText(text + " " + url);
          alert("In die Zwischenablage kopiert!");
        }
      } catch (e) {
        /* user cancelled the share sheet — fine */
      }
    });
    if ($("#mPublish") && !t.publishedId) {
      $("#mPublish").addEventListener("click", async () => {
        const btn = $("#mPublish");
        const seg = Segments.byId(t.segmentId);
        if (!seg) return;
        btn.disabled = true;
        btn.textContent = "Wird veröffentlicht …";
        try {
          const area = Places ? Places.nearest(seg.from, 40) : null;
          const entryId = await Cloud.publishTrip(t, seg, area);
          Store.setTripPublished(t.id, entryId);
          openTrip(t.id);
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "🌐 In Online-Rangliste veröffentlichen";
          alert("Veröffentlichen fehlgeschlagen: " + e.message);
        }
      });
    }
    $("#mPriv").addEventListener("click", () => {
      Store.setTripPrivacy(t.id, !t.private);
      openTrip(t.id);
      renderTrips();
    });
  }
  function closeModal() {
    // Leave no animation frame running behind a hidden modal.
    if (stopReplay) { stopReplay(); stopReplay = null; }
    $("#modal").hidden = true;
  }

  function bar(label, val) {
    return `<div class="comp-bar"><div class="lab"><span>${label}</span><span>${val}</span></div>
      <div class="track"><div class="fill" style="width:${val}%"></div></div></div>`;
  }
  function kv(k, v) { return `<div class="kv"><span>${k}</span><b>${v}</b></div>`; }

  // SVG speed graph from downsampled speed track.
  // Speed over time, drawn against the limit the drive was actually judged by —
  // a bare line says nothing about whether the driving was good. Stretches above
  // the limit are drawn red, and hard braking is marked where it happened, so
  // the chart shows the same story the score does.
  function speedChartSVG(track, limitKmh) {
    if (!track || track.length < 2) return "";
    const W = 600, H = 132, padX = 8, padTop = 12, padBot = 10;
    const ref = limitKmh || Score.RICHTGESCHWINDIGKEIT;
    const maxV = Math.max(ref * 1.18, ...track.map((p) => p.v));
    const maxT = track[track.length - 1].t || 1;
    const X = (t) => padX + (t / maxT) * (W - 2 * padX);
    const Y = (v) => H - padBot - (v / maxV) * (H - padTop - padBot);
    const base = H - padBot;

    const pts = track.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`);
    const area = `M ${X(track[0].t).toFixed(1)},${base} L ${pts.join(" L ")} L ${X(maxT).toFixed(1)},${base} Z`;

    // Contiguous runs above the limit, each drawn as its own red polyline.
    const over = [];
    let run = [];
    for (const p of track) {
      if (p.v > ref) run.push(`${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`);
      else if (run.length) { over.push(run); run = []; }
    }
    if (run.length) over.push(run);

    const yRef = Y(ref);
    const brakes = (typeof Replay !== "undefined" ? Replay.brakePoints(track) : [])
      .map((t) => `<line x1="${X(t).toFixed(1)}" y1="${base}" x2="${X(t).toFixed(1)}" y2="${(base - 10).toFixed(1)}" stroke="#e5484d" stroke-width="2" opacity=".85"/>`)
      .join("");

    return `<div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffcc00" stop-opacity=".38"/>
            <stop offset="100%" stop-color="#ffcc00" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#spd)"/>
        <line x1="${padX}" y1="${yRef.toFixed(1)}" x2="${W - padX}" y2="${yRef.toFixed(1)}"
              stroke="#f5a623" stroke-dasharray="5 5" stroke-width="1.2" opacity=".75"/>
        <polyline points="${pts.join(" ")}" fill="none" stroke="#ffcc00" stroke-width="2.2"
                  stroke-linejoin="round" stroke-linecap="round"/>
        ${over.map((r) => r.length > 1
          ? `<polyline points="${r.join(" ")}" fill="none" stroke="#e5484d" stroke-width="2.6" stroke-linecap="round"/>`
          : "").join("")}
        ${brakes}
      </svg>
      <span class="chart-ref">${ref} km/h${limitKmh ? " Limit" : " Richtgeschw."}</span>
    </div>`;
  }

  // ---- Ghost Replay ---------------------------------------------------------
  // Race this drive against the best drive on the same segment.
  function ghostRival(t) {
    if (!t || t.mode !== "public" || !t.segmentId) return null;
    const rows = Store.leaderboard(t.segmentId, "score").filter((r) => r.id !== t.id);
    if (rows.length) return rows[0];

    // A route you created yourself has no seeded ghosts, and your own trips stay
    // private by default — so without this, the newest segments would be the only
    // ones you can never race on. Fall back to your own best previous drive here.
    const own = Store.getTrips()
      .filter((x) => x.id !== t.id && x.segmentId === t.segmentId && x.mode === "public")
      .sort((a, b) => b.score.total - a.score.total)[0];
    if (!own) return null;
    return {
      id: own.id,
      nickname: "Deine beste Fahrt",
      score: own.score.total,
      avgKmh: Math.round(own.avgKmh),
      sustainedKmh: Math.round(own.sustainedKmh),
      hardBraking: own.score.hardBrakingEvents,
    };
  }

  let stopReplay = null;

  function startGhostReplay(t) {
    const rival = ghostRival(t);
    if (!rival) return;
    if (stopReplay) stopReplay();

    // A real rival trip carries its own speed track. The seeded demo ghosts only
    // have summary stats, so their drive is reconstructed over the same distance
    // this trip covered — same road, same length, different driving.
    const rivalTrip = Store.getTrips().find((x) => x.id === rival.id);
    const rivalDur = t.distanceM / Math.max(1, rival.avgKmh / 3.6);
    const rivalTrack =
      rivalTrip && rivalTrip.speedTrack && rivalTrip.speedTrack.length
        ? rivalTrip.speedTrack
        : Replay.syntheticTrack(rival, rivalDur);

    $("#replayWrap").hidden = false;
    $("#replayResult").textContent = "Läuft …";
    $("#mReplay").textContent = "↻ Replay wiederholen";

    // Pace every replay to ~20 s of watching, whether the drive took 12 minutes
    // or 2 hours — a fixed 60× made long drives unwatchable.
    const longestSec = Math.max(t.durationSec || 0, rivalDur || 0, 60);
    const speedUp = Math.min(400, Math.max(30, Math.round(longestSec / 20)));

    stopReplay = Replay.race($("#replayCanvas"), {
      yourTrack: t.speedTrack,
      rivalTrack,
      speedUp,
      rivalLabel: rival.nickname,
      onEnd: (r) => {
        const gap = Math.abs(Math.round(r.gap));
        const youWon = r.gap < 0;
        const winner = youWon ? "Du" : esc(rival.nickname);
        const myBrakes = t.score.hardBrakingEvents;
        const theirBrakes = rival.hardBraking;
        const winnerBrakes = youWon ? myBrakes : theirBrakes;
        const loserBrakes = youWon ? theirBrakes : myBrakes;
        // The line that makes the point: what did the time actually cost?
        const cost =
          winnerBrakes > loserBrakes
            ? ` — dafür ${winnerBrakes}× hart gebremst statt ${loserBrakes}×.`
            : winnerBrakes < loserBrakes
            ? ` — und dabei ruhiger gefahren (${winnerBrakes}× hart gebremst statt ${loserBrakes}×).`
            : ".";
        $("#replayResult").innerHTML =
          gap === 0
            ? `Gleichzeitig am Ziel. Score ${t.score.total} zu ${rival.score}.`
            : `${winner} ${gap} s früher am Ziel${cost} Score ${t.score.total} zu ${rival.score}.`;
      },
    });
  }

  // ---- Leaderboard ----------------------------------------------------------
  function initBoardControls() {
    fillBoardSelect();
    $("#boardSegment").addEventListener("change", renderBoard);
    $("#boardSort").addEventListener("change", renderBoard);
  }

  function fillBoardSelect() {
    const sel = $("#boardSegment");
    const keep = sel.value;
    sel.innerHTML = Segments.all()
      .map((s) => `<option value="${s.id}">${s.autobahn} ${s.name}</option>`)
      .join("");
    if (keep) sel.value = keep;
  }

  function renderBoard() {
    const segId = $("#boardSegment").value || Segments.all()[0].id;
    const sort = $("#boardSort").value;
    drawBoard(Store.leaderboard(segId, sort), sort);
    // Online rows arrive over the network, so paint the local board immediately
    // and fold them in when they land — the board is never blank while waiting.
    if (Cloud.isEnabled()) mergeOnlineRows(segId, sort);
  }

  async function mergeOnlineRows(segId, sort) {
    let online;
    try {
      online = await Cloud.leaderboard(segId, sort, 25);
    } catch (e) {
      $("#boardNote").textContent = "Online-Rangliste nicht erreichbar: " + e.message;
      return;
    }
    // The board may have been switched while the request was in flight.
    if ($("#boardSegment").value !== segId || $("#boardSort").value !== sort) return;

    const local = Store.leaderboard(segId, sort);
    // A published trip exists both locally and online; keep the online copy so
    // it is not counted twice.
    const publishedIds = new Set(
      Store.getTrips().map((t) => t.publishedId).filter(Boolean)
    );
    const merged = local
      .filter((r) => !r.id || !publishedIds.has(r.id))
      .concat(online.map((r) => ({ ...r, nickname: r.nickname, hardBraking: r.hardBraking })));

    merged.sort((a, b) =>
      sort === "legalSpeed" ? b.sustainedKmh - a.sustainedKmh : b.score - a.score
    );
    drawBoard(merged, sort);
    $("#boardNote").textContent = online.length
      ? `${online.length} Einträge aus der Online-Rangliste.`
      : "Noch keine Online-Einträge für diese Strecke.";
  }

  function drawBoard(rows, sort) {
    const el = $("#boardList");
    const seg = Segments.byId($("#boardSegment").value);

    // The shield belongs here, once, rather than repeated on every row — every
    // row on a board is by definition the same segment.
    $("#boardHead").innerHTML = seg
      ? `<div class="board-head">
           ${shield(seg)}
           <div class="board-head-main">
             <div class="board-head-name">${esc(seg.name)}</div>
             <div class="board-head-sub">${
               seg.limitKmh
                 ? seg.limitKmh + " km/h Limit"
                 : "Richtgeschwindigkeit " + Score.RICHTGESCHWINDIGKEIT + " km/h"
             }</div>
           </div>
         </div>`
      : "";

    if (!rows.length) {
      el.innerHTML = `<p class="muted tiny">Noch keine gewerteten Fahrten für dieses Segment.</p>`;
      return;
    }

    const lead = rows[0];
    el.innerHTML = rows
      .map((r, i) => {
        const primary = sort === "legalSpeed"
          ? `<div class="lb-speed">${r.sustainedKmh}<small>km/h</small></div>`
          : `<span class="score-chip ${scoreClass(r.score)}">${r.score}</span>`;
        // Distance to the leader — without it, every place below first is just
        // an unranked list of names.
        const behind = sort === "legalSpeed"
          ? lead.sustainedKmh - r.sustainedKmh
          : lead.score - r.score;
        const delta = i === 0
          ? `<div class="lb-delta lead">Führend</div>`
          : `<div class="lb-delta">−${behind}${sort === "legalSpeed" ? " km/h" : " Pkt"}</div>`;
        return `<div class="item lb-item${i === 0 ? " first" : ""}${r.mine ? " you" : ""}">
          <div class="lb-row">
            <div class="lb-rank r${Math.min(i + 1, 4)}">${i + 1}</div>
            <div class="lb-main">
              <div class="lb-name">${esc(r.nickname)}
                ${r.demo ? `<span class="badge demo">Demo</span>` : ``}
                ${r.online ? `<span class="badge demo">Online</span>` : ``}
                ${r.mine ? `<span class="badge mine">Du</span>` : ``}
              </div>
              <div class="lb-sub">⌀ ${r.avgKmh} · gehalten ${r.sustainedKmh} km/h · ${r.hardBraking}× hart gebremst</div>
              ${delta}
            </div>
            <div>${primary}</div>
          </div>
        </div>`;
      })
      .join("");
  }

  // Route badge in the colours German signage actually uses: blue for the
  // Autobahn, yellow for Bundes-/Landstraßen. Falls back to blue for the
  // hand-curated "A2"-style entries, which are all Autobahn.
  function shield(segOrTrip) {
    const seg = typeof segOrTrip === "string" ? Segments.byId(segOrTrip) : segOrTrip;
    if (!seg) return "";
    const code = seg.autobahn || "";
    // Curated segments predate roadType, so fall back to the limit: a segment
    // judged at 100 or less is not being treated as free Autobahn, whatever its
    // code says, and a blue shield there would contradict how it is scored.
    // A posted 120 on a real Autobahn (A81) still counts as blue.
    const yellow =
      seg.roadType === "landstrasse" ||
      seg.roadType === "stadt" ||
      /^[BL]/.test(code) ||
      (typeof seg.limitKmh === "number" && seg.limitKmh <= 100);
    return `<span class="shield ${yellow ? "bund" : "bab"}">${esc(code)}</span>`;
  }

  // "A2 Hannover → Braunschweig" → shield + the name on its own.
  function segLabel(segmentId, fallbackName) {
    const seg = segmentId ? Segments.byId(segmentId) : null;
    if (!seg) return esc(fallbackName || "Kein Segment erkannt");
    return `${shield(seg)}<span>${esc(seg.name)}</span>`;
  }

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

    $("#optCloud").checked = Cloud.isEnabled();
    updateCloudStatus();
    $("#optCloud").addEventListener("change", async () => {
      const on = $("#optCloud").checked;
      Cloud.setEnabled(on);
      if (on) {
        // Fail loudly and switch back off rather than leaving the user believing
        // publishing works when the backend will reject every write.
        try {
          await Cloud.signIn();
        } catch (e) {
          Cloud.setEnabled(false);
          $("#optCloud").checked = false;
          alert("Online-Rangliste nicht verfügbar: " + e.message);
        }
      }
      updateCloudStatus();
      renderTrips();
    });

    $("#btnCloudWipe").addEventListener("click", async () => {
      if (!confirm("Alle von diesem Gerät veröffentlichten Einträge aus der Online-Rangliste löschen?")) return;
      try {
        const n = await Cloud.deleteAllMine();
        alert(n + " Einträge gelöscht.");
        updateCloudStatus();
      } catch (e) {
        alert("Löschen fehlgeschlagen: " + e.message);
      }
    });
  }

  function updateCloudStatus() {
    const el = $("#cloudStatus");
    if (!el) return;
    el.textContent = Cloud.isEnabled()
      ? "Aktiv. Anonyme ID: " + (Cloud.uid() ? Cloud.uid().slice(0, 8) + "…" : "noch keine")
      : "Aus — es werden keine Daten übertragen.";
  }

  // ---- Simulated drive (for trying the app without a real trip) -------------
  // Marches along the A2 Hannover → Braunschweig segment at ~2 s steps, moving
  // positions by the actual speed so distance, average, sustained-max and the
  // speed chart are all mutually consistent. Gentle ~120 km/h cruise with one
  // mild traffic slowdown and start/stop ramps — a clean, cheat-free trip.
  function simulateDrive() {
    // Simulate whichever route you declared, so you can preview a segment's
    // leaderboard before ever driving it. Cruise sits just under the applicable
    // limit — the simulated trip should be a clean, lawful one.
    const seg = declaredRoute() || Segments.byId("a2-hannover-braunschweig");
    const cruise = seg.limitKmh ? seg.limitKmh - 5 : 120;
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
      let kmh = cruise + 7 * Math.sin(f * 8);
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
  // Say plainly whether a locked screen keeps recording. In the browser it does
  // not, and finding that out after a ruined 40 km drive is the worst way to
  // learn it.
  if (!Geo.Recorder.backgroundCapable()) {
    $("#safetyNote").insertAdjacentHTML(
      "beforeend",
      `<br /><b>Bildschirm an lassen</b> — im Browser stoppt die Aufnahme, sobald das Handy sperrt.`
    );
  }

  refreshWho();
  initBoardControls(); // before initRouteControls — route sync writes to its <select>
  initRouteControls();
  initSettings();
  renderTrips();
})();
