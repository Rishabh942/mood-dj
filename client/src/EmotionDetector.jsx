// src/EmotionDetector.jsx
import React, { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";

export default function EmotionDetector({ onChange }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [recentMood, setRecentMood] = useState("Detecting...");
  const [oneMinuteMood, setOneMinuteMood] = useState("Detecting...");

  const emotionWindow = []; // short-term smoothing
  const emotionHistory = []; // 1-minute history

  const FRAME_INTERVAL = 10;
  const CONFIDENCE_THRESHOLD = 0.3;

  const emotionPriority = {angry: 1.5, sad: 1.5, fearful: 5, disgusted: 8, happy: 1.2, surprised: 4, neutral: 0.1,};
  const mapForPlaylist = (e) => ({ disgusted: "disgust", fearful: "fearful", surprised: "surprised" }[e] || e);

  useEffect(() => {
    async function startVideo() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
    }
    startVideo();
  }, []);

  useEffect(() => {
    async function loadModels() {
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      await faceapi.nets.faceExpressionNet.loadFromUri("/models");
      console.log("Models loaded");
    }
    loadModels();
  }, []);

  useEffect(() => {
    let frameCount = 0;

    const interval = setInterval(async () => {
      if (!videoRef.current || videoRef.current.paused) return;

      frameCount++;
      const video = videoRef.current;

      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions();

      if (frameCount % FRAME_INTERVAL === 0 && detections.length > 0) {
        const expressions = detections[0].expressions;
        const topEmotion = Object.keys(expressions).reduce((a, b) =>
          expressions[a] > expressions[b] ? a : b
        );
        const confidence = expressions[topEmotion];

        if (confidence >= CONFIDENCE_THRESHOLD) {
          emotionWindow.push(topEmotion);
          if (emotionWindow.length > 10) emotionWindow.shift();

          emotionHistory.push({ emotion: topEmotion, ts: Date.now() });
        }
      }

      // Short-term
      if (onChange && smoothedEmotion && smoothedEmotion !== "Detecting...") {
        onChange(mapForPlaylist(smoothedEmotion));
      }

      // Long-term 1-minute
      const now = Date.now();
      while (emotionHistory.length > 0 && now - emotionHistory[0].ts > 60000) {
        emotionHistory.shift();
      }
      let oneMinEmotion = "Detecting...";
      if (emotionHistory.length > 0) {
        const counts = {};
        emotionHistory.forEach(({ emotion }) => (counts[emotion] = (counts[emotion] || 0) + 1));
        const weighted = {};
        for (let e in counts) weighted[e] = counts[e] * (emotionPriority[e] || 1);
        oneMinEmotion = Object.keys(weighted).reduce((a, b) =>
          weighted[a] > weighted[b] ? a : b
        );
      }
      setOneMinuteMood(oneMinEmotion);

      // Draw canvas
      const canvas = canvasRef.current;
      if (canvas) {
        faceapi.matchDimensions(canvas, { width: video.videoWidth, height: video.videoHeight });
        const resizedDetections = faceapi.resizeResults(detections, {
          width: video.videoWidth,
          height: video.videoHeight,
        });
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        faceapi.draw.drawDetections(canvas, resizedDetections);
        faceapi.draw.drawFaceExpressions(canvas, resizedDetections);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <video ref={videoRef} autoPlay muted width="720" height="560" style={{ borderRadius: "8px" }} />
      <canvas ref={canvasRef} width="720" height="560" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
      <div style={{ marginTop: "10px" }}>
        <h2>Recent Mood: {recentMood}</h2>
        <h2>1-Min Mood: {oneMinuteMood}</h2>
      </div>
    </div>
  );
}
