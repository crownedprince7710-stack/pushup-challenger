import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

import "./multiplayer.js";

const $ = id => document.getElementById(id);

const storeKey = "pushupChallenger.v1";

const defaults = {
  name: "PLAYER",
  totalReps: 0,
  bestSession: 0,
  challengeCount: 0,
  history: []
};

let data = loadData();

let duration = 60;
let challengeTitle = "60-second challenge";

let cameraStream = null;
let poseLandmarker = null;
let drawingUtils = null;
let cameraRunning = false;
let roundRunning = false;

let animationId = null;
let timerInterval = null;

let reps = 0;
let rivalReps = 0;
let repPhase = "up";
let lastRepAt = 0;
let roundStartedAt = 0;

let elbowSamples = [];
let phaseCandidate = "";
let phaseCandidateSince = 0;

function loadData() {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(storeKey) || "{}")
    };
  } catch {
    return { ...defaults };
  }
}

function saveData() {
  localStorage.setItem(storeKey, JSON.stringify(data));
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.toggle("active", screen.id === id);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(remaining).padStart(2, "0")
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function updateDashboard() {
  $("totalReps").textContent = data.totalReps;
  $("bestSession").textContent = data.bestSession;
  $("challengeCount").textContent = data.challengeCount;

  $("playerNameLabel").textContent = data.name.toUpperCase();

  renderSessions(
    $("recentSessions"),
    data.history.slice(0, 3)
  );

  renderSessions(
    $("allSessions"),
    data.history
  );
}

function renderSessions(container, items) {
  if (!items.length) {
    container.innerHTML =
      '<div class="empty-state">Your first session is waiting.</div>';
    return;
  }

  container.innerHTML = items.map(session => `
    <article class="session-item">
      <div>
        <b>${escapeHtml(session.title)}</b>
        <br>
        <span>${new Date(session.date).toLocaleString()}</span>
      </div>
      <strong>${session.reps} reps</strong>
    </article>
  `).join("");
}

document.querySelectorAll("[data-back]").forEach(button => {
  button.addEventListener("click", () => {
    showScreen(button.dataset.back);
  });
});

$("startChallengeButton").addEventListener("click", () => {
  showScreen("setupScreen");
});

$("viewHistoryButton").addEventListener("click", () => {
  updateDashboard();
  showScreen("historyScreen");
});

$("homeButton").addEventListener("click", () => {
  updateDashboard();
  showScreen("homeScreen");
});

$("againButton").addEventListener("click", () => {
  resetBattle();
  showScreen("setupScreen");
});

$("profileButton").addEventListener("click", () => {
  $("nameInput").value = data.name;
  $("profileDialog").showModal();
});

$("profileForm").addEventListener("submit", event => {
  event.preventDefault();

  data.name =
    $("nameInput").value.trim().slice(0, 18) || "PLAYER";

  saveData();
  updateDashboard();
  $("profileDialog").close();
});

document.querySelectorAll("[data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-mode]").forEach(item => {
      item.classList.remove("selected");
    });

    button.classList.add("selected");

    duration = Number(button.dataset.mode);
    challengeTitle = button.dataset.title;
  });
});

$("continueButton").addEventListener("click", () => {
  resetBattle();

  $("battleModeLabel").textContent = "SOLO PRACTICE";
  $("rivalNameLabel").textContent = "SOLO MODE";
  $("rivalScore").textContent = "—";

  showScreen("battleScreen");
});

$("cameraButton").addEventListener("click", async () => {
  if (cameraRunning) {
    stopCamera();
  } else {
    await startCamera();
  }
});

$("startRoundButton").addEventListener("click", () => {
  if (!cameraRunning || !poseLandmarker) return;

  if (window.PCMultiplayer?.hasRoom()) {
    window.PCMultiplayer.startMatch();
  } else {
    startRound();
  }
});

$("endRoundButton").addEventListener("click", finishRound);

window.addEventListener("pc:enter-battle", event => {
  duration = Number(event.detail.duration) || 60;
  challengeTitle = `${duration}-second multiplayer`;

  resetBattle();

  $("battleModeLabel").textContent = "LIVE MULTIPLAYER";
  $("battleStateLabel").textContent = "WAITING";

  showScreen("battleScreen");
});

window.addEventListener("pc:round-live", event => {
  if (!window.PCMultiplayer?.inRoom()) return;

  duration = Number(event.detail.duration) || duration;

  startRound(event.detail.startAt);
});

window.addEventListener("pc:rival-score", event => {
  rivalReps = Number(event.detail.score) || 0;
  $("rivalScore").textContent = rivalReps;
});

