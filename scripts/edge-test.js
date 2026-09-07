/** Edge-case checks for the Teacher Trivia server. */
const { WebSocket } = require('ws');
const URL = process.env.URL || 'ws://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name, ok) {
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) failures++;
}

function openSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => {
      ws.on('message', (d) => ws.emit('msg', JSON.parse(d)));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function once(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${type}`)), timeout);
    const h = (m) => {
      if (m.type === type) {
        clearTimeout(t);
        ws.off('msg', h);
        resolve(m);
      }
      if (m.type === 'error') {
        clearTimeout(t);
        ws.off('msg', h);
        resolve(m);
      }
    };
    ws.on('msg', h);
  });
}

async function main() {
  const host = await openSocket();
  host.send(JSON.stringify({ type: 'host:create', name: 'Host' }));
  const room = await once(host, 'room:state');
  const code = room.roomCode;

  // 1. Bad code / missing name
  const bad1 = await openSocket();
  bad1.send(JSON.stringify({ type: 'play:join', roomCode: 'ZZZZZZ', name: 'A' }));
  const e1 = await once(bad1, 'error');
  check('bad room code rejected', !!e1.message);

  const bad2 = await openSocket();
  bad2.send(JSON.stringify({ type: 'play:join', roomCode: code, name: '  ' }));
  const e2 = await once(bad2, 'error');
  check('empty name rejected', !!e2.message);

  // 2. Every room receives the fixed question set and custom questions are rejected
  check('fixed questions loaded', room.questions.length === 10);
  host.send(JSON.stringify({ type: 'host:setQuestions', roomCode: code, questions: [{ text: 'custom?' }] }));
  const fixedError = await once(host, 'error');
  check('custom questions rejected', fixedError.message.includes('fixed'));
  host.send(JSON.stringify({ type: 'host:start', roomCode: code }));
  const gp = await once(host, 'game:phase');
  check('game starts with fixed questions', gp.type === 'game:phase' && gp.phase === 'question');
  host.send(JSON.stringify({ type: 'host:startTimer', roomCode: code }));
  const timerStarted = await once(host, 'game:timer-start');
  check('host starts timer', timerStarted.endsAt > Date.now());
  host.send(JSON.stringify({ type: 'host:setQuestions', roomCode: code, questions: [{ text: 'late?' }] }));
  const e3 = await once(host, 'error');
  check('cannot set questions after start', !!e3.message);

  // 3. Player joining mid-question sees the live question with time left
  const late = await openSocket();
  late.send(JSON.stringify({ type: 'play:join', roomCode: code, name: 'Late Joiner' }));
  const snap = await once(late, 'room:state');
  check('mid-question join gets question', snap.phase === 'question' && !!snap.question && snap.endsAt > Date.now());

  // 4. Answers are normalized: "Mr.Kiran Kale", "kiran kale" group together
  const faculty = 'Mr.Kiran Kale';
  const p1 = await openSocket();
  p1.send(JSON.stringify({ type: 'play:join', roomCode: code, name: 'P1' }));
  await once(p1, 'room:state');
  await sleep(50);
  const p2 = await openSocket();
  p2.send(JSON.stringify({ type: 'play:join', roomCode: code, name: 'P2' }));
  await once(p2, 'room:state');
  await sleep(50);
  p1.send(JSON.stringify({ type: 'play:answer', roomCode: code, answer: faculty }));
  p2.send(JSON.stringify({ type: 'play:answer', roomCode: code, answer: 'kiran kale' }));
  await once(p1, 'answer:ack');
  await once(p2, 'answer:ack');

  const forbid = await openSocket();
  forbid.send(JSON.stringify({ type: 'play:join', roomCode: code, name: 'Blocker' }));
  await once(forbid, 'room:state');
  await sleep(50);
  forbid.send(JSON.stringify({ type: 'play:answer', roomCode: code, answer: 'Not a faculty name' }));
  const eCustom = await once(forbid, 'error');
  check('custom answer rejected', !!eCustom.message);

  host.send(JSON.stringify({ type: 'host:reveal', roomCode: code }));
  const results = await once(host, 'game:results');
  check('name variants group as one answer', results.leaderboard.length === 1 && results.leaderboard[0].count === 2);
  const lateRes = await once(late, 'game:results');
  check('late joiner got results + their own state', lateRes.type === 'game:results' && lateRes.yourAnswer === null);

  // 5. Host disconnects → players hear about it; rejoin within grace resumes the game
  host.close();
  const p1Left = await once(p1, 'host:left');
  check('host:left broadcast on host disconnect', !!p1Left);

  const host2 = await openSocket();
  host2.send(JSON.stringify({ type: 'host:rejoin', roomCode: code }));
  const resumed = await once(host2, 'room:state');
  check('host rejoin resumes room in results phase', resumed.phase === 'results');

  // 6. Next question advances through all fixed questions, then the final next ends the game
  host2.send(JSON.stringify({ type: 'host:next', roomCode: code }));
  const q2 = await once(host2, 'game:phase');
  check('next question starts after results', q2.phase === 'question' && q2.questionIndex === 1);
  host2.send(JSON.stringify({ type: 'host:startTimer', roomCode: code }));
  await once(host2, 'game:timer-start');
  host2.send(JSON.stringify({ type: 'host:reveal', roomCode: code }));
  await once(host2, 'game:results');
  for (let questionIndex = 2; questionIndex < 10; questionIndex++) {
    host2.send(JSON.stringify({ type: 'host:next', roomCode: code }));
    await once(host2, 'game:phase');
    host2.send(JSON.stringify({ type: 'host:startTimer', roomCode: code }));
    await once(host2, 'game:timer-start');
    host2.send(JSON.stringify({ type: 'host:reveal', roomCode: code }));
    await once(host2, 'game:results');
  }
  host2.send(JSON.stringify({ type: 'host:next', roomCode: code }));
  const ended = await once(host2, 'game:ended');
  check('final next ends the game', !!ended);
  const late2 = await openSocket();
  late2.send(JSON.stringify({ type: 'play:join', roomCode: code, name: 'Too Late' }));
  const e4 = await once(late2, 'error');
  check('join after game ended rejected', !!e4.message);

  // 7. Host leaves for good → after the grace period, the room closes and players are told
  const closedP = once(p1, 'room:closed', 6000);
  host2.close();
  const closed = await closedP;
  check('room closed broadcast when host leaves for good', !!closed);

  console.log(failures === 0 ? '\nAll edge checks passed. ✅' : `\n${failures} check(s) failed. ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Edge test failed:', e.message);
  process.exit(1);
});