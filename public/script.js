const video = document.getElementById('video');

async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    faceapi.nets.faceExpressionNet.loadFromUri('/models')
  ]);
}

async function startVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
    video.srcObject = stream;
  } catch (err) {
    console.error(err);
  }
}

async function detectFaces() {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);

  // Position overlay correctly
  const displaySize = { width: video.videoWidth, height: video.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);

  // Style positioning
  canvas.style.position = "absolute";
  canvas.style.top = video.offsetTop + "px";
  canvas.style.left = video.offsetLeft + "px";
  canvas.style.zIndex = "10";

  setInterval(async () => {
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
      .withFaceLandmarks()
      .withFaceExpressions();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!resizedDetections.length) return;

    // Only draw a clean rectangle around the face
    const box = resizedDetections[0].detection.box;
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#00FF88";
    ctx.stroke();

    // Calculate dominant emotion
    const emotions = resizedDetections[0].expressions;
    const dominantEmotion = Object.keys(emotions).reduce((a, b) =>
      emotions[a] > emotions[b] ? a : b
    );
    const confidence = emotions[dominantEmotion].toFixed(2);

    // Draw emotion label neatly
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(box.x, box.y - 30, box.width, 25);
    ctx.fillStyle = "white";
    ctx.font = "18px Poppins";
    ctx.fillText(`${dominantEmotion} (${confidence})`, box.x + 5, box.y - 12);

    // Send emotion to server (only if confident enough)
    if (confidence > 0.8) {
      fetch("/analyzeEmotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emotion: dominantEmotion }),
      })
        .then((response) => response.json())
        .then((suggestedSongs) => {
          const suggestedSongsList = document.getElementById("suggested-songs");
          const songsHTML = suggestedSongs
            .map(
              (song) => `
              <li>
                <h3>${song.title}</h3>
                <p>Artist: ${song.artist}</p>
                <p>Genre: ${song.genre}</p>
                <audio controls>
                  <source src="/music/${song._id}" type="audio/mpeg">
                </audio>
              </li>`
            )
            .join("");
          suggestedSongsList.querySelector("ul").innerHTML = songsHTML;
        });
    }
  }, 300); // Every 0.3 seconds
}


async function setup() {
  await loadModels();
  await startVideo();
  video.addEventListener('play', detectFaces);
}

setup();
