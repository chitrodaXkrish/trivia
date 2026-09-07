/**
 * Simulates a full Teacher Trivia game with N players over real WebSockets.
 *
 *   node scripts/simulate.js [players] [questions]
 *
 * Defaults: 100 players, 3 questions. Prints the leaderboard and timing so you
 * can sanity-check the server under load.
 */
const { WebSocket } = require('ws');

const N = parseInt(process.argv[2] || '100', 10);
const Q_COUNT = parseInt(process.argv[3] || '3', 10);
const URL = process.env.URL || 'ws://localhost:3000';

const NAME_POOL = Array.from({ length: 40 }, (_, i) => `Dr. Teacher ${i + 1}`);
const HOST = 'Mr. Host';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => {
      ws.on('message', (data) => {
        const m = JSON.parse(data);
        ws.emit('msg', m);
      });
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function once(ws, type, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeout);
    const h = (m) => {
      if (m.type === type) {
        clearTimeout(t);
        ws.off('msg', h);
        resolve(m);
      }
      if (m.type === 'error') {
        clearTimeout(t);
        ws.off('msg', h);
        reject(new Error(`server error: ${m.message}`));
      }
    };
    ws.on('msg', h);
  });
}

async function main() {
  console.log(`Simulating ${N} players × ${Q_COUNT} questions against ${URL}…\n`);

  const t0 = Date.now();

  // 1. Host creates a room and sets questions.
  const host = await openSocket();
  host.send(JSON.stringify({ type: 'host:create', name: HOST }));
  const created = await once(host, 'room:state');
  const code = created.roomCode;
  console.log(`Room created: ${code} (phase=${created.phase})`);

  const questions = Array.from({ length: Q_COUNT }, (_, i) => ({
    text: `Who is the kindest teacher of all? (#${i + 1})`,
    answer: i === 0 ? 'Dr. Sharma' : null,
  }));
  host.send(JSON.stringify({ type: 'host:setQuestions', roomCode: code, questions }));
  await once(host, 'questions:set');

  // 2. Players join.
  const players = [];
  for (let i = 0; i < N; i++) {
    const ws = await openSocket();
    ws.send(JSON.stringify({ type: 'play:join', roomCode: code, name: `Teacher ${i + 1}` }));
    await once(ws, 'room:state');
    players.push(ws);
  }
  console.log(`${N} players joined.`);

  // 3. Host starts; players answer as soon as the question appears.
  const questionsDone = [];
  host.send(JSON.stringify({ type: 'host:start', roomCode: code }));

  for (let qi = 0; qi < Q_COUNT; qi++) {
    const qStart = Date.now();
    const resultsP = once(host, 'game:results');
    // Wait for each player to see the question, then answer.
    await Promise.all(
      players.map(async (ws) => {
        await once(ws, 'game:phase');
        // Skew the answers so a few names stand out (like a real staff room).
        const pick = Math.random() < 0.4 ? 'Dr. Sharma' : NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
        ws.send(JSON.stringify({ type: 'play:answer', roomCode: code, answer: pick }));
        await once(ws, 'answer:ack');
      })
    );

    // All players answered — reveal early instead of waiting out the 20s timer.
    host.send(JSON.stringify({ type: 'host:reveal', roomCode: code }));

    const results = await resultsP;
    const elapsed = Date.now() - qStart;
    const top = results.leaderboard
      .slice(0, 5)
      .map((e) => `${e.answer}×${e.count}`)
      .join(', ');
    console.log(
      `Q${qi + 1}: ${results.submitted}/${results.total} answered in ${elapsed}ms — top: ${top}${results.last ? ' (last)' : ''}`
    );
    questionsDone.push(results);

    // Every player should have received the results too.
    await Promise.all(players.map((ws) => once(ws, 'game:results')));

    if (results.last) break;
    host.send(JSON.stringify({ type: 'host:next', roomCode: code }));
    await once(host, 'game:phase');
  }

  // 4. End the game.
  host.send(JSON.stringify({ type: 'host:next', roomCode: code }));
  await once(host, 'game:ended');
  await Promise.all(players.map((ws) => once(ws, 'game:ended')));

  const total = Date.now() - t0;
  console.log(`\nGame finished in ${total}ms. ✅`);

  // Verify tally integrity: vote counts must sum to submitted count.
  for (const r of questionsDone) {
    const sum = r.leaderboard.reduce((a, e) => a + e.count, 0);
    if (sum !== r.submitted) {
      console.error(`✗ Tally mismatch on a question: sum=${sum} submitted=${r.submitted}`);
      process.exit(1);
    }
  }
  console.log('Tally integrity check passed. ✅');

  host.close();
  players.forEach((p) => p.close());
  process.exit(0);
}

main().catch((err) => {
  console.error('Simulation failed:', err.message);
  process.exit(1);
});