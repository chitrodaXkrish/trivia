/**
 * Teacher Trivia — game server.
 *
 * Hosts a WebSocket server that runs the whole game state machine:
 *   lobby -> question (10s timer) -> results -> (next question) -> ended
 *
 * Rooms live in memory; a single Node process comfortably handles the
 * 100-user classroom case this game is designed for.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT && Number(process.env.PORT) ? Number(process.env.PORT) : 3000;
const QUESTION_TIME_MS = 10_000;
const ROOM_TTL_MS = 30 * 60 * 1000; // rooms expire 30 min after creation

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // roomCode -> room

/* ---------------- helpers ---------------- */

function genCode() {
  return 'UNI26';
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }
}

/** Broadcast a message to every connected socket in the room (host + players). */
function broadcast(room, msg) {
  for (const ws of room.sockets) send(ws, msg);
}

function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\u00C0-\u024F ]/g, '');
}

function sanitizeQuestion(q) {
  const text = String((q && q.text) || '').trim();
  if (!text) return null;
  const answer = String((q && q.answer) || '').trim() || null;
  return { text, answer };
}

/** Tally the answers for a question into a ranked leaderboard. */
function buildLeaderboard(answers) {
  // answers: Map<playerId, { answer, at }>
  const groups = new Map(); // normalized key -> { answer, count, firstAt }
  for (const { answer, at } of answers.values()) {
    const key = normalizeName(answer);
    if (!key) continue;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      if (at < g.firstAt) {
        g.firstAt = at;
        g.answer = answer.trim();
      }
    } else {
      groups.set(key, { answer: answer.trim(), count: 1, firstAt: at });
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.firstAt - b.firstAt)
    .map((g) => ({ answer: g.answer, count: g.count }));
}

function roomSnapshot(room, forWs) {
  const base = {
    type: 'room:state',
    roomCode: room.code,
    hostName: room.hostName,
    phase: room.phase,
    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length,
    endsAt: room.endsAt,
    seconds: QUESTION_TIME_MS / 1000,
    playerCount: room.players.size,
    submitted: room.answers.size,
    gameEndedAt: room.gameEndedAt,
  };

  if (room.phase === 'question' && room.questionIndex >= 0) {
    base.question = room.questions[room.questionIndex].text;
  }
  if (room.phase === 'results' && room.results) {
    base.leaderboard = room.results.leaderboard;
    base.submitted = room.results.submitted;
    base.intendedAnswer = room.questions[room.questionIndex]?.answer || null;
  }

  const isHost = forWs === room.hostWs;
  if (isHost) {
    base.role = 'host';
    base.questions = room.questions;
  } else {
    base.role = 'player';
    const player = room.players.get(forWs.id);
    if (player) {
      base.playerId = player.id;
      base.yourName = player.name;
      if (room.phase === 'results' && room.results) {
        const mine = room.results.answers.get(player.id);
        base.yourAnswer = mine ? mine.answer.trim() : null;
        base.yourRank = mine ? room.results.rankOf.get(player.id) : null;
        base.yourCount = mine ? room.results.countOf.get(player.id) : null;
      }
    }
  }
  return base;
}

function announceRoster(room) {
  broadcast(room, { type: 'roster', playerCount: room.players.size });
}

function announceSubmitted(room) {
  broadcast(room, { type: 'submitted', submitted: room.answers.size, total: room.players.size });
}

/* ---------------- game transitions ---------------- */

function startQuestion(room, index) {
  room.phase = 'question';
  room.questionIndex = index;
  room.answers = new Map();
  room.results = null;
  room.endsAt = Date.now() + QUESTION_TIME_MS;
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => endQuestion(room), QUESTION_TIME_MS);

  broadcast(room, {
    type: 'game:phase',
    phase: 'question',
    questionIndex: index,
    totalQuestions: room.questions.length,
    question: room.questions[index].text,
    endsAt: room.endsAt,
    seconds: QUESTION_TIME_MS / 1000,
  });
}

