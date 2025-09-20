// server.js
// --- Boot & networking prefs (helps odd 404s on some local networks) ---
import dns from "dns";
import https from "https";
dns.setDefaultResultOrder("ipv4first");                 // prefer IPv4 locally
const ipv4Agent = new https.Agent({ family: 4 });       // reuse one IPv4 agent
const useIPv4Agent = !process.env.RENDER;              // true locally, false on Render

// --- Standard imports ---
import express from "express";
import axios from "axios";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config({ override: true });

// --- Env ---
const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI = "http://127.0.0.1:5173/callback",
  PORT = 5174,
} = process.env;

console.log("Client ID:", SPOTIFY_CLIENT_ID);
console.log("Secret length:", SPOTIFY_CLIENT_SECRET ? SPOTIFY_CLIENT_SECRET.length : 0);
console.log("Redirect:", SPOTIFY_REDIRECT_URI);

// --- App setup ---
const app = express();
const ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "https://mooddj.com"];

app.use(
  cors({
    origin: (origin, cb) => (!origin || ALLOWED_ORIGINS.includes(origin) ? cb(null, true) : cb(null, false)),
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

// --- In-memory token store (simple) ---
let accessTokens = {}; // { demo: { access_token, refresh_token, expires_in, expires_at, ... } }

// --- Helper: ensure valid Authorization header (auto-refresh if needed) ---
async function getAuthHeaders() {
  const t = accessTokens.demo;
  if (!t?.access_token) throw Object.assign(new Error("No token"), { status: 401 });

  // refresh if expired/near-expiry and we have a refresh_token
  if (t.expires_at && Date.now() >= t.expires_at && t.refresh_token) {
    const params = new URLSearchParams();
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", t.refresh_token);

    const r = await axios.post("https://accounts.spotify.com/api/token", params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: SPOTIFY_CLIENT_ID, password: SPOTIFY_CLIENT_SECRET },
    });

    const nxt = r.data; // may or may not include a new refresh_token
    accessTokens.demo = {
      ...t,
      ...nxt,
      refresh_token: nxt.refresh_token || t.refresh_token,
      expires_at: Date.now() + (Number(nxt.expires_in || 3600) - 60) * 1000, // refresh 1 min early
    };
  }

  return { Authorization: `Bearer ${accessTokens.demo.access_token}` };
}

// ---------------- OAuth ----------------
app.get("/login", (_req, res) => {
  const scope = [
    "user-read-email",
    "playlist-modify-public",
    "playlist-modify-private",
    // "user-top-read", // uncomment if you later use personalized seeds
  ].join(" ");
  const state = Math.random().toString(36).slice(2);

  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  url.searchParams.set("scope", scope);
  url.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  url.searchParams.set("state", state);

  res.redirect(url.toString());
});

app.post("/callback", async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: "Missing code" });

    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", code);
    params.set("redirect_uri", SPOTIFY_REDIRECT_URI);

    const tokenRes = await axios.post("https://accounts.spotify.com/api/token", params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: SPOTIFY_CLIENT_ID, password: SPOTIFY_CLIENT_SECRET },
    });

    const tok = tokenRes.data; // { access_token, refresh_token, expires_in, ... }
    accessTokens.demo = {
      ...tok,
      expires_at: Date.now() + (Number(tok.expires_in || 3600) - 60) * 1000, // refresh 1 min early
    };

    res.json({ ok: true });
  } catch (e) {
    console.error("TOKEN ERROR:", e.response?.status, e.response?.data || e.message);
    res.status(400).json({ error: "Token exchange failed" });
  }
});

// ---------------- API helpers ----------------
app.get("/api/me", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/me", { headers });
    res.json({ id: r.data.id, product: r.data.product, country: r.data.country });
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || e.message);
  }
});

app.get("/api/available-genres", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations/available-genre-seeds", {
      headers,
      httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || e.message);
  }
});

