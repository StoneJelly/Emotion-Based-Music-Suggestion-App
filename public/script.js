const video = document.getElementById("video");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusDiv = document.getElementById("status");
const videoContainer = document.getElementById("video-container");

const feedbackContainer = document.getElementById("feedback-container");
const predictedSpan = document.getElementById("predicted-emotion-text");
const containerEmoji = document.getElementById("container-emoji");
const btnYes = document.getElementById("btn-yes");
const btnNo = document.getElementById("btn-no");
const songList = document.getElementById("song-list");

const VIDEO_WIDTH = 720;
const VIDEO_HEIGHT = 560;
const ANALYSIS_DURATION = 5000;

video.width = VIDEO_WIDTH;
video.height = VIDEO_HEIGHT;

let canvas = null;
let handDetector = null;
let currentFaceDetections = [];
let currentHandLandmarks = [];
let lastFaceBox = null;
let isHandBlocking = false;
let analysisState = "IDLE"; 
let clearFaceTime = 0;
let lastTick = 0;
let emotionCounter = {};

async function loadModels() {
  statusDiv.textContent = "Loading models...";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
    faceapi.nets.faceExpressionNet.loadFromUri("/models"),
  ]);

  statusDiv.textContent = "Models loaded.";
}

async function setupHandDetector() {
  handDetector = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
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

// ====================================================================
// UNMODIFIED DRAW LOOP (Face & Hand Frames)
// ====================================================================
function startUnifiedDrawLoop() {
  if (!canvas) {
    canvas = faceapi.createCanvasFromMedia(video);
    videoContainer.append(canvas);
    faceapi.matchDimensions(canvas, { width: VIDEO_WIDTH, height: VIDEO_HEIGHT });
  }

  const ctx = canvas.getContext("2d");

  function drawFrame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentFaceDetections.length > 0) {
      const resized = faceapi.resizeResults(currentFaceDetections, { width: VIDEO_WIDTH, height: VIDEO_HEIGHT });
      faceapi.draw.drawDetections(canvas, resized);
      faceapi.draw.drawFaceLandmarks(canvas, resized);
      lastFaceBox = resized[0].detection.box;
    } else {
      lastFaceBox = null;
    }

    isHandBlocking = false;
    if (currentHandLandmarks.length > 0) {
      for (const landmarks of currentHandLandmarks) {
        const overlap = lastFaceBox ? checkHandFaceOverlap(landmarks, lastFaceBox) : false;
        if (overlap) isHandBlocking = true;
        const color = overlap ? '#FF0000' : '#00FF00'; 
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: color, lineWidth: 4 });
        drawLandmarks(ctx, landmarks, { color: '#FFFFFF', lineWidth: 1 });
      }
    }

    ctx.font = "bold 26px Arial";
    if (isHandBlocking) {
      ctx.fillStyle = "red";
      ctx.fillText("✋ HAND BLOCKING FACE", 40, 50);
    } else if (analysisState === "ANALYZING") {
      ctx.fillStyle = "lime";
      ctx.fillText(`ANALYZING... ${(clearFaceTime / 1000).toFixed(1)}s`, 40, 50);
    }

    requestAnimationFrame(drawFrame);
  }
  drawFrame();
}

function checkHandFaceOverlap(landmarks, faceBox) {
  const xCoords = landmarks.map(p => p.x * VIDEO_WIDTH);
  const yCoords = landmarks.map(p => p.y * VIDEO_HEIGHT);
  const minX = Math.min(...xCoords);
  const maxX = Math.max(...xCoords);
  const minY = Math.min(...yCoords);
  const maxY = Math.max(...yCoords);
  return faceBox.x < maxX && faceBox.x + faceBox.width > minX &&
         faceBox.y < maxY && faceBox.y + faceBox.height > minY;
}

async function updateFaceData() {
  const allDetections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
  
  if (allDetections.length > 0) {
    currentFaceDetections = [allDetections.sort((a, b) =>
    (b.detection.box.width * b.detection.box.height) - (a.detection.box.width * a.detection.box.height)
    )[0]];
  } else {
    currentFaceDetections = [];
  }

  setTimeout(updateDaceData, 100);
}

async function updateHandData() {
  if (handDetector && video.srcObject) { await handDetector.send({ image: video }); }
  requestAnimationFrame(updateHandData);
}

