// ===================== DOM ELEMENTS =====================
const video = document.getElementById("video");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusDiv = document.getElementById("status");
const videoContainer = document.getElementById("video-container");

const feedbackContainer = document.getElementById("feedback-container");
const predictedSpan = document.getElementById("predicted-emotion-text");
const containerEmoji = document.getElementById("container-emoji");
const songList = document.getElementById("song-list");

// ===================== CONSTANTS =====================
const DISPLAY_WIDTH = 720;
const DISPLAY_HEIGHT = 560;
const ANALYSIS_DURATION = 5000;

const HAND_CONNECTIONS = window.HAND_CONNECTIONS;

// ===================== GLOBAL STATE =====================
let canvas;
let handDetector;
let currentFaceDetections = [];
let currentHandLandmarks = [];
let lastFaceBox = null;
let isHandBlocking = false;
let analysisState = "IDLE";
let clearFaceTime = 0;
let lastTick = 0;
let emotionCounter = {};

// ===================== HELPERS =====================
function videoDims() {
  return {
    w: video.videoWidth,
    h: video.videoHeight,
  };
}

// ===================== LOAD MODELS =====================
async function loadModels() {
  statusDiv.textContent = "Loading models...";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
    faceapi.nets.faceExpressionNet.loadFromUri("/models"),
  ]);
}

// ===================== HAND DETECTOR =====================
async function setupHandDetector() {
  handDetector = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
  });

  handDetector.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.6,
  });

  handDetector.onResults((results) => {
    currentHandLandmarks = results.multiHandLandmarks || [];
  });
}

// ===================== DRAW LOOP =====================
function startUnifiedDrawLoop() {
  if (!canvas) {
    canvas = faceapi.createCanvasFromMedia(video);
    videoContainer.appendChild(canvas);
  }

  const ctx = canvas.getContext("2d");

  function drawFrame() {
    const { w, h } = videoDims();

    canvas.width = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);

    // ---------- FACE ----------
    if (currentFaceDetections.length) {
      const resized = faceapi.resizeResults(
        currentFaceDetections,
        { width: w, height: h }
      );

      faceapi.draw.drawDetections(canvas, resized);
      faceapi.draw.drawFaceLandmarks(canvas, resized);
      lastFaceBox = resized[0].detection.box;
    } else {
      lastFaceBox = null;
    }

    // ---------- HANDS ----------
    isHandBlocking = false;

    for (const landmarks of currentHandLandmarks) {
      const overlap = lastFaceBox
        ? checkHandFaceOverlap(landmarks, lastFaceBox)
        : false;

      if (overlap) isHandBlocking = true;

      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {
        color: overlap ? "#ff0000" : "#00ff88",
        lineWidth: 4,
      });

      drawLandmarks(ctx, landmarks, {
        color: "#ffffff",
        radius: 3,
      });

      drawHandBoundingBox(ctx, landmarks, overlap);
    }

    // ---------- STATUS ----------
    ctx.font = "bold 26px Arial";
    if (isHandBlocking) {
      ctx.fillStyle = "red";
      ctx.fillText("✋ HAND BLOCKING FACE", 30, 40);
    } else if (analysisState === "ANALYZING") {
      ctx.fillStyle = "lime";
      ctx.fillText(
        `ANALYZING... ${(clearFaceTime / 1000).toFixed(1)}s`,
        30,
        40
      );
    }

    requestAnimationFrame(drawFrame);
  }

  drawFrame();
}

// ===================== OVERLAP + DRAW =====================
function checkHandFaceOverlap(landmarks, faceBox) {
  const { w, h } = videoDims();

  const xs = landmarks.map((p) => p.x * w);
  const ys = landmarks.map((p) => p.y * h);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return (
    faceBox.x < maxX &&
    faceBox.x + faceBox.width > minX &&
    faceBox.y < maxY &&
    faceBox.y + faceBox.height > minY
  );
}

function drawHandBoundingBox(ctx, landmarks, overlap) {
  const { w, h } = videoDims();

  const xs = landmarks.map((p) => p.x * w);
  const ys = landmarks.map((p) => p.y * h);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  ctx.strokeStyle = overlap ? "#ff0000" : "#00ff88";
  ctx.lineWidth = 2;
  ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
}

// ===================== DATA UPDATES =====================
async function updateFaceData() {
  currentFaceDetections = await faceapi
    .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks();

  setTimeout(updateFaceData, 100);
}

async function updateHandData() {
  if (handDetector && video.videoWidth) {
    await handDetector.send({ image: video });
  }
  requestAnimationFrame(updateHandData);
}

// ===================== SPOTIFY =====================
async function fetchSpotifyTracks(emotion) {
  const res = await fetch("/analyzeEmotion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emotion }),
  });

  const songs = await res.json();

  songList.innerHTML =
    `<h3>🎵 Based on ${emotion.toUpperCase()}</h3>` +
    songs
      .map(
        (s) => `
        <li>
          <b>${s.title}</b> - ${s.artist}
          <iframe
            src="https://open.spotify.com/embed/track/${
              s.spotify_url.split("/track/")[1]
            }"
            width="100%" height="80">
          </iframe>
        </li>`
      )
      .join("");
}

// ===================== EMOTION ANALYSIS =====================
function startEmotionAnalysis() {
  analysisState = "ANALYZING";
  clearFaceTime = 0;
  emotionCounter = {};
  lastTick = Date.now();

  analyzeBtn.disabled = true;
  feedbackContainer.style.display = "none";
  songList.innerHTML = "";

  const interval = setInterval(async () => {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;

    if (isHandBlocking || !lastFaceBox) {
      analysisState = "PAUSED";
      statusDiv.textContent = "✋ Face blocked — paused";
      return;
    }

    analysisState = "ANALYZING";
    clearFaceTime += delta;
    statusDiv.textContent =
      `Analyzing... ${(clearFaceTime / 1000).toFixed(1)} / 5.0s`;

    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceExpressions();

    if (detections.length) {
      const expr = detections[0].expressions;
      const best = Object.keys(expr).reduce((a, b) =>
        expr[a] > expr[b] ? a : b
      );
      emotionCounter[best] = (emotionCounter[best] || 0) + 1;
    }

    if (clearFaceTime >= ANALYSIS_DURATION) {
      clearInterval(interval);
      analysisState = "FINISHED";

      const finalEmotion = Object.keys(emotionCounter).reduce((a, b) =>
        emotionCounter[a] > emotionCounter[b] ? a : b
      );

      const emojiMap = {
        happy: "😊",
        sad: "😢",
        angry: "😠",
        surprised: "😲",
        neutral: "😐",
        fearful: "😨",
        disgusted: "🤢",
      };

      predictedSpan.textContent = finalEmotion.toUpperCase();
      containerEmoji.textContent = emojiMap[finalEmotion] || "🤔";
      feedbackContainer.style.display = "block";

      await fetchSpotifyTracks(finalEmotion);

      analyzeBtn.disabled = false;
      statusDiv.textContent = `✅ Dominant emotion: ${finalEmotion}`;
    }
  }, 300);
}

// ===================== SETUP =====================
async function setup() {
  await loadModels();
  await setupHandDetector();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
  });

  video.srcObject = stream;

  video.onloadedmetadata = () => {
    startUnifiedDrawLoop();
    updateFaceData();
    updateHandData();
  };

  analyzeBtn.onclick = startEmotionAnalysis;
  analyzeBtn.disabled = false;
  analyzeBtn.textContent = "Analyze Face";
}

setup();
