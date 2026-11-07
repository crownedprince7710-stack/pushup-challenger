import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const $ = (id) => document.getElementById(id);

const screens = [
  "homeScreen",
  "setupScreen",
  "battleScreen",
  "resultScreen",
  "historyScreen"
];

const storeKey = "pushupChallenger.v1";

const defaultData = {
  name: "PLAYER",
  totalReps: 0,
  bestSession: 0,
  challengeCount: 0,
  history: []
};

let data = loadData();

let duration = 60;
let stake = 0;
let challengeTitle = "60-second test";

let cameraStream = null;
let poseLandmarker = null;
let drawingUtils = null;

let cameraRunning = false;
let roundRunning = false;
let animationId = null;

let reps = 0;
let rivalReps = 0;
let secondsLeft = 60;
let roundStartedAt = 0;

let repPhase = "up";
let lastRepAt = 0;
let lastPoseAt = 0;
let audioContext = null;


// STORAGE

function loadData() {
  try {
    return {
      ...defaultData,
      ...JSON.parse(localStorage.getItem(storeKey) || "{}")
    };
  } catch {
    return { ...defaultData };
  }
}

function saveData() {
  localStorage.setItem(storeKey, JSON.stringify(data));
}


// NAVIGATION

function showScreen(id) {
  screens.forEach(screen => {
    $(screen).classList.toggle("active", screen === id);
  });

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


// PLAYER PROFILE

function initials(name) {
  return (name || "PC")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(s => s[0])
    .join("")
    .toUpperCase();
}


// DASHBOARD

function updateDashboard() {
  $("totalReps").textContent = data.totalReps;
  $("bestSession").textContent = data.bestSession;
  $("challengeCount").textContent = data.challengeCount;

  $("playerNameLabel").textContent =
    data.name.toUpperCase();

  $("profileButton").textContent =
    initials(data.name);

  renderSessions(
    $("recentSessions"),
    data.history.slice(0, 3)
  );

  renderSessions(
    $("allSessions"),
    data.history
  );
}


function renderSessions(container, sessions) {
  if (!sessions.length) {
    container.innerHTML =
      '<div class="empty-state">Your first session is waiting. Let’s go.</div>';

    return;
  }

  container.innerHTML = sessions.map(s => `
    <article class="session-item">
      <div>
        <b>${escapeHtml(s.title)}</b><br>
        <span>${new Date(s.date).toLocaleString()}</span>
      </div>

      <strong class="session-reps">
        ${s.reps} reps
      </strong>
    </article>
  `).join("");
}


function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}


function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}


// CAMERA STATUS

function setCameraStatus(message, good = false) {
  $("cameraStatus").textContent = message;
  $("detectionText").textContent = message;

  $("detectDot").classList.toggle(
    "active",
    good
  );
}


function setPoseLabel(text) {
  $("poseStatus").textContent = text;
}


// BUTTON EVENTS

document.querySelectorAll("[data-back]").forEach(button => {
  button.addEventListener("click", () => {
    showScreen(button.dataset.back);
  });
});


$("startChallengeButton").addEventListener("click", () => {
  showScreen("setupScreen");
});


$("missionButton").addEventListener("click", () => {
  duration = 60;
  challengeTitle = "60-second test";

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


// PROFILE DIALOG

$("profileButton").addEventListener("click", () => {
  $("nameInput").value = data.name;
  $("profileDialog").showModal();
});


$("profileForm").addEventListener("submit", e => {
  e.preventDefault();

  data.name =
    $("nameInput").value.trim().slice(0, 18) || "PLAYER";

  saveData();
  updateDashboard();

  $("profileDialog").close();
});


// CHALLENGE TIME SELECTION

document.querySelectorAll("[data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-mode]").forEach(b => {
      b.classList.remove("selected");
    });

    button.classList.add("selected");

    duration = Number(button.dataset.mode);
    challengeTitle = button.dataset.title;
  });
});


// VIRTUAL COINS

document.querySelectorAll("[data-stake]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-stake]").forEach(b => {
      b.classList.remove("selected");
    });

    button.classList.add("selected");

    stake = Number(button.dataset.stake);
  });
});


// OPEN BATTLE SCREEN

$("continueButton").addEventListener("click", () => {
  resetBattle();
  showScreen("battleScreen");
});


// RESET BATTLE

function resetBattle() {
  reps = 0;
  rivalReps = 0;
  secondsLeft = duration;

  roundRunning = false;
  repPhase = "up";
  lastRepAt = 0;

  $("yourScore").textContent = "0";
  $("rivalScore").textContent = "0";

  $("timerDisplay").textContent =
    formatTime(duration);

  $("startRoundButton").disabled =
    !cameraRunning;

  $("endRoundButton").disabled = true;

  $("startRoundButton").textContent =
    "START ROUND";

  setPoseLabel(
    cameraRunning ? "AI READY" : "AI NOT STARTED"
  );
}


// CAMERA BUTTON

$("cameraButton").addEventListener("click", async () => {
  if (cameraRunning) {
    stopCamera();
    return;
  }

  await startCamera();
});


