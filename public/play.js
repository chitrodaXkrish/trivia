/* Teacher Trivia — player client */

(function () {
  const { TT, showView, renderLeaderboard, burstConfetti, esc, showBanner } = window.TT;

  const FACULTY_NAMES = [
    'Mr. Anurag D. Singh',
    'Mrs. Mudra Doshi', 'Mr. Sachin Pawar', 'Dr. Rajesh Giri', 'Mr. Sushant Gawade', 'Mr. Sandesh Patil', 'Mr. Allan Lopes', 'Mr. Deepak Bhise', 'Mrs. Chaitali Mhatre', 'Mr. Iqbal Shaikh', 'Mr. Abhishesh Tripathi', 'Mrs. Usha Nasale', 'Mrs. Rovina Dbritto', 'Mr. Karthik Nadar', 'Mr. Ramchandra Khapare', 'Mr. Umesh Mohite', 'Mrs. Nehali Mhatre', 'Mr. Anthony Paul', 'Mr. Moses Lopes', 'Mrs. Silviya Dmonte', 'Mrs. Poonam Thakre', 'Mr. William Foss', 'Ms. Vedika Bhoir', 'Mr. Ashraf Siddiqui', 'Ms. Marina Thomas', 'Mr. Deepak Nalawade', 'Mr. Rajesh Dubey', 'Mr. Anurag Singh', 'Mr. Nikhil Sontakke', 'Mrs. Mitali Poojari', 'Dr. Jitendra Patil', 'Mr. Bhanudas Vaity', 'Mr. Sanil Lakhimale', 'Mr. Siddharth Jambhavadekar', 'Mr. Ravindra Sonavane', 'Ms. Tanvi S. Patil', 'Ms. Tanvi M. Patil', 'Ms. Sakshi Rokade', 'Mr. Amogh Keluskar', 'Ms. Arshiya Quereshi', 'Ms. Aditi Singh', 'Mr. Mohan Kumar', 'Ms. Swati Mishra', 'Mr. Dharmesh Kumar', 'Mr. Saviour Fargose', 'Mr. Sandeep Yadav', 'Ms. Ashwini Kardile', 'Ms. Aarti Shinde', 'Mr. Hemraj Swami', 'Ms. Mahalaxmi Palinje', 'Ms. Jemika Mali', 'Mr. Vaibhav Dhamnaskar', 'Ms. Aachal R. Dubey', 'Ms. Dr. Sangita Dubey', 'Mr. Mohd. Raqheeb Momin', 'Mr. Deepak Kadam', 'Mr. Ayush Mishra', 'Mr. Varun Gandhi', 'Mr. Saurish Chanda', 'Mr. Utkarsh Anand', 'Dr.Jitendra Saturwar', 'Dr. John Kenny', 'Dr. Bipin Sonavane', 'Ms. Damini Bhuva', 'Mr.Sandeep Dubey', 'Ms. Trecia Fernandes', 'Mr. Jashveer Singh', 'Ms.Palak Thakkar', 'Mr.Kiran Kale', 'Ms. Sonia Fernandes', 'Dr. Mubashir Khan', 'Mr. Samuel Jacobs', 'Mr. Abhishek Patra', 'Ms. Kinjal Borse', 'Dr. Aaradhana Khare', 'Mr. Prashant Manjarekar', 'Mr. Binod Singh', 'Ms.Pravin Jhulum', 'Mr. Narayan Labdhe', 'Mr. Gaurav Patil', 'Ms. Pooja Patil', 'Mr. Vilas Fargose', 'Ms. Bidya Das', 'Mr. Manish Pawade', 'Ms. Priyanka Shrivardhankar', 'Mr. Yash Pimple', 'Mr. Nikhil Sankhe', 'Mr. Yuvraj Todankar', 'Mr. Swapnil Karvir'
  ];

  const state = {
    roomCode: null,
    name: '',
    phase: 'lobby',
    questionIndex: -1,
    totalQuestions: 0,
    endsAt: null,
    yourAnswer: null,
    submitted: false,
    timer: null,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    joinChip: $('join-chip'),
    joinError: $('join-error'),
    joinName: $('join-name'),
    joinCode: $('join-code'),
    btnJoin: $('btn-join'),
    lobbyNote: $('lobby-note'),
    lobbyChip: $('lobby-chip'),
    pQNum: $('p-q-num'),
    pQuestion: $('p-question'),
    pSecs: $('p-secs'),
    pBar: $('p-bar'),
    pRing: $('p-ring'),
    pForm: $('p-form'),
    pAnswer: $('p-answer'),
    btnSubmit: $('btn-submit'),
    pAnswerSuggestions: $('p-answer-suggestions'),
    pSubmittedNote: $('p-submitted-note'),
    pTimeup: $('p-timeup'),
    pAnsweredChip: $('p-answered-chip'),
    rQNum: $('r-q-num'),
    rVoteChip: $('r-vote-chip'),
    rQuestion: $('r-question'),
    rLeaderboard: $('r-leaderboard'),
    rYourVote: $('r-your-vote'),
  };

  const saved = () => {
    try {
      return JSON.parse(sessionStorage.getItem('tt_player') || 'null');
    } catch {
      return null;
    }
  };

  const persist = () => {
    try {
      sessionStorage.setItem('tt_player', JSON.stringify({ code: state.roomCode, name: state.name }));
    } catch {}
  };

  function flashError(message) {
    els.joinError.innerHTML = `<div class="alert alert--error">${esc(message)}</div>`;
    setTimeout(() => {
      if (els.joinError.innerHTML.includes(message)) els.joinError.innerHTML = '';
    }, 5000);
  }

  function normalizeFacultyName(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\./g, ' ')
      .replace(/[-–—]/g, ' ')
      .replace(/^(mr|mrs|ms|miss|dr)\b\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function resolveFacultyAnswer(value) {
    const key = normalizeFacultyName(value);
    if (!key) return null;
    const exact = FACULTY_NAMES.find((name) => normalizeFacultyName(name) === key);
    if (exact) return exact;
    const stripped = FACULTY_NAMES.find((name) => normalizeFacultyName(name.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, '')) === key);
    return stripped || null;
  }

  function buildSuggestions(query) {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) return [];
    const key = normalizeFacultyName(trimmed);
    return FACULTY_NAMES.filter((name) => {
      const label = normalizeFacultyName(name.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, ''));
      return label.includes(key) || normalizeFacultyName(name).includes(key);
    }).slice(0, 8);
  }

  function renderSuggestions(query) {
    const items = buildSuggestions(query);
    els.pAnswerSuggestions.innerHTML = '';
    if (!items.length) {
      els.pAnswerSuggestions.classList.add('hidden');
      return;
    }
    items.forEach((name) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'answer-suggestion';
      item.textContent = name;
      item.addEventListener('click', () => {
        els.pAnswer.value = name;
        els.pAnswerSuggestions.classList.add('hidden');
      });
      els.pAnswerSuggestions.appendChild(item);
    });
    els.pAnswerSuggestions.classList.remove('hidden');
  }

  function clearAnswerSuggestions() {
    setTimeout(() => {
      els.pAnswerSuggestions.classList.add('hidden');
      els.pAnswerSuggestions.innerHTML = '';
    }, 150);
  }

  /* ---------- websocket ---------- */

  function connectPlayer() {
    TT.connect({
      onOpen() {
        TT.send({ type: 'play:join', roomCode: state.roomCode, name: state.name });
      },
      onMessage(m) {
        switch (m.type) {
          case 'room:state':
            applyState(m);
            break;
          case 'game:phase':
            if (m.phase === 'question') showQuestion(m);
            break;
          case 'game:results':
            showResults(m);
            break;
          case 'game:ended':
            stopTimer();
            showView('view-ended');
            break;
          case 'answer:ack':
            state.submitted = true;
            state.yourAnswer = m.answer;
            updateSubmittedUI();
            break;
          case 'submitted':
            els.pAnsweredChip.style.display = 'inline-flex';
            els.pAnsweredChip.textContent = `${m.submitted} answered`;
            break;
          case 'host:left':
            showBanner('The host stepped away — we’ll reconnect when they’re back…', 0);
            break;
          case 'room:closed':
            stopTimer();
            TT.stop();
            showView('view-closed');
            break;
          case 'error':
            if (state.phase === 'lobby' && !state.joined) {
              flashError(m.message);
              showView('view-join');
            }
            break;
        }
      },
    });
  }

  /* ---------- state application ---------- */

  function applyState(m) {
    state.roomCode = m.roomCode;
    state.phase = m.phase;
    state.questionIndex = m.questionIndex;
    state.totalQuestions = m.totalQuestions;
    persist();

    els.joinChip.classList.remove('hidden');
    els.joinChip.textContent = `Room ${m.roomCode}`;

    if (m.phase === 'question') {
      showQuestion({
        questionIndex: m.questionIndex,
        totalQuestions: m.totalQuestions,
        question: m.question,
        endsAt: m.endsAt,
      });
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
    els.lobbyNote.textContent = `Room ${m.roomCode} · waiting for the host to start the game…`;
    els.lobbyChip.textContent = `👥 ${m.playerCount} ${m.playerCount === 1 ? 'teacher' : 'teachers'} in the room`;
    showView('view-lobby');
  }

  /* ---------- question ---------- */

  function stopTimer() {
    if (state.timer) {
      state.timer.stop();
      state.timer = null;
    }
  }

  function showQuestion(m) {
    stopTimer();
    state.phase = 'question';
    state.questionIndex = m.questionIndex;
    state.totalQuestions = m.totalQuestions;
    state.endsAt = m.endsAt;
    state.submitted = false;
    state.yourAnswer = null;

    els.pQNum.textContent = `Question ${m.questionIndex + 1} of ${m.totalQuestions}`;
    els.pQuestion.textContent = m.question;
    els.pForm.classList.remove('hidden');
    els.pAnswer.value = '';
    els.pAnswer.disabled = false;
    els.btnSubmit.disabled = false;
    els.pSubmittedNote.classList.add('hidden');
    els.pTimeup.classList.add('hidden');
    els.pAnsweredChip.style.display = 'none';

    showView('view-question');
    els.pAnswer.focus();

    state.timer = window.startCountdown(
      m.endsAt,
      { bar: els.pBar, secs: els.pSecs, ring: els.pRing },
      () => {
        els.pForm.classList.add('hidden');
        els.pTimeup.classList.remove('hidden');
      }
    );
  }

  function updateSubmittedUI() {
    els.pSubmittedNote.innerHTML = `✓ Submitted: <b>${esc(state.yourAnswer)}</b> — you can change it until time's up.`;
    els.pSubmittedNote.classList.remove('hidden');
  }

  function submitAnswer() {
    const answer = els.pAnswer.value.trim();
    const canonical = resolveFacultyAnswer(answer);
    if (!canonical) {
      els.pAnswer.focus();
      els.pAnswer.setAttribute('aria-invalid', 'true');
      els.pAnswer.value = '';
      els.pAnswerSuggestions.classList.add('hidden');
      showBanner('Please select a faculty from the suggestions only.', 2500);
      return;
    }
    els.pAnswer.removeAttribute('aria-invalid');
    TT.send({ type: 'play:answer', roomCode: state.roomCode, answer: canonical });
  }

  els.btnSubmit.addEventListener('click', submitAnswer);
  els.pAnswer.addEventListener('input', () => {
    renderSuggestions(els.pAnswer.value);
  });
  els.pAnswer.addEventListener('blur', clearAnswerSuggestions);
  els.pAnswer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAnswer();
    }
  });

  /* ---------- results ---------- */

  function showResults(m, fromSnapshot = false) {
    stopTimer();
    state.phase = 'results';
    state.questionIndex = m.questionIndex;
    state.totalQuestions = m.totalQuestions;

    els.rQNum.textContent = `Question ${m.questionIndex + 1} of ${m.totalQuestions}`;
    els.rQuestion.textContent = m.question;
    els.rVoteChip.textContent = `${m.submitted} of ${m.total} answered`;
    els.rLeaderboard.innerHTML = '';
    renderLeaderboard(els.rLeaderboard, m.leaderboard, window.TT.norm(m.yourAnswer), m.submitted, m.total);
    burstConfetti();

    if (m.yourAnswer) {
      const rankWord = m.yourRank === 1 ? 'topped' : `came in #${m.yourRank}`;
      els.rYourVote.innerHTML = `You guessed <b>${esc(m.yourAnswer)}</b> — it ${rankWord} with <b>${m.yourCount}</b> ${m.yourCount === 1 ? 'vote' : 'votes'}.`;
    } else {
      els.rYourVote.innerHTML = 'You didn’t submit an answer this round.';
    }
    if (m.intendedAnswer) {
      els.rYourVote.innerHTML += `<br/><span class="hint">The question was about <b>${esc(m.intendedAnswer)}</b>.</span>`;
    }
    showView('view-results');
  }

  /* ---------- join flow ---------- */

  els.joinCode.addEventListener('input', () => {
    els.joinCode.value = els.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  els.joinName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnJoin.click();
  });
  els.joinCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.btnJoin.click();
  });

  els.btnJoin.addEventListener('click', () => {
    const name = els.joinName.value.trim();
    const code = els.joinCode.value.trim().toUpperCase();
    if (!name) {
      flashError('Please enter your name.');
      els.joinName.focus();
      return;
    }
    if (code.length < 4 || code.length > 8) {
      flashError('The room code has 4-8 characters — check it with your host.');
      els.joinCode.focus();
      return;
    }
    state.roomCode = code;
    state.name = name;
    persist();
    connectPlayer();
  });

  // Returning visitor → auto rejoin the room from this browser session.
  const s = saved();
  if (s && s.code && s.name) {
    state.roomCode = s.code;
    state.name = s.name;
    els.joinName.value = s.name;
    els.joinCode.value = s.code;
    showBanner('Rejoining your room…', 0);
    connectPlayer();
  }
})();