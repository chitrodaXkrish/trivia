# Teacher Trivia 🎓

A friendly guessing game for Teachers' Day. The host creates a private room,
queues preset questions, and the whole staff room guesses a teacher's name for
each question — with a 10-second timer and a live leaderboard.

## How the game works

1. **Host** opens the site, enters their name, and gets a private 6-character
   room code.
2. Host **queues preset questions** (each with an optional intended answer),
   then starts the game.
3. Teachers open the site on their phones, enter the room code + their name,
   and wait in the lobby.
4. Question 1 appears with a **10-second timer**. Everyone types the name they
   think is the answer.
5. When time is up, the **leaderboard** ranks the most-guessed names — if 3
   teachers guessed "X" and 2 guessed "Y", X ranks 1st and Y ranks 2nd.
6. The host reveals results, moves to the **next question**, and the cycle
   repeats until the game ends.

## Run it

Requires Node.js 18+.

```bash
npm install
npm start
```

Open http://localhost:3000 (or your machine's IP for other devices on the
same network). The port can be changed with `PORT=8080 npm start`.

## Test with simulated players

Verify the server under load — a full game with N simulated teachers:

```bash
node scripts/simulate.js 100   # 100 players, 3 questions
node scripts/edge-test.js      # edge cases: bad codes, reconnects, late joins
```

## Offline demo

`public/demo.html` is a self-contained, single-tab demo (host + player +
simulated teachers) that runs entirely in the browser — no server needed.
Rebuild it after theme changes with `node scripts/build-demo.js`.

## Stack

- Node.js + `ws` for the real-time game server (in-memory rooms, one process
  comfortably handles 100+ concurrent players)
- Plain HTML/CSS/JS frontend — no build step
- Fun, festive quiz-show theme: warm cream + confetti dots, marigold/coral/teal
  accents, chunky buttons, a circular countdown ring, medal leaderboard, and
  confetti bursts on results (Fredoka + Nunito)