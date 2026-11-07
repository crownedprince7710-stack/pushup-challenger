import {
  firebaseConfig,
  firebaseConfigured
} from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = id => document.getElementById(id);

let db;
let uid = null;
let playerId = null;
let roomCode = null;
let roomData = null;
let latestRoom = null;
let rivalUid = null;
let isHost = false;

let roomUnsub = null;
let requestUnsub = null;

const emit = (name, detail = {}) => {
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

function say(message) {
  $("connectionStatus").textContent = message;
}

function setConnection(message, good = false) {
  $("connectionLabel").textContent = good ? "ONLINE" : "OFFLINE";
  $("onlineDot").style.background = good ? "#42d392" : "#f06450";
  say(message);
}

function getPlayerName() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("pushupChallenger.v1") || "{}"
    );
    return String(saved.name || "PLAYER").slice(0, 18);
  } catch {
    return "PLAYER";
  }
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);

  return [...bytes]
    .map(b => chars[b % chars.length])
    .join("");
}

function showError(error) {
  console.error(error);
  say(error.message || "Firebase error. Check your configuration.");
}

async function initFirebase() {
  if (!firebaseConfigured) {
    $("playerIdLabel").textContent = "SETUP REQUIRED";
    setConnection("Add your Firebase configuration first.");
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    db = getDatabase(app);

    const credential = await signInAnonymously(auth);
    uid = credential.user.uid;

    playerId = "PC-" + uid.slice(0, 10).toUpperCase();

    const playerIdRef = ref(db, "playerIds/" + playerId);

    const result = await runTransaction(playerIdRef, current => {
      return current || {
        uid,
        name: getPlayerName(),
        createdAt: serverTimestamp()
      };
    });

    if (
      !result.committed ||
      result.snapshot.val()?.uid !== uid
    ) {
      throw new Error("Player ID conflict. Refresh the page.");
    }

    await set(ref(db, "players/" + uid), {
      publicId: playerId,
      name: getPlayerName(),
      updatedAt: serverTimestamp()
    });

    $("playerIdLabel").textContent = playerId;

    setConnection("Connected! Invite a friend to your arena.", true);

    listenInvitations();

    } catch (error) {
    console.error("Firebase initialization failed:", error);

    const code = error?.code || "unknown";
    const message = error?.message || String(error);

    $("playerIdLabel").textContent = "CONNECTION ERROR";
    setConnection(`${code}: ${message}`);
  }
}
function stopRoomListeners() {
  if (roomUnsub) roomUnsub();
  if (requestUnsub) requestUnsub();

  roomUnsub = null;
  requestUnsub = null;
}

function showLobby(code, message) {
  roomCode = code;

  $("lobbyPanel").hidden = false;
  $("activeRoomCode").textContent = code;
  $("lobbyStatusText").textContent = message;
}

async function createLobby(targetUid = null, targetId = null, targetName = null) {
  if (!uid) {
    say("Firebase is not connected.");
    return;
  }

  try {
    const code = randomCode();

    const selectedMode = document.querySelector(
      "[data-mode].selected"
    );

    const duration = Number(selectedMode?.dataset.mode || 60);

    const room = {
      hostUid: uid,
      hostId: playerId,
      hostName: getPlayerName(),

      guestUid: null,
      guestId: null,
      guestName: null,

      targetUid,
      targetId,
      targetName,

      duration,
      status: "waiting",
      startAt: null,
      createdAt: serverTimestamp()
    };

    await set(ref(db, "rooms/" + code), room);

    isHost = true;
    roomData = room;
    rivalUid = null;

    showLobby(
      code,
      targetId
        ? `Challenge sent to ${targetName || targetId}. Waiting…`
        : "Waiting for your opponent. Share this code!"
    );

    listenRoom(code);
    listenJoinRequests(code);

    if (targetUid) {
      await set(
        ref(db, `invitations/${targetUid}/${code}`),
        {
          code,
          fromUid: uid,
          fromId: playerId,
          fromName: getPlayerName(),
          createdAt: serverTimestamp()
        }
      );
    }

  } catch (error) {
    showError(error);
  }
}