// START ROUND BUTTON

$("startRoundButton").addEventListener("click", () => {
  if (!cameraRunning || !poseLandmarker) return;

  if (!roundRunning) {
    startRound();
  }
});


// END ROUND BUTTON

$("endRoundButton").addEventListener("click", () => {
  finishRound();
});


// START CAMERA

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus(
      "Camera unavailable. Open this site over HTTPS (GitHub Pages) in a supported browser."
    );

    return;
  }

  $("cameraButton").disabled = true;

  setCameraStatus("Requesting camera permission…");

  try {
    cameraStream =
      await navigator.mediaDevices.getUserMedia({
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

    $("startRoundButton").disabled = false;

    setCameraStatus(
      "Camera active. Loading on-device pose model…"
    );

    await initPoseModel();

    setCameraStatus(
      "Pose tracking ready. Get into a side-on push-up position.",
      true
    );

    setPoseLabel("AI READY");

    detectLoop();

  } catch (error) {
    console.error(error);

    stopCamera();

    const message =
      error.name === "NotAllowedError"
        ? "Camera permission denied. Allow camera access in your browser settings."
        : error.name === "NotFoundError"
        ? "No camera found on this device."
        : "Could not start camera/model. Check your connection and reload the page.";

    setCameraStatus(message);

  } finally {
    $("cameraButton").disabled = false;
  }
}


// INITIALIZE MEDIAPIPE

async function initPoseModel() {
  if (poseLandmarker) return;

  const vision =
    await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

  try {
    poseLandmarker =
      await PoseLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

            delegate: "GPU"
          },

          runningMode: "VIDEO",
          numPoses: 1
        }
      );

  } catch (gpuError) {
    console.warn(
      "GPU initialization failed; retrying on CPU",
      gpuError
    );

    poseLandmarker =
      await PoseLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

            delegate: "CPU"
          },

          runningMode: "VIDEO",
          numPoses: 1
        }
      );
  }

  const ctx =
    $("poseCanvas").getContext("2d");

  drawingUtils = new DrawingUtils(ctx);
}


// STOP CAMERA

function stopCamera() {
  cameraRunning = false;

  if (animationId) {
    cancelAnimationFrame(animationId);
  }

  animationId = null;

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => {
      track.stop();
    });
  }

  cameraStream = null;

  $("cameraVideo").srcObject = null;

  $("cameraPlaceholder").style.display = "flex";

  $("cameraButton").textContent = "START CAMERA";

  $("startRoundButton").disabled = true;

  $("poseCanvas")
    .getContext("2d")
    .clearRect(
      0,
      0,
      $("poseCanvas").width,
      $("poseCanvas").height
    );

  setPoseLabel("AI NOT STARTED");

  setCameraStatus("Camera is off.");
}


// POSE DETECTION LOOP

function detectLoop() {
  if (!cameraRunning) return;

  const video = $("cameraVideo");
  const canvas = $("poseCanvas");

  if (video.readyState >= 2 && poseLandmarker) {
    const w = video.videoWidth;
    const h = video.videoHeight;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const result =
      poseLandmarker.detectForVideo(
        video,
        performance.now()
      );

    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, w, h);

    if (result.landmarks?.length) {
      const landmarks = result.landmarks[0];

      drawingUtils.drawConnectors(
        landmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        {
          color: "#ff765e",
          lineWidth: 3
        }
      );

      drawingUtils.drawLandmarks(
        landmarks,
        {
          color: "#ffffff",
          fillColor: "#ff604d",
          lineWidth: 1,
          radius: 3
        }
      );

      lastPoseAt = Date.now();

      const repResult =
        analyzePushup(landmarks);

      if (repResult.valid) {
        setPoseLabel(
          roundRunning
            ? "TRACKING · BODY ALIGNED"
            : "BODY POSITION OK"
        );

        if (roundRunning) {
          countPushup(repResult.elbowAngle);
        }

      } else {
        setPoseLabel(repResult.message);
      }

    } else {
      setPoseLabel("MOVE INTO CAMERA VIEW");
    }
  }

  animationId = requestAnimationFrame(detectLoop);
}


// CALCULATE JOINT ANGLE

function angle(a, b, c) {
  const ab = [
    a.x - b.x,
    a.y - b.y
  ];

  const cb = [
    c.x - b.x,
    c.y - b.y
  ];

  const dot =
    ab[0] * cb[0] +
    ab[1] * cb[1];

  const mag =
    Math.hypot(...ab) *
    Math.hypot(...cb);

  if (!mag) return 180;

  return Math.acos(
    Math.max(-1, Math.min(1, dot / mag))
  ) * 180 / Math.PI;
}


// ANALYZE PUSH-UP POSITION