function endQuestion(room) {
  if (room.phase !== 'question') return;
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;

  const leaderboard = buildLeaderboard(room.answers);
  const answers = new Map(room.answers);
  const rankOf = new Map();
  const countOf = new Map();
  leaderboard.forEach((entry, rank) => {
    const key = normalizeName(entry.answer);
    for (const [playerId, a] of answers) {
      if (normalizeName(a.answer) === key) {
        rankOf.set(playerId, rank + 1);
        countOf.set(playerId, entry.count);
      }
    }
  });

  room.results = {
    leaderboard,
    submitted: room.answers.size,
    answers,
    rankOf,
    countOf,
  };
  room.phase = 'results';
  room.endsAt = null;

  // Send results to the host.
  send(room.hostWs, {
    type: 'game:results',
    questionIndex: room.questionIndex,
    totalQuestions: room.questions.length,
    question: room.questions[room.questionIndex].text,
    intendedAnswer: room.questions[room.questionIndex].answer || null,
    leaderboard,
    submitted: room.results.submitted,
    total: room.players.size,
    last: room.questionIndex === room.questions.length - 1,
  });

  // Each player gets their own result details.
  for (const player of room.players.values()) {
    send(player.ws, {
      type: 'game:results',
      questionIndex: room.questionIndex,
      totalQuestions: room.questions.length,
      question: room.questions[room.questionIndex].text,
      intendedAnswer: room.questions[room.questionIndex].answer || null,
      leaderboard,
      submitted: room.results.submitted,
      total: room.players.size,
      last: room.questionIndex === room.questions.length - 1,
      yourAnswer: room.results.answers.get(player.id)?.answer.trim() || null,
      yourRank: rankOf.get(player.id) || null,
      yourCount: countOf.get(player.id) || null,
    });
  }
}

function endGame(room) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = null;
  room.phase = 'ended';
  room.endsAt = null;
  room.gameEndedAt = Date.now();
  broadcast(room, { type: 'game:ended', questionIndex: room.questionIndex, totalQuestions: room.questions.length });
}

function joinRoom(room, ws, name) {
  ws.id = 'p' + Math.random().toString(36).slice(2, 10);
  ws.role = 'player';
  const player = { id: ws.id, name, ws };
  room.players.set(ws.id, player);
  room.sockets.add(ws);
  send(ws, roomSnapshot(room, ws));
  announceRoster(room);
}

const HOST_REJOIN_GRACE_MS = parseInt(process.env.HOST_GRACE_MS || '90000', 10);

function leaveRoom(room, ws) {
  if (ws.role === 'host' && room.hostWs === ws) {
    room.hostWs = null;
    room.sockets.delete(ws);
    broadcast(room, { type: 'host:left' });
    // Keep the room alive briefly so the host can reconnect and resume.
    if (!room.hostRejoinTimer) {
      room.hostRejoinTimer = setTimeout(() => deleteRoom(room), HOST_REJOIN_GRACE_MS);
    }
    return;
  }
  if (ws.role === 'player') {
    room.players.delete(ws.id);
    room.sockets.delete(ws);
    announceRoster(room);
  }
}

function deleteRoom(room) {
  if (room.ttlTimer) clearTimeout(room.ttlTimer);
  if (room.hostRejoinTimer) clearTimeout(room.hostRejoinTimer);
  if (room.timer) clearTimeout(room.timer);
  for (const ws of room.sockets) {
    if (ws !== room.hostWs) send(ws, { type: 'room:closed', message: 'The room was closed by the host.' });
  }
  rooms.delete(room.code);
}