function listenJoinRequests(code) {
  requestUnsub = onValue(
    ref(db, "joinRequests/" + code),
    async snapshot => {
      if (!isHost || !snapshot.exists() || latestRoom?.guestUid) {
        return;
      }

      const requests = Object.entries(snapshot.val() || {});

      if (!requests.length) return;

      const [guestUid, request] = requests[0];

      if (
        latestRoom?.targetUid &&
        latestRoom.targetUid !== guestUid
      ) {
        return;
      }

      try {
        await Promise.all([
          set(ref(db, `rooms/${code}/guestUid`), guestUid),
          set(ref(db, `rooms/${code}/guestId`), request.publicId),
          set(ref(db, `rooms/${code}/guestName`), request.name)
        ]);

        await remove(
          ref(db, `joinRequests/${code}/${guestUid}`)
        );

        await remove(
          ref(db, `invitations/${guestUid}/${code}`)
        );

      } catch (error) {
        showError(error);
      }
    }
  );
}

async function joinLobby(code) {
  if (!uid) {
    say("Firebase is not connected.");
    return;
  }

  code = code.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    say("Enter a valid six-character room code.");
    return;
  }

  try {
    const snapshot = await get(ref(db, "rooms/" + code));

    if (!snapshot.exists()) {
      say("Room not found.");
      return;
    }

    const room = snapshot.val();

    if (room.status !== "waiting" || room.guestUid) {
      say("This room is already full or has started.");
      return;
    }

    if (room.hostUid === uid) {
      say("You created this room already.");
      return;
    }

    if (room.targetUid && room.targetUid !== uid) {
      say("This invitation belongs to another player.");
      return;
    }

    await set(
      ref(db, `joinRequests/${code}/${uid}`),
      {
        publicId: playerId,
        name: getPlayerName(),
        createdAt: serverTimestamp()
      }
    );

    isHost = false;
    roomData = room;
    rivalUid = room.hostUid;

    showLobby(code, "Join request sent. Waiting for the host…");

    listenRoom(code);

  } catch (error) {
    showError(error);
  }
}

function listenRoom(code) {
  stopRoomListeners();

  roomUnsub = onValue(
    ref(db, "rooms/" + code),
    snapshot => {
      if (!snapshot.exists()) {
        say("Room is no longer available.");
        $("lobbyPanel").hidden = true;
        return;
      }

      const room = snapshot.val();

      latestRoom = room;
      roomData = room;

      const opponentName = isHost
        ? room.guestName
        : room.hostName;

      rivalUid = isHost
        ? room.guestUid
        : room.hostUid;

      if (room.guestUid) {
        $("lobbyStatusText").textContent =
          `Opponent connected: ${opponentName || "PLAYER"}.`;

        $("rivalNameLabel").textContent =
          (opponentName || "OPPONENT").toUpperCase();

        $("rivalAvatar").textContent =
          (opponentName || "VS").slice(0, 2).toUpperCase();
      }

      if (room.status === "live" && room.startAt) {
        emit("pc:round-live", {
          startAt: room.startAt,
          duration: room.duration
        });
      }

      if (room.status === "finished") {
        $("battleStateLabel").textContent = "FINISHED";
      }

      if (room.scores && rivalUid) {
        const score = Number(room.scores[rivalUid] || 0);

        $("rivalScore").textContent = score;

        emit("pc:rival-score", { score });
      }
    }
  );
}

function listenInvitations() {
  onValue(
    ref(db, "invitations/" + uid),
    snapshot => {
      const box = $("incomingInvites");
      box.innerHTML = "";

      if (!snapshot.exists()) return;

      Object.values(snapshot.val()).forEach(invite => {
        const card = document.createElement("div");
        card.className = "invite-card";

        const label = document.createElement("span");
        label.textContent =
          `${invite.fromName} (${invite.fromId}) invited you`;

        const button = document.createElement("button");
        button.textContent = "ACCEPT";

        button.addEventListener("click", () => {
          joinLobby(invite.code);
        });

        card.append(label, button);
        box.append(card);
      });
    }
  );
}