// ---------------- Recommendations (robust) ----------------
app.get("/api/recommendations", async (req, res) => {
  try {
    const baseHeaders = await getAuthHeaders();
    const headers = { ...baseHeaders, Accept: "application/json" };

    const params = {
      limit: Number(req.query.limit || 20),
      market: req.query.market || "from_token",
    };
    if (req.query.seed_genres) params.seed_genres = req.query.seed_genres;
    if (req.query.seed_artists) params.seed_artists = req.query.seed_artists;
    if (req.query.seed_tracks) params.seed_tracks = req.query.seed_tracks;
    if (req.query.target_valence) params.target_valence = Number(req.query.target_valence);
    if (req.query.target_energy) params.target_energy = Number(req.query.target_energy);
    if (req.query.target_danceability) params.target_danceability = Number(req.query.target_danceability);
    if (req.query.min_tempo) params.min_tempo = Number(req.query.min_tempo);

    if (!params.seed_genres && !params.seed_artists && !params.seed_tracks) {
      params.seed_genres = "pop"; // at least one seed
    }

    const forwardError = (label, e, extra = {}) => {
      const status = e.response?.status || 500;
      const data = e.response?.data || e.message;
      console.error(`${label}:`, status, data, extra);
      return { status, data };
    };

    // Primary: Spotify /recommendations
    try {
      console.log("RECS primary params ->", params);
      const r1 = await axios.get("https://api.spotify.com/v1/recommendations", {
        headers,
        params,
        httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
      });
      return res.json(r1.data);
    } catch (e1) {
      // If token went stale mid-call, force refresh once and retry
      if (e1.response?.status === 401 && accessTokens.demo) {
        accessTokens.demo.expires_at = 0;
        const headers2 = { ...(await getAuthHeaders()), Accept: "application/json" };
        const r1b = await axios.get("https://api.spotify.com/v1/recommendations", {
          headers: headers2,
          params,
          httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
        });
        return res.json(r1b.data);
      }
      forwardError("RECS ERROR (primary)", e1, { PARAMS: params });
    }

    // Fallback 1: artist-seeded recs (same endpoint)
    try {
      const p2 = { limit: params.limit, market: params.market, seed_artists: "4NHQUGzhtTLFvgF5SZesLK" };
      console.log("RECS fallback artist params ->", p2);
      const r2 = await axios.get("https://api.spotify.com/v1/recommendations", {
        headers,
        params: p2,
        httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
      });
      return res.json(r2.data);
    } catch (e2) {
      forwardError("RECS ERROR (artist fallback)", e2);
    }

    // Fallback 2: Search + Audio Features scoring (omit market; search works for you)
    try {
      const genre = (params.seed_genres || "pop").split(",")[0];
      console.log("RECS search fallback genre ->", genre);

      const s = await axios.get("https://api.spotify.com/v1/search", {
        headers: baseHeaders, // no Accept needed
        params: { q: `genre:"${genre}"`, type: "track", limit: params.limit },
      });
      const tracks = s.data?.tracks?.items || [];
      if (!tracks.length) return res.json({ tracks: [] });

      const ids = tracks.map((t) => t.id).join(",");
      const feats = await axios.get("https://api.spotify.com/v1/audio-features", {
        headers: baseHeaders,
        params: { ids },
      });
      const byId = Object.fromEntries((feats.data.audio_features || []).map((f) => [f.id, f]));

      const targV = Number(req.query.target_valence ?? 0.5);
      const targE = Number(req.query.target_energy ?? 0.5);

      const scored = tracks
        .map((t) => {
          const f = byId[t.id] || {};
          const v = f.valence ?? 0.5;
          const en = f.energy ?? 0.5;
          const score = -(Math.abs(v - targV) + Math.abs(en - targE));
          return { track: t, score };
        })
        .sort((a, b) => b.score - a.score)
        .map((x) => x.track);

      return res.json({ tracks: scored.slice(0, 20) });
    } catch (e3) {
      forwardError("RECS ERROR (search fallback)", e3);
    }

    // Final safety: small static list so your demo never blanks
    console.warn("RECS final fallback: returning static IDs");
    return res.json({
      tracks: [
        {
          id: "3AJwUDP919kvQ9QcozQPxg",
          name: "As It Was",
          uri: "spotify:track:3AJwUDP919kvQ9QcozQPxg",
          artists: [{ name: "Harry Styles" }],
          album: { name: "Harry's House" },
          external_urls: { spotify: "https://open.spotify.com/track/3AJwUDP919kvQ9QcozQPxg" },
        },
        {
          id: "7oK9VyNzrYvRFo7nQEYkWN",
          name: "Mr. Brightside",
          uri: "spotify:track:7oK9VyNzrYvRFo7nQEYkWN",
          artists: [{ name: "The Killers" }],
          album: { name: "Hot Fuss" },
          external_urls: { spotify: "https://open.spotify.com/track/7oK9VyNzrYvRFo7nQEYkWN" },
        },
      ],
    });
  } catch (e) {
    const status = e.status || e.response?.status || 500;
    res.status(status).json({ error: "recommendations failed", detail: e.response?.data || e.message });
  }
});