function analyzePushup(lm) {
  const sides = [
    [11, 13, 15, 23, 27],
    [12, 14, 16, 24, 28]
  ];

  let best = null;

  for (const [s, e, w, h, a] of sides) {
    const arm = [lm[s], lm[e], lm[w]];

    if (arm.some(p => !p || (p.visibility ?? 1) < 0.35)) {
      continue;
    }

    const elbowAngle = angle(lm[s], lm[e], lm[w]);

    const hipVisible = lm[h] && (lm[h].visibility ?? 1) >= 0.30;
    const ankleVisible = lm[a] && (lm[a].visibility ?? 1) >= 0.30;

    const bodyAngle = hipVisible && ankleVisible
      ? angle(lm[s], lm[h], lm[a])
      : null;

    const visibility = arm.reduce(
      (sum, p) => sum + (p.visibility ?? 1), 0
    );

    if (!best || visibility > best.visibility) {
      best = { elbowAngle, bodyAngle, visibility };
    }
  }

  if (!best) {
    return { valid: false, message: "SHOW YOUR SIDE PROFILE" };
  }

  if (best.bodyAngle !== null && best.bodyAngle < 130) {
    return { valid: false, message: "KEEP BODY STRAIGHT" };
  }

  return { valid: true, elbowAngle: best.elbowAngle };
}


// COUNT VALID PUSH-UPS



function countPushup(elbowAngle) {
  const now = Date.now();

  // Smooth camera movement using the last 5 readings
  elbowSamples.push(elbowAngle);

  if (elbowSamples.length > 5) {
    elbowSamples.shift();
  }

  const sorted = [...elbowSamples].sort((a, b) => a - b);
  const smoothAngle = sorted[Math.floor(sorted.length / 2)];

  const targetPhase =
    repPhase === "up" && smoothAngle < 125 ? "down" :
    repPhase === "down" && smoothAngle > 145 ? "up" : "";

  if (!targetPhase) {
    phaseCandidate = "";
    phaseCandidateSince = 0;
    setPoseLabel(`ELBOW ${Math.round(smoothAngle)}° · ${repPhase.toUpperCase()}`);
    return;
  }

  if (phaseCandidate !== targetPhase) {
    phaseCandidate = targetPhase;
    phaseCandidateSince = now;
    return;
  }

  if (now - phaseCandidateSince < 90) return;

  if (targetPhase === "down") {
    repPhase = "down";
    phaseCandidate = "";
    phaseCandidateSince = 0;
    setPoseLabel("BOTTOM POSITION · PUSH UP");
    return;
  }

  if (now - lastRepAt < 450) return;

  repPhase = "up";
  lastRepAt = now;
  phaseCandidate = "";
  phaseCandidateSince = 0;

  reps++;
  $("yourScore").textContent = reps;
  setPoseLabel("REP COUNTED ✓");
  playBeep();
}


// START MATCH TIMER

function startRound() {
  roundRunning = true;

  roundStartedAt = Date.now();

  $("startRoundButton").disabled = true;

  $("endRoundButton").disabled = false;

  $("timerDisplay").textContent =
    formatTime(secondsLeft);

  setPoseLabel("ROUND LIVE");

  tickTimer();
}


// UPDATE TIMER

function tickTimer() {
  if (!roundRunning) return;

  const elapsed =
    Math.floor(
      (Date.now() - roundStartedAt) / 1000
    );

  secondsLeft =
    Math.max(0, duration - elapsed);

  $("timerDisplay").textContent =
    formatTime(secondsLeft);

  // Demo rival score, not a real remote player.
  rivalReps = Math.min(
    Math.floor(elapsed * 0.19),
    Math.max(0, reps + 3)
  );

  $("rivalScore").textContent = rivalReps;

  if (secondsLeft <= 0) {
    finishRound();
    return;
  }

  setTimeout(tickTimer, 250);
}


// FINISH MATCH

function finishRound() {
  if (!roundRunning && reps === 0) return;

  roundRunning = false;

  const rival = rivalReps;

  data.totalReps += reps;

  data.bestSession =
    Math.max(data.bestSession, reps);

  data.challengeCount++;

  data.history.unshift({
    reps,
    title: challengeTitle,
    date: new Date().toISOString(),
    duration,
    rival
  });

  data.history = data.history.slice(0, 50);

  saveData();

  updateDashboard();

  $("finalScore").textContent = reps;

  $("resultDuration").textContent =
    `${duration}s`;

  $("resultRival").textContent = rival;

  $("resultCoins").textContent = stake;

  $("resultSubtitle").textContent =
    reps > rival
      ? "You beat the training rival. Keep that momentum."
      : "Strong work. Your next round is your rematch.";

  $("startRoundButton").disabled =
    !cameraRunning;

  $("endRoundButton").disabled = true;

  showScreen("resultScreen");
}


// REP SOUND EFFECT

function playBeep() {
  try {
    audioContext ||=
      new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

    const osc =
      audioContext.createOscillator();

    const gain =
      audioContext.createGain();

    osc.frequency.value = 740;
    gain.gain.value = 0.035;

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start();

    osc.stop(
      audioContext.currentTime + 0.07
    );

  } catch {}
}


// CLEAN UP CAMERA WHEN LEAVING PAGE

window.addEventListener("beforeunload", () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => {
      track.stop();
    });
  }
});


// INITIALIZE APP

updateDashboard();