async function challengePlayer() {
  if (!uid) {
    say("Firebase is not connected.");
    return;
  }

  const id = $("challengePlayerIdInput")
    .value.trim().toUpperCase();

  if (!id || id === playerId) {
    say("Enter your friend's Player ID.");
    return;
  }

  try {
    const snapshot = await get(ref(db, "playerIds/" + id));

    if (!snapshot.exists()) {
      say("Player ID not found. Ask your friend to open the app.");
      return;
    }

    const target = snapshot.val();

    if (target.uid === uid) {
      say("That's your own Player ID.");
      return;
    }

    await createLobby(
      target.uid,
      id,
      target.name || id
    );

  } catch (error) {
    showError(error);
  }
}

async function startMatch() {
  if (
    !roomCode ||
    !isHost ||
    !latestRoom?.guestUid
  ) {
    say("Wait for your opponent to join.");
    return;
  }

  try {
    await set(
      ref(db, `rooms/${roomCode}/startAt`),
      Date.now() + 4000
    );

    await set(
      ref(db, `rooms/${roomCode}/status`),
      "live"
    );

  } catch (error) {
    showError(error);
  }
}

async function updateMyScore(score) {
  if (
    !roomCode ||
    !uid ||
    !latestRoom?.guestUid ||
    latestRoom.status !== "live"
  ) {
    return;
  }

  try {
    await set(
      ref(db, `rooms/${roomCode}/scores/${uid}`),
      score
    );
  } catch (error) {
    console.warn("Score sync failed", error);
  }
}

async function finishMatch(score) {
  if (!roomCode || !uid) return;

  await updateMyScore(score);

  if (isHost) {
    await set(
      ref(db, `rooms/${roomCode}/status`),
      "finished"
    );
  }
}

async function leaveLobby() {
  if (!roomCode) return;

  try {
    if (isHost) {
      await set(
        ref(db, `rooms/${roomCode}/status`),
        "finished"
      );
    } else {
      await remove(
        ref(db, `joinRequests/${roomCode}/${uid}`)
      );
    }
  } catch (error) {
    console.warn(error);
  }

  stopRoomListeners();

  roomCode = null;
  roomData = null;
  latestRoom = null;
  rivalUid = null;
  isHost = false;

  $("lobbyPanel").hidden = true;
  $("rivalNameLabel").textContent = "NO OPPONENT";
  $("rivalScore").textContent = "0";

  say("You left the lobby.");
}

window.PCMultiplayer = {
  hasRoom: () => !!roomCode,
  inRoom: () => !!roomCode && !!latestRoom?.guestUid,
  isHost: () => isHost,
  startMatch,
  updateMyScore,
  finishMatch,
  leaveLobby
};

$("createLobbyButton").addEventListener("click", () => {
  createLobby();
});

$("joinLobbyButton").addEventListener("click", () => {
  joinLobby($("roomCodeInput").value);
});

$("challengePlayerButton").addEventListener("click", challengePlayer);

$("enterBattleButton").addEventListener("click", () => {
  if (!latestRoom?.guestUid) {
    say("Your opponent hasn't joined yet.");
    return;
  }

  emit("pc:enter-battle", {
    duration: roomData.duration
  });
});

$("leaveLobbyButton").addEventListener("click", leaveLobby);

$("copyPlayerIdButton").addEventListener("click", async () => {
  if (playerId) {
    await navigator.clipboard.writeText(playerId);
    say("Player ID copied.");
  }
});

$("copyRoomCodeButton").addEventListener("click", async () => {
  if (roomCode) {
    await navigator.clipboard.writeText(roomCode);
    say("Room code copied.");
  }
});

window.addEventListener("pc:rep", event => {
  updateMyScore(event.detail.score);
});

window.addEventListener("pc:round-finished", event => {
  finishMatch(event.detail.score);
});

initFirebase();