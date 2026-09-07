/* Teacher Trivia — host client */

(function () {
  const { TT, showView, renderLeaderboard, renderCode, burstConfetti, esc, showBanner } = window.TT;

  const state = {
    roomCode: null,
    hostName: '',
    questions: [],
    phase: 'lobby',
    questionIndex: -1,
    totalQuestions: 0,
    playerCount: 0,
    submitted: 0,
    timer: null,
    createdOnce: false,
  };

  /* ---------- elements ---------- */

  const $ = (id) => document.getElementById(id);
  const els = {
    roomChip: $('host-room-chip'),
    createError: $('create-error'),
    hostName: $('host-name'),
    btnCreate: $('btn-create'),
    roomCode: $('room-code'),
    qList: $('q-list'),
    qCountChip: $('q-count-chip'),
    btnAddQ: $('btn-add-q'),
    btnStart: $('btn-start'),
    setupError: $('setup-error'),
    gQNum: $('g-q-num'),
    gRosterChip: $('g-roster-chip'),
    gQuestion: $('g-question'),
    gSecs: $('g-secs'),
    gBar: $('g-bar'),
    gRing: $('g-ring'),
    gProgress: $('g-progress'),
    gResultsWrap: $('g-results-wrap'),
    gQuestionWrap: $('g-question-wrap'),
    gLeaderboard: $('g-leaderboard'),
    gVoteChip: $('g-vote-chip'),
    gIntended: $('g-intended'),
    btnReveal: $('btn-reveal'),
    btnStartTimer: $('btn-start-timer'),
    btnNext: $('btn-next'),
    btnEnd: $('btn-end'),
  };

  /* ---------- room code helpers ---------- */

  const saved = () => {
    try {
      return JSON.parse(sessionStorage.getItem('tt_host') || 'null');
    } catch {
      return null;
    }
  };

  const persist = () => {
    try {
      sessionStorage.setItem('tt_host', JSON.stringify({ code: state.roomCode, name: state.hostName }));
    } catch {}
  };

  const clearSavedState = () => {
    state.roomCode = null;
    state.createdOnce = false;
    try {
      sessionStorage.removeItem('tt_host');
    } catch {}
  };

  /* ---------- websocket ---------- */

  function connectHost() {
    TT.connect({
      onOpen() {
        if (state.createdOnce) {
          // reconnected mid-game — reclaim the same room
          const s = saved();
          TT.send({ type: 'host:rejoin', roomCode: s ? s.code : state.roomCode });
        } else {
          TT.send({ type: 'host:create', name: state.hostName });
          state.createdOnce = true;
        }
      },

      onMessage(m) {
        switch (m.type) {
          case 'room:state':
            applyState(m);
            break;
          case 'questions:set':
            state.questions = m.questions;
            renderQuestionList();
            break;
          case 'game:phase':
            if (m.phase === 'question') {
              state.phase = m.phase;
              state.questionIndex = m.questionIndex;
              state.totalQuestions = m.totalQuestions;
              state.submitted = 0;
              showQuestion(m.question, m.endsAt, m.timerStarted);
            }
            break;
          case 'game:timer-start':
            startTimer(m.endsAt, m.serverNow, m.seconds);
            break;
          case 'game:results':
            showResults(m);
            break;
          case 'game:ended':
            state.phase = 'ended';
            stopTimer();
            clearSavedState();
            showView('view-ended');
            break;
          case 'roster':
            state.playerCount = m.playerCount;
            updateRosterChips();
            break;
          case 'submitted':
            state.submitted = m.submitted;
            updateProgress();
            break;
          case 'error':
            if (state.createdOnce && (m.message.includes('already ended') || m.message.includes('Room not found') || m.message.includes('already claimed'))) {
              clearSavedState();
              if (state.hostName) {
                setTimeout(() => {
                  TT.send({ type: 'host:create', name: state.hostName });
                }, 100);
              }
            }
            flashError(els.createError, m.message);
            flashError(els.setupError, m.message);
            break;
        }
      },
    });
  }

  /* ---------- state application (create + rejoin) ---------- */

  function applyState(m) {
    state.roomCode = m.roomCode;
    state.hostName = m.hostName;
    state.phase = m.phase;
    state.questionIndex = m.questionIndex;
    state.totalQuestions = m.totalQuestions;
    state.playerCount = m.playerCount;
    state.questions = m.questions || [];
    state.submitted = m.submitted || 0;
    persist();

    els.roomChip.classList.remove('hidden');
    els.roomChip.innerHTML = `Room <b>${esc(m.roomCode)}</b>`;
    renderCode(els.roomCode, m.roomCode);

    if (m.phase === 'question') {
      showView('view-game');
      showQuestion(m.question, m.endsAt, m.timerStarted, m.serverNow, m.seconds);
      return;
    }
    if (m.phase === 'results') {
      showResults(m, true);
      return;
    }
    if (m.phase === 'ended') {
      showView('view-ended');
      return;
    }
    // lobby
    showView('view-setup');
    renderQuestionList();
    updateRosterChips();
  }

  /* ---------- question editor ---------- */

  function questionRow(q, i) {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.innerHTML = `
      <div class="row row--between">
        <span class="q-row__num">Question ${i + 1}</span>
      </div>
      <div class="q-row__body">
        <div class="q-row__inputs">
          <div class="input q-text-input">${esc(q.text)}</div>
        </div>
      </div>`;
    return row;
  }

  function renderQuestionList() {
    els.qList.innerHTML = '';
    state.questions.forEach((q, i) => els.qList.appendChild(questionRow(q, i)));
    els.qCountChip.classList.toggle('hidden', state.questions.length === 0);
    els.qCountChip.textContent = `${state.questions.length} ${state.questions.length === 1 ? 'question' : 'questions'}`;
    updateStartEnabled();
  }

  function updateStartEnabled() {
    els.btnStart.disabled = state.questions.length === 0;
  }

  els.btnStart.addEventListener('click', () => {
    if (state.questions.length === 0) return;
    TT.send({ type: 'host:start', roomCode: state.roomCode });
  });

  /* ---------- live game ---------- */

  function stopTimer() {
    if (state.timer) {
      state.timer.stop();
      state.timer = null;
    }
  }

  function startTimer(endsAt, serverNow = Date.now(), seconds = 20) {
    const clockOffset = serverNow - Date.now();
    const localEndsAt = endsAt - clockOffset;
    stopTimer();
    els.btnStartTimer.classList.add('hidden');
    els.btnReveal.disabled = false;
    state.timer = window.startCountdown(
      localEndsAt,
      { bar: els.gBar, secs: els.gSecs, ring: els.gRing },
      () => {
        els.gProgress.style.display = 'block';
        els.gProgress.textContent = 'Time’s up — tallying results…';
        els.btnReveal.disabled = true;
      },
      seconds
    );
  }

  function showQuestion(text, endsAt, timerStarted = false, serverNow = Date.now(), seconds = 20) {
    stopTimer();
    state.phase = 'question';
    els.gQNum.textContent = `Question ${state.questionIndex + 1} of ${state.totalQuestions}`;
    els.gQuestion.textContent = text;
    els.gResultsWrap.classList.add('hidden');
    els.gQuestionWrap.classList.remove('hidden');
    els.gProgress.style.display = 'none';
    updateProgress();
    updateRosterChips();
    showView('view-game');
    els.btnStartTimer.classList.toggle('hidden', timerStarted);
    els.btnReveal.disabled = !timerStarted;
    if (timerStarted) startTimer(endsAt, serverNow, seconds);
  }

  function showResults(m, fromSnapshot = false) {
    stopTimer();
    state.phase = 'results';
    state.submitted = m.submitted;
    state.questionIndex = m.questionIndex;
    state.totalQuestions = m.totalQuestions;

    els.gQNum.textContent = `Question ${m.questionIndex + 1} of ${m.totalQuestions}`;
    els.gQuestion.textContent = m.question;
    els.gQuestionWrap.classList.add('hidden');
    els.gProgress.style.display = 'none';
    els.gResultsWrap.classList.remove('hidden');

    renderLeaderboard(els.gLeaderboard, m.leaderboard, null, m.submitted, m.total);
    burstConfetti();
    els.gVoteChip.textContent = `${m.totalSubmitted || m.submitted} total answers`;
    els.gIntended.innerHTML = m.intendedAnswer ? `Intended answer: <b>${esc(m.intendedAnswer)}</b>` : '';
    els.btnEnd.classList.toggle('hidden', !m.last);
    els.btnNext.classList.toggle('hidden', !!m.last);
    updateRosterChips();
    showView('view-game');
  }

  function updateProgress() {
    if (state.phase === 'question') {
      els.gProgress.style.display = 'block';
      els.gProgress.textContent = `${state.submitted} of ${state.playerCount} teachers answered so far`;
    }
  }

  function updateRosterChips() {
    els.gRosterChip.textContent = `👥 ${state.playerCount} ${state.playerCount === 1 ? 'player' : 'players'}`;
  }

  els.btnReveal.addEventListener('click', () => {
    TT.send({ type: 'host:reveal', roomCode: state.roomCode });
  });

  els.btnStartTimer.addEventListener('click', () => {
    TT.send({ type: 'host:startTimer', roomCode: state.roomCode });
  });

  els.btnNext.addEventListener('click', () => {
    TT.send({ type: 'host:next', roomCode: state.roomCode });
  });

  els.btnEnd.addEventListener('click', () => {
    TT.send({ type: 'host:next', roomCode: state.roomCode }); // host:next past the last question ends the game
  });

  /* ---------- create flow ---------- */

  function flashError(el, message) {
    if (!el || !message) return;
    el.innerHTML = `<div class="alert alert--error">${esc(message)}</div>`;
    setTimeout(() => {
      if (el.innerHTML.includes(message)) el.innerHTML = '';
    }, 5000);
  }

  els.hostName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnCreate.click();
  });

  els.btnCreate.addEventListener('click', () => {
    const name = els.hostName.value.trim();
    if (!name) {
      flashError(els.createError, 'Please enter your name.');
      els.hostName.focus();
      return;
    }
    state.hostName = name;
    connectHost();
  });

  // Coming straight to the host page with a room from earlier → reclaim it.
  const s = saved();
  if (s && s.code) {
    state.roomCode = s.code;
    state.hostName = s.name || '';
    els.hostName.value = state.hostName;
    state.createdOnce = true;
    showBanner('Reconnecting to your room…', 0);
    connectHost();
  }
})();