/* ---------------- message handling ---------------- */

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'host:create': {
      if (ws.role) return send(ws, { type: 'error', message: 'Already connected.' });
      const room = {
        code: genCode(),
        hostName: String(msg.name || 'The Host').trim().slice(0, 40) || 'The Host',
        hostWs: ws,
        questions: [],
        phase: 'lobby',
        questionIndex: -1,
        answers: new Map(),
        results: null,
        endsAt: null,
        timer: null,
        players: new Map(),
        sockets: new Set([ws]),
        gameEndedAt: null,
      };
      room.ttlTimer = setTimeout(() => deleteRoom(room), ROOM_TTL_MS);
      rooms.set(room.code, room);
      ws.role = 'host';
      ws.id = 'host';
      ws.roomRef = room;
      room.sockets.add(ws);
      send(ws, roomSnapshot(room, ws));
      return;
    }

    case 'host:rejoin': {
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room || (room.hostWs && room.hostWs.readyState === ws.OPEN)) {
        return send(ws, { type: 'error', message: 'Room not found or already claimed.' });
      }
      room.hostWs = ws;
      room.sockets.add(ws);
      if (room.hostRejoinTimer) {
        clearTimeout(room.hostRejoinTimer);
        room.hostRejoinTimer = null;
      }
      ws.role = 'host';
      ws.id = 'host';
      ws.roomRef = room;
      if (room.timer) clearTimeout(room.timer);
      // Resume whatever the room was doing; if mid-question, keep the timer going.
      if (room.phase === 'question') {
        const left = room.endsAt - Date.now();
        if (left > 0) room.timer = setTimeout(() => endQuestion(room), left);
        else endQuestion(room);
      }
      send(ws, roomSnapshot(room, ws));
      announceRoster(room);
      return;
    }

    case 'host:setQuestions': {
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room || ws.role !== 'host') return send(ws, { type: 'error', message: 'Not in a room.' });
      if (room.phase !== 'lobby') return send(ws, { type: 'error', message: 'Questions can only be set before the game starts.' });
      const questions = (Array.isArray(msg.questions) ? msg.questions : [])
        .map(sanitizeQuestion)
        .filter(Boolean)
        .slice(0, 100);
      room.questions = questions;
      send(ws, { type: 'questions:set', questions });
      return;
    }

    case 'host:start': {
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room || ws.role !== 'host') return send(ws, { type: 'error', message: 'Not in a room.' });
      if (room.phase !== 'lobby') return send(ws, { type: 'error', message: 'Game already started.' });
      if (room.questions.length === 0) return send(ws, { type: 'error', message: 'Add at least one question first.' });
      startQuestion(room, 0);
      return;
    }

    case 'host:reveal': {
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room || ws.role !== 'host') return;
      endQuestion(room);
      return;
    }

    case 'host:next': {
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room || ws.role !== 'host') return;
      if (room.phase !== 'results') return;
      const next = room.questionIndex + 1;
      if (next >= room.questions.length) return endGame(room);
      startQuestion(room, next);
      return;
    }

    case 'play:join': {
      if (ws.role) return send(ws, { type: 'error', message: 'Already connected.' });
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      const name = String(msg.name || '').trim().slice(0, 40);
      if (!room) return send(ws, { type: 'error', message: 'Room not found. Check the code with the host.' });
      if (!name) return send(ws, { type: 'error', message: 'Please enter your name.' });
      if (room.phase === 'ended') return send(ws, { type: 'error', message: 'This game has already ended.' });
      ws.roomRef = room;
      joinRoom(room, ws, name);
      return;
    }

    case 'play:answer': {
      const room = rooms.get(String(msg.roomCode || '').toUpperCase());
      if (!room || ws.role !== 'player') return;
      if (room.phase !== 'question') return;
      const answer = String(msg.answer || '').trim().slice(0, 60);
      if (!answer) return send(ws, { type: 'error', message: 'Type an answer first.' });
      if (Date.now() >= room.endsAt) return; // too late; results are coming
      room.answers.set(ws.id, { answer, at: Date.now() });
      send(ws, { type: 'answer:ack', answer });
      announceSubmitted(room);
      return;
    }

    case 'ping': {
      send(ws, { type: 'pong' });
      return;
    }
  }
}

wss.on('connection', (ws) => {
  ws.id = null;
  ws.role = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    if (raw.length > 64 * 1024) return;
    handleMessage(ws, raw);
  });
  ws.on('close', () => {
    const room = ws.roomRef;
    if (room) leaveRoom(room, ws);
  });
  ws.on('error', () => {});
});

/* keep-alive: drop dead sockets so rooms don't accumulate ghosts */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  const { port } = server.address();
  console.log(`Teacher Trivia running at http://localhost:${port}`);
});