function resetBattle() {
  reps = 0;
  rivalReps = 0;

  roundRunning = false;
  repPhase = "up";
  lastRepAt = 0;

  elbowSamples = [];
  phaseCandidate = "";
  phaseCandidateSince = 0;

  $("yourScore").textContent = "0";
  $("rivalScore").textContent = "0";
  $("timerDisplay").textContent = formatTime(duration);

  $("startRoundButton").disabled = !cameraRunning;
  $("endRoundButton").disabled = true;
  $("startRoundButton").textContent = "START ROUND";
}

function setCameraStatus(message) {
  $("cameraStatus").textContent = message;
  $("detectionText").textContent = message;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus("Camera unavailable. Open the site over HTTPS.");
    return;
  }

  $("cameraButton").disabled = true;

  try {
    setCameraStatus("Requesting camera permission…");

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });

    $("cameraVideo").srcObject = cameraStream;

    await $("cameraVideo").play();

    $("cameraPlaceholder").style.display = "none";

    cameraRunning = true;

    $("cameraButton").textContent = "STOP CAMERA";

    setCameraStatus("Loading AI pose model…");

    await initPoseModel();

    $("startRoundButton").disabled = false;

    setCameraStatus("AI ready. Position yourself side-on.");

    detectLoop();

  } catch (error) {
    console.error(error);

    stopCamera();

    setCameraStatus(
      error.name === "NotAllowedError"
        ? "Camera permission denied."
        : "Camera or AI model unavailable. Check your connection."
    );

  } finally {
    $("cameraButton").disabled = false;
  }
}

async function initPoseModel() {
  if (poseLandmarker) return;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  const options = delegate => ({
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate
    },
    runningMode: "VIDEO",
    numPoses: 1
  });

  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(
      vision,
      options("GPU")
    );
  } catch (error) {
    console.warn("GPU unavailable. Trying CPU.", error);

    poseLandmarker = await PoseLandmarker.createFromOptions(
      vision,
      options("CPU")
    );
  }

  drawingUtils = new DrawingUtils(
    $("poseCanvas").getContext("2d")
  );
}

function stopCamera() {
  cameraRunning = false;

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }

  cameraStream = null;

  $("cameraVideo").srcObject = null;
  $("cameraPlaceholder").style.display = "flex";

  $("cameraButton").textContent = "START CAMERA";
  $("startRoundButton").disabled = true;

  const canvas = $("poseCanvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function detectLoop() {
  if (!cameraRunning) return;

  const video = $("cameraVideo");
  const canvas = $("poseCanvas");

  if (video.readyState >= 2 && poseLandmarker) {
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const result = poseLandmarker.detectForVideo(
      video,
      performance.now()
    );

    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, width, height);

    if (result.landmarks?.length) {
      const landmarks = result.landmarks[0];

      drawingUtils.drawConnectors(
        landmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        { color: "#ff765e", lineWidth: 3 }
      );

      drawingUtils.drawLandmarks(
        landmarks,
        { color: "#ffffff", fillColor: "#ff604d", radius: 3 }
      );

      const check = analyzePushup(landmarks);

      if (check.valid) {
        $("poseStatus").textContent =
          roundRunning ? "TRACKING" : "BODY POSITION OK";

        if (roundRunning) {
          countPushup(check.elbowAngle);
        }
      } else {
        $("poseStatus").textContent = check.message;
      }

    } else {
      $("poseStatus").textContent = "MOVE INTO CAMERA VIEW";
    }
  }

  animationId = requestAnimationFrame(detectLoop);
}

function angle(a, b, c) {
  const ab = [a.x - b.x, a.y - b.y];
  const cb = [c.x - b.x, c.y - b.y];

  const dot = ab[0] * cb[0] + ab[1] * cb[1];

  const magnitude =
    Math.hypot(...ab) * Math.hypot(...cb);

  if (!magnitude) return 180;

  const cosine = Math.max(
    -1,
    Math.min(1, dot / magnitude)
  );

  return Math.acos(cosine) * 180 / Math.PI;
}

