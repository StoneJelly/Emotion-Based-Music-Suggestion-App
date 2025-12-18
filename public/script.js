// ====================================================================
// DOM REFERENCES & CONSTANTS
// ====================================================================
const video = document.getElementById("video");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusDiv = document.getElementById("status");
const videoContainer = document.getElementById("video-container");

const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 560;
const ANALYSIS_DURATION = 5000;

video.width = VIDEO_WIDTH;
video.height = VIDEO_HEIGHT;

// ====================================================================
// GLOBAL STATE
// ====================================================================
let stream = null;
let canvas = null;
let faceLoop = null;

let handDetector = null;
let lastFaceBox = null;
let isHandBlocking = false;

// ---- ANALYSIS STATE MACHINE ----
let analysisState = "IDLE"; // IDLE | ANALYZING | PAUSED | FINISHED
let clearFaceTime = 0;
let lastTick = 0;
let emotionCounter = {};

// ====================================================================
// LOAD MODELS
// ====================================================================
async function loadModels() {
  statusDiv.textContent = "Loading models...";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
    faceapi.nets.faceExpressionNet.loadFromUri("/models"),
  ]);
}

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

  handDetector.onResults(onHandResults);
}

// ====================================================================
// CAMERA
// ====================================================================
async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
  });
  video.srcObject = stream;
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

// ====================================================================
// FACE LOOP (DRAW + FACE BOX)
// ====================================================================
async function startFaceLoop() {
  canvas = faceapi.createCanvasFromMedia(video);
  videoContainer.append(canvas);
  faceapi.matchDimensions(canvas, {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
  });

  faceLoop = setInterval(async () => {
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks();

    const resized = faceapi.resizeResults(detections, {
      width: VIDEO_WIDTH,
      height: VIDEO_HEIGHT,
    });

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    faceapi.draw.drawDetections(canvas, resized);
    faceapi.draw.drawFaceLandmarks(canvas, resized);

    lastFaceBox = resized.length ? resized[0].detection.box : null;

    ctx.font = "26px Arial";
    if (analysisState === "PAUSED") {
      ctx.fillStyle = "red";
      ctx.fillText("✋ REMOVE HAND FROM FACE", 40, 50);
    } else if (analysisState === "ANALYZING") {
      ctx.fillStyle = "lime";
      ctx.fillText("FACE CLEAR", 40, 50);
    }
  }, 100);
}

// ====================================================================
// HAND DETECTION LOOP
// ====================================================================
async function detectHands() {
  if (!handDetector || !video.srcObject) return;
  await handDetector.send({ image: video });
  requestAnimationFrame(detectHands);
}

function onHandResults(results) {
  isHandBlocking = false;
  if (!lastFaceBox || !results.multiHandLandmarks?.length) return;

  const w = canvas.width;
  const h = canvas.height;

  for (const hand of results.multiHandLandmarks) {
    let minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;

    hand.forEach((p) => {
      const x = p.x * w;
      const y = p.y * h;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });

    const overlap =
      lastFaceBox.x < maxX &&
      lastFaceBox.x + lastFaceBox.width > minX &&
      lastFaceBox.y < maxY &&
      lastFaceBox.y + lastFaceBox.height > minY;

    if (overlap) {
      isHandBlocking = true;
      break;
    }
  }
}

// ====================================================================
// EMOTION ANALYSIS (HAND-AWARE)
// ====================================================================
function startEmotionAnalysis() {
  analysisState = "ANALYZING";
  clearFaceTime = 0;
  emotionCounter = {};
  lastTick = Date.now();

  analyzeBtn.disabled = true;
  statusDiv.textContent = "Analyzing emotion...";

  const analysisInterval = setInterval(async () => {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;

    // ---------- HAND BLOCK → PAUSE ----------
    if (isHandBlocking || !lastFaceBox) {
      analysisState = "PAUSED";
      statusDiv.textContent = "✋ Face blocked — timer paused";
      return;
    }

    // ---------- RESUME ----------
    if (analysisState === "PAUSED") {
      analysisState = "ANALYZING";
      lastTick = Date.now();
      return;
    }

    // ---------- COUNT VALID TIME ----------
    clearFaceTime += delta;
    statusDiv.textContent = `Analyzing... ${(clearFaceTime / 1000).toFixed(
      1
    )} / 5.0s`;

    // ---------- EMOTION DETECTION ----------
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceExpressions();

    if (!detections.length) return;

    let bestEmotion = "";
    let maxVal = 0;
    for (const e in detections[0].expressions) {
      if (detections[0].expressions[e] > maxVal) {
        maxVal = detections[0].expressions[e];
        bestEmotion = e;
      }
    }

    emotionCounter[bestEmotion] =
      (emotionCounter[bestEmotion] || 0) + 1;

    // ---------- FINISH ----------
    if (clearFaceTime >= ANALYSIS_DURATION) {
      clearInterval(analysisInterval);
      analysisState = "FINISHED";

      const finalEmotion = Object.keys(emotionCounter).reduce((a, b) =>
        emotionCounter[a] > emotionCounter[b] ? a : b
      );

      await fetchSpotifyTracks(finalEmotion);

      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Analyze Face";
      statusDiv.textContent = `✅ Dominant emotion: ${finalEmotion}`;
    }
  }, 300);
}

// ====================================================================
// BACKEND (SPOTIFY)
// ====================================================================
async function fetchSpotifyTracks(emotion) {
  const res = await fetch("/analyzeEmotion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emotion }),
  });

  const songs = await res.json();
  const list = document.querySelector("#suggested-songs ul");

  list.innerHTML =
    `<h3>🎵 Based on ${emotion.toUpperCase()}</h3>` +
    songs
      .map(
        (s) => `
      <li>
        <b>${s.title}</b> - ${s.artist}
        <iframe src="https://open.spotify.com/embed/track/${
          s.spotify_url.split("/track/")[1]
        }" width="100%" height="80"></iframe>
      </li>
    `
      )
      .join("");
}

// ====================================================================
// INIT
// ====================================================================
async function setup() {
  analyzeBtn.disabled = true;
  await loadModels();
  await setupHandDetector();
  await startCamera();

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = "Analyze Face";

  video.onplaying = () => {
    startFaceLoop();
    detectHands();
  };

  analyzeBtn.onclick = startEmotionAnalysis;
}

setup();