// ---------------- Extra fallback endpoint (optional direct use) ----------------
app.get("/api/recommendations_fallback", async (req, res) => {
  try {
    const headers = await getAuthHeaders();

    const genre = (req.query.genre || "pop").replace(/\s+/g, "-");
    const targetValence = Number(req.query.target_valence ?? 0.5);
    const targetEnergy = Number(req.query.target_energy ?? 0.5);

    const search = await axios.get("https://api.spotify.com/v1/search", {
      headers,
      params: { q: `genre:"${genre}"`, type: "track", limit: 30 },
    });
    const tracks = search.data?.tracks?.items || [];
    if (!tracks.length) return res.json({ tracks: [] });

    const ids = tracks.slice(0, 30).map((t) => t.id).join(",");
    const feats = await axios.get("https://api.spotify.com/v1/audio-features", {
      headers,
      params: { ids },
    });
    const byId = Object.fromEntries((feats.data.audio_features || []).map((f) => [f.id, f]));

    const scored = tracks
      .map((t) => {
        const f = byId[t.id] || {};
        const v = f.valence ?? 0.5;
        const en = f.energy ?? 0.5;
        const score = -(Math.abs(v - targetValence) + Math.abs(en - targetEnergy));
        return { track: t, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.track);

    res.json({ tracks: scored.slice(0, 20) });
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: "Fallback failed", detail: e.response?.data || e.message });
  }
});

// ---------------- Debug routes ----------------
app.get("/debug/recs-min", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params: { seed_genres: "pop", limit: 1 },
      httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
    });
    res.json({ ok: true, tracks: r.data.tracks?.length || 0 });
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      params: e.config?.params,
      headers: e.response?.headers,
    });
  }
});

app.get("/debug/recs-artist", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params: { seed_artists: "4NHQUGzhtTLFvgF5SZesLK", limit: 1 },
      httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
    });
    res.json({ ok: true, tracks: r.data.tracks?.length || 0 });
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      params: e.config?.params,
      headers: e.response?.headers,
    });
  }
});

// recommendations with explicit market=US and seed_genres=pop
app.get("/debug/recs-us", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params: { seed_genres: "pop", limit: 1, market: "US" },
    });
    res.json({ ok: true, tracks: r.data.tracks?.length || 0 });
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status, data: e.response?.data, url: e.config?.url,
      params: e.config?.params, headers: e.response?.headers,
    });
  }
});

// recommendations seeded by a known track (bypasses genres)
app.get("/debug/recs-track", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params: { seed_tracks: "3AJwUDP919kvQ9QcozQPxg", limit: 1, market: "US" },
    });
    res.json({ ok: true, tracks: r.data.tracks?.length || 0 });
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status, data: e.response?.data, url: e.config?.url,
      params: e.config?.params, headers: e.response?.headers,
    });
  }
});

app.get("/debug/recs-noagent", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params: { seed_genres: "pop", limit: 1 },
      // NO httpsAgent here
    });
    res.json({ ok: true, tracks: r.data.tracks?.length || 0 });
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      params: e.config?.params,
      headers: e.response?.headers,
    });
  }
});

app.get("/debug/seeds", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/recommendations/available-genre-seeds", {
      headers,
      httpsAgent: useIPv4Agent ? ipv4Agent : undefined,
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      headers: e.response?.headers,
    });
  }
});

app.get("/debug/search-pop", async (_req, res) => {
  try {
    const headers = await getAuthHeaders();
    const r = await axios.get("https://api.spotify.com/v1/search", {
      headers,
      params: { q: 'genre:"pop"', type: "track", limit: 1 }, // no market (works for you)
    });
    res.json({ ok: true, tracks: r.data.tracks?.items?.length || 0 });
  } catch (e) {
    res.status(e.response?.status || 500).json({
      status: e.response?.status,
      data: e.response?.data,
      url: e.config?.url,
      params: e.config?.params,
      headers: e.response?.headers,
    });
  }
});