// ====================================================================
// ANALYSIS & SPOTIFY
// ====================================================================
async function fetchSpotifyTracks(emotion) {
  const res = await fetch("/analyzeEmotion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emotion }),
  });

  const songs = await res.json();
  songList.innerHTML = songs.map((s) => `
    <li style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px;">
      <div style="font-weight: bold; font-size: 0.9rem; margin-bottom: 5px; color: #333;">
        ${s.title} <span style="font-weight: normal; color: #666;">- ${s.artist}</span>
      </div>
      <iframe 
        src="https://open.spotify.com/embed/track/${s.spotify_url.split("/track/")[1]}" 
        width="100%" 
        height="80" 
        frameborder="0" 
        allow="encrypted-media">
      </iframe>
    </li>
  `).join("");
}

function startEmotionAnalysis() {
  analysisState = "ANALYZING";
  clearFaceTime = 0;
  emotionCounter = {};
  lastTick = Date.now();
  analyzeBtn.disabled = true;
  feedbackContainer.style.display = "none";
  songList.innerHTML = "";

  const analysisInterval = setInterval(async () => {
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;

    if (isHandBlocking || !lastFaceBox) {
      analysisState = "PAUSED";
      statusDiv.textContent = "✋ Face blocked — timer paused";
      return;
    }

    analysisState = "ANALYZING";
    clearFaceTime += delta;
    statusDiv.textContent = `Analyzing... ${(clearFaceTime / 1000).toFixed(1)} / 5.0s`;

    const allDetections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();

    if (allDetections.length) {
      const primaryFace = allDetections.sort((a, b) =>
      (b.detection.box.width * b.detection.box.height) - (a.detection.box.width * a.detection.box.height)
    )[0];

      let bestEmotion = "";
      let maxVal = 0;
      for (const e in primaryFace.expressions) {
        if (primaryFace.expressions[e] > maxVal) {
          maxVal = primaryFace.expressions[e];
          bestEmotion = e;
        }
      }
      emotionCounter[bestEmotion] = (emotionCounter[bestEmotion] || 0) + 1;
    }

    if (clearFaceTime >= ANALYSIS_DURATION) {
      clearInterval(analysisInterval);
      analysisState = "FINISHED";
      const finalEmotion = Object.keys(emotionCounter).reduce((a, b) => emotionCounter[a] > emotionCounter[b] ? a : b);

      // Trigger Container and Spotify at the same time
      const emojiMap = { happy: "😊", sad: "😢", angry: "😠", surprised: "😲", neutral: "😐", fearful: "😨", disgusted: "🤢" };
      predictedSpan.textContent = finalEmotion.toUpperCase();
      containerEmoji.textContent = emojiMap[finalEmotion] || "🤔";
      feedbackContainer.style.display = "block";

      await fetchSpotifyTracks(finalEmotion);

      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Analyze Face";
      statusDiv.textContent = `✅ Dominant emotion: ${finalEmotion}`;
      
      btnYes.onclick = async () => {
        await sendFeedbackToFirebase(finalEmotion, "success");
        feedbackContainer.style.display = "none";
        statusDiv.textContent = "Feedback saved: Successful! ✅";
      };

      btnNo.onclick = async () => {
        await sendFeedbackToFirebase(finalEmotion, "failed");
        feedbackContainer.style.display = "none";
        statusDiv.textContent = "Feedback saved: Failed! ❌. Try again!";
      };

      // Function to send feedback to Firebase
      async function sendFeedbackToFirebase(emotion, result) {
        try {
          const response =  await fetch('/saveFeedback', {
            method: 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              emotion: emotion,
              status: result,
              timestamp: new Date().toISOString()
            }),
          });
          const data = await response.json();
          console.log("Firebase sync", data.message);
        } catch (error) {
          console.error("Error sending feedback:", error);
        }
      }
    }
  }, 300);
}

async function setup() {
  await loadModels();
  await setupHandDetector();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } });
  video.srcObject = stream;
  analyzeBtn.disabled = false;
  analyzeBtn.textContent = "Analyze Face";
  video.onplaying = () => {
    startUnifiedDrawLoop();
    updateFaceData();
    updateHandData();
  };
  analyzeBtn.onclick = startEmotionAnalysis;
}

setup();