function analyzePushup(landmarks) {
  const sides = [
    [11, 13, 15, 23, 27],
    [12, 14, 16, 24, 28]
  ];

  let best = null;

  for (const [shoulder, elbow, wrist, hip, ankle] of sides) {
    const arm = [
      landmarks[shoulder],
      landmarks[elbow],
      landmarks[wrist]
    ];

    if (
      arm.some(
        point => !point || (point.visibility ?? 1) < 0.35
      )
    ) {
      continue;
    }

    const elbowAngle = angle(
      landmarks[shoulder],
      landmarks[elbow],
      landmarks[wrist]
    );

    const hipVisible =
      landmarks[hip] &&
      (landmarks[hip].visibility ?? 1) >= 0.30;

    const ankleVisible =
      landmarks[ankle] &&
      (landmarks[ankle].visibility ?? 1) >= 0.30;

    const bodyAngle =
      hipVisible && ankleVisible
        ? angle(
            landmarks[shoulder],
            landmarks[hip],
            landmarks[ankle]
          )
        : null;

    const visibility = arm.reduce(
      (sum, point) => sum + (point.visibility ?? 1),
      0
    );

    if (!best || visibility > best.visibility) {
      best = {
        elbowAngle,
        bodyAngle,
        visibility
      };
    }
  }

  if (!best) {
    return {
      valid: false,
      message: "SHOW YOUR SIDE PROFILE"
    };
  }

  if (best.bodyAngle !== null && best.bodyAngle < 130) {
    return {
      valid: false,
      message: "KEEP BODY STRAIGHT"
    };
  }

  return {
    valid: true,
    elbowAngle: best.elbowAngle
  };
}



function countPushup(value) {
  const now = Date.now();

  elbowSamples.push(value);
  if (elbowSamples.length > 3) elbowSamples.shift();

  const sorted = [...elbowSamples].sort((a, b) => a - b);
  const smooth = sorted[Math.floor(sorted.length / 2)];

  const target =
    repPhase === "up" && smooth < 135
      ? "down"
      : repPhase === "down" && smooth > 145
        ? "up"
        : "";

  if (!target) {
    phaseCandidate = "";
    phaseCandidateSince = 0;
    $("poseStatus").textContent = `ELBOW ${Math.round(smooth)}°`;
    return;
  }

  if (phaseCandidate !== target) {
    phaseCandidate = target;
    phaseCandidateSince = now;
    return;
  }

  if (now - phaseCandidateSince < 45) return;

  if (target === "down") {
    repPhase = "down";
    phaseCandidate = "";
    phaseCandidateSince = 0;
    $("poseStatus").textContent = "BOTTOM POSITION";
    return;
  }

  if (now - lastRepAt < 280) return;

  repPhase = "up";
  lastRepAt = now;
  phaseCandidate = "";
  phaseCandidateSince = 0;

  reps++;
  $("yourScore").textContent = reps;
  $("poseStatus").textContent = "REP COUNTED ✓";
  playBeep();

  window.dispatchEvent(
    new CustomEvent("pc:rep", {
      detail: { score: reps }
    })
  );
}

function startRound(sharedStartAt = null) {
  if (roundRunning) return;

  roundRunning = true;

  roundStartedAt = sharedStartAt || Date.now();

  $("startRoundButton").disabled = true;
  $("endRoundButton").disabled = false;
  $("battleStateLabel").textContent = "LIVE";

  if (timerInterval) {
    clearInterval(timerInterval);
  }

  tickTimer();

  timerInterval = setInterval(tickTimer, 200);
}

function tickTimer() {
  if (!roundRunning) return;

  const elapsed = Math.floor(
    (Date.now() - roundStartedAt) / 1000
  );

  const secondsLeft = Math.max(0, duration - elapsed);

  $("timerDisplay").textContent = formatTime(secondsLeft);

  if (secondsLeft <= 0) {
    finishRound();
  }
}

function finishRound() {
  if (!roundRunning) return;

  roundRunning = false;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  window.dispatchEvent(
    new CustomEvent("pc:round-finished", {
      detail: { score: reps }
    })
  );

  data.totalReps += reps;
  data.bestSession = Math.max(data.bestSession, reps);
  data.challengeCount++;

  data.history.unshift({
    reps,
    title: challengeTitle,
    date: new Date().toISOString(),
    duration,
    rival: rivalReps
  });

  data.history = data.history.slice(0, 50);

  saveData();
  updateDashboard();

  $("finalScore").textContent = reps;
  $("resultDuration").textContent = `${duration}s`;

  const multiplayer = window.PCMultiplayer?.inRoom();

  $("resultRival").textContent =
    multiplayer ? rivalReps : "—";

  $("resultSubtitle").textContent = multiplayer
    ? reps > rivalReps
      ? "You won the battle. Excellent work."
      : reps === rivalReps
        ? "It's a tie. Run it back."
        : "Your opponent took this round. Rematch?"
    : "Session complete. Your next target starts now.";

  $("battleStateLabel").textContent = "FINISHED";

  $("endRoundButton").disabled = true;

  showScreen("resultScreen");
}

let audioContext = null;

function playBeep() {
  try {
    audioContext ||= new (
      window.AudioContext || window.webkitAudioContext
    )();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.frequency.value = 740;
    gain.gain.value = 0.035;

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.07);

  } catch (error) {
    console.warn("Audio unavailable", error);
  }
}

window.addEventListener("beforeunload", () => {
  cameraStream?.getTracks().forEach(track => track.stop());
});

updateDashboard();