app.get("/api/mood-recs", async (req, res) => {
  try {
    const headers = await getAuthHeaders();

    const raw = String(req.query.seed_genres || "pop");
    const seedGenres = raw.split(",").map(s => s.trim()).filter(Boolean);

    const limit         = Math.min(Math.max(Number(req.query.limit || 40), 20), 50);
    const targetValence = Number(req.query.target_valence ?? 0.5);
    const targetEnergy  = Number(req.query.target_energy  ?? 0.5);
    const targetDance   = Number(req.query.target_danceability ?? 0.5);
    const minTempo      = Number(req.query.min_tempo ?? 0);

    const genres = seedGenres
      .map(g => g.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!genres.length) genres.push("pop");

    const scoreTrack = (f) => {
      const v  = f?.valence ?? 0.5;
      const en = f?.energy  ?? 0.5;
      const da = f?.danceability ?? 0.5;
      const te = f?.tempo ?? 0;
      return -(Math.abs(v-targetValence)*0.40 + Math.abs(en-targetEnergy)*0.40 + Math.abs(da-targetDance)*0.15
               + (minTempo ? Math.max(0, minTempo - te)/200 : 0)*0.05);
    };

    // --- helpers inside /api/mood-recs ---

// Chunk an array
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Fetch /v1/audio-features with fallbacks:
// 1) batched (<=100) -> if 403, try per-id -> if still 403, return {}
const fetchFeaturesMap = async (tracks, headers) => {
  if (!tracks.length) return {};
  const ids = tracks.map(t => t.id);
  const batches = chunk(ids, 100);
  const map = {};

  // try batched
  try {
    for (const b of batches) {
      const r = await axios.get("https://api.spotify.com/v1/audio-features", {
        headers, params: { ids: b.join(",") }
      });
      (r.data.audio_features || []).forEach(f => { if (f?.id) map[f.id] = f; });
    }
    return map;
  } catch (e) {
    console.error("AF batch failed:", e.response?.status, e.response?.data || e.message);
  }

  // fallback: try one-by-one (best-effort)
  try {
    for (const id of ids) {
      try {
        const r = await axios.get(`https://api.spotify.com/v1/audio-features/${id}`, { headers });
        if (r.data?.id) map[r.data.id] = r.data;
      } catch (e1) {
        // swallow individual failures
      }
    }
    return map;
  } catch (e) {
    console.error("AF per-id failed:", e.response?.status, e.response?.data || e.message);
    // final fallback: no features
    return {};
  }
};


    const tryTrackSearch = async () => {
      const q = genres.map(g => `genre:"${g}"`).join(" OR ");
      try {
        const s = await axios.get("https://api.spotify.com/v1/search", {
          headers, params: { q, type: "track", limit }
        });
        return s.data?.tracks?.items || [];
      } catch (e) {
        const status = e.response?.status; const msg = e.response?.data || e.message;
        console.error("SEARCH(track) 403?", status, msg, { q });
        throw { step: "search-track", status, msg, q };
      }
    };

    const tryArtistTopTracks = async () => {
      const g = genres[0];
      try {
        const a = await axios.get("https://api.spotify.com/v1/search", {
          headers, params: { q: `genre:"${g}"`, type: "artist", limit: 5 }
        });
        const artists = a.data?.artists?.items || [];
        let pool = [];
        for (const art of artists) {
          try {
            const tt = await axios.get(`https://api.spotify.com/v1/artists/${art.id}/top-tracks`, {
              headers, params: { market: "from_token" }
            });
            pool = pool.concat(tt.data?.tracks || []);
          } catch (e) {
            const status = e.response?.status; const msg = e.response?.data || e.message;
            console.error("ARTIST TOP-TRACKS 403?", status, msg, { artist: art.id });
          }
          if (pool.length >= limit) break;
        }
        return pool.slice(0, limit);
      } catch (e) {
        const status = e.response?.status; const msg = e.response?.data || e.message;
        console.error("SEARCH(artist) 403?", status, msg, { g });
        return [];
      }
    };

    // Build pool with fallbacks
    let pool = [];
    try { pool = await tryTrackSearch(); } catch (_) { /* fall through */ }
    if (!pool.length) pool = await tryArtistTopTracks();
    if (!pool.length) {
      // Loose text fallback
      const q = "chill calm mellow"; // neutral default
      try {
        const s = await axios.get("https://api.spotify.com/v1/search", {
          headers, params: { q, type: "track", limit }
        });
        pool = s.data?.tracks?.items || [];
      } catch (e) {
        const status = e.response?.status; const msg = e.response?.data || e.message;
        console.error("SEARCH(loose) 403?", status, msg);
      }
    }
    if (!pool.length) return res.json({ tracks: [] });

    const byId = await fetchFeaturesMap(pool, headers);

    const ranked = pool
      .map(t => ({ t, s: scoreTrack(byId[t.id]) }))
      .sort((a,b) => b.s - a.s)
      .map(x => x.t);

    res.json({ tracks: ranked.slice(0, 20) });
  } catch (e) {
    return res.status(e.status || e.response?.status || 500).json({
      error: "mood-recs failed",
      step: e.step || undefined,
      detail: e.msg || e.response?.data || e.message || e
    });
  }
});




// ---------------- Health ----------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------- Listen ----------------
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
