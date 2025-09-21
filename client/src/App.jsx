// src/App.jsx
import { useState } from "react";
import PlaylistCreator from "./PlaylistCreator";
import EmotionDetector from "./EmotionDetector";

export default function App() {
  const [cameraMood, setCameraMood] = useState(null);
  const [useCamera, setUseCamera] = useState(true);

  return (
    <div style={{ maxWidth: 1200, margin: "24px auto", padding: 16 }}>
      <h1>Mood DJ</h1>

      <label style={{ display: "block", marginBottom: 12 }}>
        <input type="checkbox" checked={useCamera} onChange={(e) => setUseCamera(e.target.checked)} />
        &nbsp;Use camera mood
      </label>

      {useCamera && (
        <div style={{ marginBottom: 24 }}>
          <EmotionDetector onChange={setCameraMood} />
        </div>
      )}

      <PlaylistCreator forcedEmotion={cameraMood} useCamera={useCamera} />
    </div>
  );
}
