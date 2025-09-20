// server.js
// --- Boot & networking prefs (fixes odd 404s on some networks) ---
import dns from "dns";
import https from "https";
dns.setDefaultResultOrder("ipv4first");                 // prefer IPv4
const ipv4Agent = new https.Agent({ family: 4 });       // reuse one IPv4 agent

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
let accessTokens = {}; // { demo: { access_token, refresh_token, ... } }
const authHeader = () => ({ Authorization: `Bearer ${accessTokens.demo?.access_token || ""}` });

// ---------------- OAuth ----------------
app.get("/login", (req, res) => {
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

    accessTokens.demo = tokenRes.data; // { access_token, refresh_token, ... }
    res.json({ ok: true });
  } catch (e) {
    console.error("TOKEN ERROR:", e.response?.status, e.response?.data || e.message);
    res.status(400).json({ error: "Token exchange failed" });
  }
});

// ---------------- API helpers ----------------
app.get("/api/me", async (_req, res) => {
  try {
    const r = await axios.get("https://api.spotify.com/v1/me", { headers: authHeader() });
    res.json({ id: r.data.id, product: r.data.product, country: r.data.country });
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || e.message);
  }
});

app.get("/api/available-genres", async (_req, res) => {
  try {
    const r = await axios.get(
      "https://api.spotify.com/v1/recommendations/available-genre-seeds",
      { headers: authHeader(), httpsAgent: ipv4Agent } // <-- force IPv4 here
    );
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || e.message);
  }
});

// ---------------- Recommendations (robust) ----------------
app.get("/api/recommendations", async (req, res) => {
  if (!accessTokens.demo?.access_token) {
    return res.status(401).json({ error: "Not authorized. Click Re-connect Spotify." });
  }

  const headers = { ...authHeader(), Accept: "application/json" };

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

  // Primary: Spotify recommendations (force IPv4 agent)
  try {
    console.log("RECS primary params ->", params);
    const r1 = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params,
      httpsAgent: ipv4Agent,
    });
    return res.json(r1.data);
  } catch (e1) {
    forwardError("RECS ERROR (primary)", e1, { PARAMS: params });
  }

  // Fallback 1: artist-seeded recs (same endpoint, different seeds)
  try {
    const p2 = { limit: params.limit, market: params.market, seed_artists: "4NHQUGzhtTLFvgF5SZesLK" };
    console.log("RECS fallback artist params ->", p2);
    const r2 = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers,
      params: p2,
      httpsAgent: ipv4Agent,
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
      headers,
      params: { q: `genre:"${genre}"`, type: "track", limit: params.limit },
    });
    const tracks = s.data?.tracks?.items || [];
    if (!tracks.length) return res.json({ tracks: [] });

    const ids = tracks.map((t) => t.id).join(",");
    const feats = await axios.get("https://api.spotify.com/v1/audio-features", {
      headers,
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
});

// ---------------- Extra fallback endpoint (optional direct use) ----------------
app.get("/api/recommendations_fallback", async (req, res) => {
  if (!accessTokens.demo?.access_token) {
    return res.status(401).json({ error: "Not authorized. Click Re-connect Spotify." });
  }
  const headers = authHeader();

  const genre = (req.query.genre || "pop").replace(/\s+/g, "-");
  const targetValence = Number(req.query.target_valence ?? 0.5);
  const targetEnergy = Number(req.query.target_energy ?? 0.5);

  try {
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
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers: authHeader(),
      params: { seed_genres: "pop", limit: 1 },
      httpsAgent: ipv4Agent, // <— crucial
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
    const r = await axios.get("https://api.spotify.com/v1/recommendations", {
      headers: authHeader(),
      params: { seed_artists: "4NHQUGzhtTLFvgF5SZesLK", limit: 1 },
      httpsAgent: ipv4Agent, // <— crucial
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
    const r = await axios.get("https://api.spotify.com/v1/recommendations/available-genre-seeds", {
      headers: authHeader(),
      httpsAgent: ipv4Agent, // <— crucial
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
    const r = await axios.get("https://api.spotify.com/v1/search", {
      headers: authHeader(),
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

// ---------------- Health ----------------
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------------- Listen ----------------
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));

