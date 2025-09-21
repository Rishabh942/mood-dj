// src/PlaylistCreator.jsx
import { useEffect, useState } from "react";
import axios from "axios";
import { EMOTION_TO_FEATURES } from "./emotionMap";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8080";

export default function PlaylistCreator({ forcedEmotion, useCamera = true }) {
  const [tracks, setTracks] = useState([]);
  const [emotion, setEmotion] = useState(forcedEmotion || "neutral");
  const [mode, setMode] = useState("match"); // "match" or "change"
  const [authed, setAuthed] = useState(false);

  console.warn("1")

  useEffect(() => {
   if (useCamera && forcedEmotion) setEmotion(forcedEmotion);
  }, [forcedEmotion, useCamera]);

  console.warn("2")

  const connectSpotify = () => {
    // allow a fresh exchange on every login click
    sessionStorage.removeItem("code_exchanged");
    window.location.href = `${API}/login`;
  };

  const getRecs = async () => {
    const base = EMOTION_TO_FEATURES[emotion] || EMOTION_TO_FEATURES.neutral;
    const flip = (v) => 1 - v;

    const params = new URLSearchParams({
      seed_genres: base.seed_genres,
      target_valence: (
        mode === "change" ? flip(base.target_valence) : base.target_valence
      ).toString(),
      target_energy: (
        mode === "change"
          ? Math.max(0, Math.min(1, 1 - base.target_energy + 0.1))
          : base.target_energy
      ).toString(),
      target_danceability: base.target_danceability.toString(),
      min_tempo: String(base.min_tempo),
    });

    const r = await axios.get(`${API}/api/mood-recs?${params.toString()}`);
    setTracks(r.data.tracks || []);
  };

  console.warn("3")

  const createPlaylist = async () => {
    const uris = tracks.map((t) => t.uri);
    const r = await axios.post(`${API}/api/create-playlist`, {
      uris,
      name: `Mood DJ - ${emotion}`,
    });
    alert(`Playlist created!\n${r.data.url}`);
  };

  return (
    <div style={{ maxWidth: 900, margin: "32px auto", fontFamily: "Inter, system-ui" }}>
      <h1>Mood DJ</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={connectSpotify}>
          {authed ? "Re-connect Spotify" : "Connect Spotify"}
        </button>

        <label>
          Mood:&nbsp;
          <select value={emotion} onChange={(e) => setEmotion(e.target.value)}>
            {Object.keys(EMOTION_TO_FEATURES).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <button onClick={() => setMode((m) => (m === "match" ? "change" : "match"))}>
          Mode: {mode === "match" ? "Match my mood" : "Change my mood"}
        </button>

        <button onClick={getRecs}>Get Recommendations</button>
        {tracks.length > 0 && <button onClick={createPlaylist}>Save as Playlist</button>}
      </div>

      <div style={{ marginTop: 24 }}>
        <h2>Tracks</h2>
        {tracks.length === 0 && (
          <p>No tracks yet. Connect Spotify, pick a mood, then “Get Recommendations.”</p>
        )}
        {tracks.map((t) => (
          <div
            key={t.id}
            style={{ padding: 12, border: "1px solid #333", borderRadius: 8, marginBottom: 10 }}
          >
            <div>
              <b>{t.name}</b> — {t.artists.map((a) => a.name).join(", ")}
            </div>
            <div>Album: {t.album.name}</div>
            <a href={t.external_urls.spotify} target="_blank" rel="noreferrer">
              Open in Spotify
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
