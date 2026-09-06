/* Teacher Trivia — shared client helpers */

window.TT = (() => {
  const bannerEl = () => document.getElementById('reconnect-banner');

  function showBanner(text, ms = 0) {
    const el = bannerEl();
    if (!el) return;
    el.textContent = text;
    el.classList.add('banner--show');
    clearTimeout(el._t);
    if (ms) el._t = setTimeout(() => el.classList.remove('banner--show'), ms);
  }

  function hideBanner() {
    const el = bannerEl();
    if (el) el.classList.remove('banner--show');
  }

  const TT = {
    ws: null,
    handlers: {},
    _reconnect: false,
    _retryDelay: 1200,

    connect(handlers) {
      this.handlers = handlers;
      this._reconnect = true;
      this._open();
    },

    stop() {
      this._reconnect = false;
      if (this.ws) this.ws.close();
    },

    _open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try {
        ws = new WebSocket(`${proto}://${location.host}`);
      } catch {
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this._retryDelay = 1200;
        hideBanner();
        this.handlers.onOpen && this.handlers.onOpen();
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        this.handlers.onMessage && this.handlers.onMessage(m);
      };
      ws.onclose = () => {
        if (this._reconnect) {
          showBanner('Connection lost — reconnecting…');
          setTimeout(() => {
            if (this._reconnect) this._open();
          }, this._retryDelay);
          this._retryDelay = Math.min(this._retryDelay * 1.6, 8000);
        } else {
          hideBanner();
        }
      };
      ws.onerror = () => {};
    },

    send(obj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      }
    },
  };

  function showView(id) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('view--active', v.id === id));
    window.scrollTo(0, 0);
  }

  /**
   * Render a ranked leaderboard into `el`.
   * leaderboard: [{ answer, count }]  |  youKey: normalized answer of the viewer
   */
  function renderLeaderboard(el, leaderboard, youKey, submitted, total) {
    el.innerHTML = '';
    if (!leaderboard || leaderboard.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'lb-empty';
      empty.textContent = 'No answers came in for this one — everyone sat this out!';
      el.appendChild(empty);
      return;
    }
    const max = leaderboard[0].count || 1;
    const list = document.createElement('ol');
    list.className = 'lb';
    leaderboard.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'lb__row' + (youKey && norm(entry.answer) === youKey ? ' lb__row--you' : '');
      const rank = document.createElement('span');
      rank.className = 'lb__rank';
      rank.textContent = leaderboard.indexOf(entry) + 1;
      const name = document.createElement('span');
      name.className = 'lb__name';
      name.textContent = entry.answer;
      const votes = document.createElement('span');
      votes.className = 'lb__votes';
      votes.innerHTML = `<b>${entry.count}</b> ${entry.count === 1 ? 'vote' : 'votes'}`;
      const bar = document.createElement('span');
      bar.className = 'lb__bar';
      bar.style.width = `${Math.max(8, Math.round((entry.count / max) * 100))}%`;
      li.append(rank, name, votes, bar);
      list.appendChild(li);
    });
    el.appendChild(list);
  }

  function norm(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\./g, '')
      .replace(/[^a-z0-9\u00C0-\u024F ]/g, '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { TT, showView, renderLeaderboard, norm, esc, showBanner, hideBanner };
})();

/**
 * A lightweight countdown that drives the timer bar + seconds readout.
 * Returns { stop }.
 */
window.startCountdown = function startCountdown(endsAt, els, onDone) {
  const { bar, secs } = els;
  let raf = null;
  const tick = () => {
    const remaining = Math.max(0, endsAt - Date.now());
    const secsLeft = remaining / 1000;
    const pct = Math.max(0, Math.min(100, (remaining / 10000) * 100));
    if (bar) bar.style.width = `${pct}%`;
    if (secs) secs.textContent = Math.ceil(secsLeft);
    if (secs && secsLeft <= 3.05) {
      const timer = secs.closest('.timer');
      if (timer) timer.classList.add('timer--urgent');
    }
    if (remaining <= 0) {
      if (onDone) onDone();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return {
    stop() {
      if (raf) cancelAnimationFrame(raf);
    },
  };
};