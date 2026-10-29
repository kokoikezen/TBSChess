/* net.js — 온라인 대전 클라이언트
 *
 * 브라우저는 판정을 하지 않는다. 서버가 보낸 상태를 그대로 받아 그리고,
 * 내가 둔 수는 /action 으로 보낼 뿐이다. 규칙 판정은 서버의 같은 엔진이 한다.
 * (화면에서 갈 수 있는 칸을 미리 보여 주려고 클라이언트도 엔진을 들고는 있지만,
 *  그 결과는 어디까지나 안내용이고 최종 판정은 서버 것이 이긴다.)
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'tbs-token';
  const NAME_KEY = 'tbs-name';

  const Net = {
    token: null,
    seat: null,
    room: null,
    game: null,
    ui: null,
    connected: false,

    async start() {
      let stored = null;
      try { stored = localStorage.getItem(TOKEN_KEY); } catch (e) {}
      let name = null;
      try { name = localStorage.getItem(NAME_KEY); } catch (e) {}

      const join = await this.post('/join', { token: stored, name });
      if (!join || !join.ok) { this.fatal('서버에 접속하지 못했습니다.'); return; }
      this.token = join.token;
      this.seat = join.seat;
      try { localStorage.setItem(TOKEN_KEY, join.token); } catch (e) {}

      this.listen();
    },

    listen() {
      const src = new EventSource('/events?token=' + encodeURIComponent(this.token));
      this.src = src;
      src.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        this.connected = true;
        this.seat = msg.seat;
        this.room = msg.room;
        this.apply(msg.state);
      };
      src.onerror = () => {
        this.connected = false;
        this.status('서버와 연결이 끊겼습니다. 다시 연결하는 중…');
        // EventSource 는 스스로 다시 붙는다. 상태는 붙는 즉시 서버가 다시 보낸다.
      };
    },

    /** 서버 상태를 화면에 반영한다. 처음 한 번만 Game·UI 를 만든다. */
    apply(state) {
      if (!this.game) {
        this.game = new GameRules.Game({
          useTimer: false,                           // 시계는 서버가 센다
          controls: this.seat === null ? [] : [this.seat],
          viewer: this.seat,
        });
        this.wrap(this.game);
        this.ui = new UI(this.game, document.getElementById('board'));
        global.game = this.game; global.ui = this.ui;
      }
      this.game.controls = this.seat === null ? [] : [this.seat];
      this.game.applySnapshot(state);
      const pc = document.getElementById('pcount');
      if (pc && this.room && document.activeElement !== pc) pc.value = String(this.room.players);
      this.ui.render();
      this.status('');
    },

    /** 판을 바꾸는 메서드를 전부 서버 호출로 바꿔 끼운다. */
    wrap(game) {
      const self = this;
      const actions = ['place', 'roll', 'discard', 'moveRobber', 'tradeBank', 'proposeTrade',
        'respondTrade', 'summon', 'move', 'choosePawnReward', 'timeout'];
      actions.forEach(type => {
        game[type] = function () {
          const args = Array.prototype.slice.call(arguments);
          self.send(type, args);
          return { ok: true };        // 진짜 결과는 다음 상태와 함께 돌아온다
        };
      });
    },

    async send(type, args) {
      const r = await this.post('/action', { token: this.token, type, args });
      if (r && !r.ok && this.ui) {
        this.ui.message = r.message;      // 서버가 거부한 이유를 그대로 보여 준다
        this.ui.render();
      }
    },

    async post(route, body) {
      try {
        const res = await fetch(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return await res.json();
      } catch (e) {
        this.status('서버에 연결할 수 없습니다.');
        return null;
      }
    },

    /** 새 게임. players 는 2 또는 3 — 방 전체의 인원이 바뀐다. */
    async reset(players) {
      const r = await this.post('/reset', { token: this.token, players });
      if (r && !r.ok && this.ui) { this.ui.message = r.message; this.ui.render(); }
    },

    status(text) {
      const el = document.getElementById('netstatus');
      if (!el) return;
      const seat = this.seat === null ? '관전' : 'P' + (this.seat + 1);
      const sitting = this.room ? this.room.seats.filter(s => s.taken).length : 0;
      const total = this.room ? this.room.players : 3;
      el.textContent = text || (seat + ' · ' + total + '인전 · 접속 ' + sitting + '/' + total);
      el.classList.toggle('on', !!text || !this.connected);
    },

    fatal(text) {
      const bar = document.getElementById('banner');
      if (bar) bar.textContent = text;
    },
  };

  global.Net = Net;
})(window);
