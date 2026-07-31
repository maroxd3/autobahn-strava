// Shared online leaderboard.
//
// Talks to Firebase over its REST endpoints rather than pulling in the SDK: the
// rest of this app is dependency-free and a few hundred KB of SDK to write one
// document and run two queries is a bad trade on a phone in a car.
//
// Everything here is opt-in and off by default. Nothing leaves the device unless
// the user turns the online board on *and* shares a specific trip. What gets
// uploaded is the same derived data the app already shows — metrics plus the
// trimmed speed track — never coordinates of the path. The segment's two
// endpoints go up so drives can be matched to each other; that is the minimum
// the feature cannot work without, and it is exactly what PRIVACY.md allows.

(function (global) {
  "use strict";

  const CONFIG = {
    projectId: "autobahn-strava",
    apiKey: "AIzaSyCOkJzNUB3Ho0ioMtwIGO-EQjbnXbo6nis", // public client key; rules do the enforcing
  };

  const AUTH = "https://identitytoolkit.googleapis.com/v1/accounts";
  const DB =
    `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}/databases/(default)/documents`;

  const KEY_SESSION = "as_cloud_session";
  const KEY_ENABLED = "as_cloud_enabled";

  // ---- Opt-in ---------------------------------------------------------------

  function isEnabled() {
    return localStorage.getItem(KEY_ENABLED) === "1";
  }

  function setEnabled(on) {
    localStorage.setItem(KEY_ENABLED, on ? "1" : "0");
  }

  // ---- Anonymous identity ---------------------------------------------------
  // No email, no password, no profile — just a durable id so you can delete your
  // own entries later. That id is the only thing linking two of your drives.

  function session() {
    try {
      return JSON.parse(localStorage.getItem(KEY_SESSION) || "null");
    } catch (e) {
      return null;
    }
  }

  async function signIn() {
    const s = session();
    // Tokens last an hour; refresh a few minutes early rather than on failure.
    if (s && s.expiresAt - Date.now() > 5 * 60 * 1000) return s;
    if (s && s.refreshToken) {
      try {
        return await refresh(s.refreshToken);
      } catch (e) {
        /* fall through to a fresh anonymous account */
      }
    }
    const res = await fetch(`${AUTH}:signUp?key=${CONFIG.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(describe(data, "Anmeldung fehlgeschlagen"));
    return store(data.idToken, data.refreshToken, data.expiresIn, data.localId);
  }

  async function refresh(refreshToken) {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(describe(data, "Token-Refresh fehlgeschlagen"));
    return store(data.id_token, data.refresh_token, data.expires_in, data.user_id);
  }

  function store(idToken, refreshToken, expiresIn, uid) {
    const s = {
      idToken,
      refreshToken,
      uid,
      expiresAt: Date.now() + Number(expiresIn || 3600) * 1000,
    };
    localStorage.setItem(KEY_SESSION, JSON.stringify(s));
    return s;
  }

  function describe(data, fallback) {
    const msg = data && data.error && data.error.message;
    if (msg === "ADMIN_ONLY_OPERATION" || msg === "OPERATION_NOT_ALLOWED") {
      return "Anonyme Anmeldung ist im Firebase-Projekt nicht aktiviert.";
    }
    if (msg === "CONFIGURATION_NOT_FOUND") {
      return "Die Online-Rangliste ist serverseitig noch nicht eingerichtet.";
    }
    if (msg === "TOO_MANY_ATTEMPTS_TRY_LATER") {
      return "Zu viele Versuche — bitte später erneut probieren.";
    }
    return msg || fallback;
  }

  // ---- Firestore REST value mapping ----------------------------------------
  // Firestore's REST shape is typed values; these two convert to and from it.

  function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    return { mapValue: { fields: toFields(v) } };
  }

  function toFields(obj) {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = toValue(obj[k]);
    return out;
  }

  function fromValue(v) {
    if (!v) return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return v.doubleValue;
    if ("stringValue" in v) return v.stringValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
    if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
    return null;
  }

  function fromFields(fields) {
    const out = {};
    for (const k of Object.keys(fields)) out[k] = fromValue(fields[k]);
    return out;
  }

  async function authed(url, opts) {
    const s = await signIn();
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.idToken, ...(opts || {}).headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body.error && body.error.message) || res.statusText;
      throw new Error(`${res.status}: ${msg}`);
    }
    return res.json();
  }

  // ---- Publishing -----------------------------------------------------------

  // Push a trip to the shared board. Returns the created entry id.
  async function publishTrip(trip, segment, area) {
    if (!isEnabled()) throw new Error("Online-Rangliste ist nicht aktiviert.");
    const s = await signIn();

    // The segment has to exist before entries can point at it.
    await ensureSegment(segment);

    const doc = {
      segmentId: segment.id,
      uid: s.uid,
      nickname: trip.nickname,
      score: trip.score.total,
      avgKmh: Math.round(trip.avgKmh),
      sustainedKmh: Math.round(trip.sustainedKmh),
      hardBraking: trip.score.hardBrakingEvents,
      distanceM: Math.round(trip.distanceM),
      durationSec: Math.round(trip.durationSec),
      // Already downsampled to <= 60 points when the trip was saved.
      speedTrack: (trip.speedTrack || []).slice(0, 120),
      area: area || null,
      roadType: segment.roadType || "autobahn",
    };

    // createdAt has to equal request.time for the rules to accept the write, so
    // it is applied as a server-side transform in the *same* commit as the
    // document. Creating first and stamping after would be rejected outright.
    const id = randomId();
    await commitCreate("entries", id, toFields(doc), "createdAt");
    return id;
  }

  function randomId() {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    const bytes = new Uint8Array(20);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    for (const b of bytes) out += abc[b % abc.length];
    return out;
  }

  // Atomic "create if absent" with a server timestamp applied in the same write.
  async function commitCreate(collection, id, fields, timeField) {
    const name =
      `projects/${CONFIG.projectId}/databases/(default)/documents/${collection}/${id}`;
    return authed(`${DB}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: [
          {
            update: { name, fields },
            updateTransforms: [{ fieldPath: timeField, setToServerValue: "REQUEST_TIME" }],
            currentDocument: { exists: false },
          },
        ],
      }),
    });
  }

  async function ensureSegment(segment) {
    const s = await signIn();
    try {
      await authed(`${DB}/segments/${encodeURIComponent(segment.id)}`, { method: "GET" });
      return; // already shared by someone
    } catch (e) {
      if (!String(e.message).startsWith("404")) throw e;
    }
    const fields = toFields({
      name: segment.name,
      autobahn: segment.autobahn,
      roadType: segment.roadType || "autobahn",
      limitKmh: segment.limitKmh === undefined ? null : segment.limitKmh,
      from: { lat: segment.from.lat, lon: segment.from.lon },
      to: { lat: segment.to.lat, lon: segment.to.lon },
      createdBy: s.uid,
    });
    await commitCreate("segments", segment.id, fields, "createdAt").catch((e) => {
      // Losing a race with another driver publishing the same segment is fine —
      // the document we wanted now exists, which is all this function promises.
      const m = String(e.message);
      if (!m.startsWith("409") && !m.includes("ALREADY_EXISTS")) throw e;
    });
  }

  // ---- Reading --------------------------------------------------------------

  async function leaderboard(segmentId, sort, limit) {
    const orderField = sort === "legalSpeed" ? "sustainedKmh" : "score";
    const body = {
      structuredQuery: {
        from: [{ collectionId: "entries" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "segmentId" },
            op: "EQUAL",
            value: { stringValue: segmentId },
          },
        },
        orderBy: [{ field: { fieldPath: orderField }, direction: "DESCENDING" }],
        limit: limit || 25,
      },
    };
    const rows = await authed(`${DB}:runQuery`, { method: "POST", body: JSON.stringify(body) });
    const mine = (session() || {}).uid;
    return (rows || [])
      .filter((r) => r.document)
      .map((r) => {
        const d = fromFields(r.document.fields || {});
        return { ...d, id: r.document.name.split("/").pop(), mine: d.uid === mine, online: true };
      });
  }

  // Every entry this device published — the basis for "delete my online data".
  async function myEntries() {
    const s = await signIn();
    const body = {
      structuredQuery: {
        from: [{ collectionId: "entries" }],
        where: {
          fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: { stringValue: s.uid } },
        },
        limit: 500,
      },
    };
    const rows = await authed(`${DB}:runQuery`, { method: "POST", body: JSON.stringify(body) });
    return (rows || []).filter((r) => r.document).map((r) => r.document.name.split("/").pop());
  }

  async function deleteEntry(id) {
    await authed(`${DB}/entries/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // Right to erasure, self-service: removes every entry this identity published,
  // then drops the local identity so nothing links a future drive to the old ones.
  async function deleteAllMine() {
    const ids = await myEntries();
    for (const id of ids) await deleteEntry(id);
    localStorage.removeItem(KEY_SESSION);
    return ids.length;
  }

  global.Cloud = {
    isEnabled,
    setEnabled,
    signIn,
    publishTrip,
    leaderboard,
    myEntries,
    deleteEntry,
    deleteAllMine,
    uid: () => (session() || {}).uid || null,
  };
})(typeof window !== "undefined" ? window : globalThis);
