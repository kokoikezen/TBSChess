/* ui.js — 보드 그리기와 조작
 *
 * 엔진(GameRules.Game)은 UI 를 모른다. 여기서는 상태를 읽어 그리고,
 * 클릭을 엔진 메서드 호출로 바꾸는 일만 한다.
 * 보드 좌표 변환은 "삼국 마석 헥스맵" 과 같은 값을 쓴다 (R=27 의 납작한 열 배치).
 */
(function (global) {
  'use strict';

  const B = global.Board;
  const P = global.Pieces;
  const R = global.GameRules;

  const RES_VAR = { F: '--food', W: '--wood', I: '--iron', M: '--mana' };
  const RES_INK = { F: '--food-ink', W: '--wood-ink', I: '--iron-ink', M: '--mana-ink' };
  const PCOL = ['--p1', '--p2', '--p3'];
  const HEX_R = 27, SQ = Math.sqrt(3) / 2, PAD = 36;

  const PHASE_TEXT = {
    setup: '① 첫 공짜 소환',
    roll: '① 주사위',
    discard: '7 — 절반 버리기',
    robber: '7 — 도둑 이동',
    action: '③ 교역 · ④ 행위 1회',
    gameover: '게임 종료',
  };

  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  class UI {
    constructor(game, svg) {
      this.game = game;
      this.svg = svg;
      this.sel = null;          // 선택한 내 기물의 칸
      this.summonType = null;   // 소환 대기 중인 기물
      this.extraPicks = [];     // 추가 비용으로 낼 자원
      this.message = '';
      this.nodes = {};
      this.lastAttention = null;  // 마지막으로 알린 "내가 할 일" — 바뀔 때만 다시 알린다
      this.fatigueStage = null;   // 전쟁 피로 단계 — 올라가는 순간 모두에게 알린다
      this.endShown = false;      // 게임 종료 창은 판마다 한 번만 띄운다
      this.baseTitle = document.title;
      this.buildBoard();
      this.bindPanels();
      game.onChange = () => this.render();
      setInterval(() => this.tick(), 250);
      this.render();
    }

    // ---- 보드 뼈대 -------------------------------------------------------

    buildBoard() {
      const W = 17 * HEX_R + 2 * PAD;
      const H = 22 * SQ * HEX_R + 2 * PAD;
      this.cx = W / 2; this.cy = H / 2;
      this.svg.setAttribute('viewBox', '0 0 ' + Math.round(W) + ' ' + Math.round(H));
      this.svg.innerHTML = global.ICONS;

      const layer = svgEl('g', {}, this.svg);
      for (const id of B.order) {
        const c = B.cells[id];
        const X = this.px(c), Y = this.py(c);
        const g = svgEl('g', {}, layer);
        const node = { g, x: X, y: Y };

        const fill = c.terrain === 'S'
          ? 'var(' + PCOL[B.HOMES.indexOf(id)] + ')'
          : 'var(' + RES_VAR[c.terrain] + ')';
        node.hex = svgEl('polygon', {
          points: this.hexPoints(X, Y, HEX_R - 0.5), class: 'hex', fill,
          tabindex: '0', role: 'button', 'aria-label': id,
        }, g);

        // 지형 아이콘 — 숫자 토큰이 있으면 위쪽에 작게
        const key = id === B.CENTER ? 'C' : c.terrain;
        const big = !c.dice;
        const size = big ? (id === B.CENTER ? 26 : 23) : 15;
        svgEl('use', {
          href: '#i-' + key, x: X - size / 2,
          y: big ? Y - size / 2 : Y - HEX_R * 0.66,
          width: size, height: size, class: 'ico',
          style: 'color:' + (c.terrain === 'S' ? '#fff' : 'var(' + RES_INK[c.terrain] + ')'),
        }, g);

        if (c.dice) {
          const tok = svgEl('g', { class: 'tok' }, g);
          svgEl('circle', { cx: X, cy: Y + HEX_R * 0.42, r: 8.2 }, tok);
          const t = svgEl('text', {
            x: X, y: Y + HEX_R * 0.42 + 0.5,
            class: (c.dice === 6 || c.dice === 7 || c.dice === 8) ? 'hot' : '',
          }, tok);
          t.textContent = c.dice;
        }

        node.own = svgEl('polygon', { points: this.hexPoints(X, Y, HEX_R - 3.2), class: 'own', stroke: 'none' }, g);
        node.hl = svgEl('polygon', { points: this.hexPoints(X, Y, HEX_R - 2), class: 'hl' }, g);
        node.ring = svgEl('circle', { cx: X, cy: Y, r: HEX_R - 7, class: 'ring', stroke: 'none' }, g);
        node.glyph = svgEl('text', { x: X, y: Y + 1, class: 'glyph' }, g);
        // 기물이 숫자 토큰을 가리므로, 기물이 서 있을 때는 아래쪽에 숫자를 작게 다시 적는다
        if (c.dice) {
          node.badge = svgEl('g', { class: 'badge' }, g);
          svgEl('circle', { cx: X, cy: Y + HEX_R * 0.64, r: 7.2 }, node.badge);
          svgEl('text', {
            x: X, y: Y + HEX_R * 0.64 + 0.5,
            class: (c.dice === 6 || c.dice === 7 || c.dice === 8) ? 'hot' : '',
          }, node.badge).textContent = c.dice;
          node.badge.style.display = 'none';
        }

        node.hex.addEventListener('click', () => this.click(id));
        node.hex.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(id); }
        });
        this.nodes[id] = node;
      }
      this.drawAxes();
      // 아우라와 연결선은 모든 칸 위에 그려야 이웃 칸에 가리지 않는다.
      this.overlay = svgEl('g', { class: 'overlay' }, this.svg);
      // 도둑도 맨 위에 그린다. 칸 안에 두면 뒤에 그려진 이웃 칸에 가려 보이지 않았다.
      this.robberMark = svgEl('g', { class: 'robber-mark' }, this.svg);
      svgEl('circle', { cx: 0, cy: 0, r: 12.5, class: 'robber-disc' }, this.robberMark);
      svgEl('text', { x: 0, y: 1, class: 'robber-glyph' }, this.robberMark).textContent = '🦝';
      this.robberMark.style.display = 'none';
    }

    px(c) { return this.cx + c.x * 1.5 * HEX_R; }
    py(c) { return this.cy - c.y * SQ * HEX_R; }

    hexPoints(X, Y, r) {
      return [0, 1, 2, 3, 4, 5].map(k => {
        const a = Math.PI / 3 * k;
        return (X + r * Math.cos(a)).toFixed(1) + ',' + (Y + r * Math.sin(a)).toFixed(1);
      }).join(' ');
    }

    drawAxes() {
      B.FILES.split('').forEach(f => {
        const c = B.cells[f + '1'];
        svgEl('text', { x: this.px(c), y: this.py(c) + HEX_R * 1.4, class: 'axis' }, this.svg).textContent = f;
      });
      for (let r = 1; r <= 6; r++) {
        const a = B.cells['a' + r], l = B.cells['l' + r];
        svgEl('text', { x: this.px(a) - HEX_R * 1.35, y: this.py(a), class: 'axis' }, this.svg).textContent = r;
        svgEl('text', { x: this.px(l) + HEX_R * 1.35, y: this.py(l), class: 'axis' }, this.svg).textContent = r;
      }
      for (let r = 7; r <= 11; r++) {
        const a = B.cells[B.FILES[r - 6] + r], b = B.cells[B.FILES[16 - r] + r];
        svgEl('text', { x: this.px(a) - HEX_R * 0.85, y: this.py(a) - HEX_R * 1.05, class: 'axis' }, this.svg).textContent = r;
        svgEl('text', { x: this.px(b) + HEX_R * 0.85, y: this.py(b) - HEX_R * 1.05, class: 'axis' }, this.svg).textContent = r;
      }
    }

    // ---- 클릭 ------------------------------------------------------------

    click(id) {
      const g = this.game;
      this.message = '';
      if (!this.myMove()) return this.render();
      if (g.phase === 'setup') return this.report(g.place(id));
      if (g.phase === 'robber') return this.report(g.moveRobber(id));
      if (g.phase !== 'action' || g.actionUsed || g.pendingPromotion) return this.render();

      if (this.summonType) {
        if (this.targets().indexOf(id) >= 0) {
          const r = g.summon(this.summonType, id, this.extraPicks);
          if (r.ok) { this.summonType = null; this.extraPicks = []; }
          return this.report(r);
        }
        this.summonType = null; this.extraPicks = [];
      }
      if (this.sel && this.targets().indexOf(id) >= 0) {
        const r = g.move(this.sel, id);
        if (r.ok) this.sel = null;
        return this.report(r);
      }
      const piece = g.pieces.get(id);
      this.sel = (piece && piece.owner === g.current && g.legalMoves(id).length) ? id : null;
      if (piece && piece.owner === g.current && !g.legalMoves(id).length) {
        this.message = P.PIECE_INFO[piece.type].name + '은 갈 수 있는 칸이 없습니다.';
      }
      this.render();
    }

    /** 지금 판에서 뭔가를 골라야 하는 사람이 나인가 (온라인에서는 내 자리일 때만) */
    myMove() {
      const g = this.game;
      if (g.phase === 'setup') return !!g.setupJob() && g.canAct(g.setupJob().player);
      if (g.phase === 'discard') return !!g.discardJob() && g.canAct(g.discardJob().player);
      if (g.pendingPromotion) return g.canAct(g.pendingPromotion.player);
      if (g.phase === 'gameover') return false;
      return g.canAct(g.current);
    }

    report(result) {
      if (result && !result.ok) this.message = result.message;
      this.render();
    }

    /** 지금 강조해야 하는 칸 목록 */
    targets() {
      const g = this.game;
      if (!this.myMove()) return [];
      if (g.phase === 'setup') return g.setupCells(g.setupJob().player);
      if (g.phase === 'robber') return B.order.filter(id => id !== g.robber && B.cells[id].terrain !== 'S');
      if (g.phase !== 'action') return [];
      if (this.summonType) {
        if (g.surcharge(g.current).extra !== this.extraPicks.length) return [];
        return g.legalSummonCells(this.summonType);
      }
      if (this.sel) return g.legalMoves(this.sel).map(m => m.to);
      return [];
    }

    // ---- 그리기 ----------------------------------------------------------

    render() {
      const g = this.game;
      if (g.phase !== 'action') { this.sel = null; this.summonType = null; this.extraPicks = []; }
      const targets = new Set(this.targets());
      const captures = new Set(
        (g.phase === 'action' && this.sel ? g.legalMoves(this.sel) : [])
          .filter(m => m.capture).map(m => m.to));
      const threats = this.threats();
      const mine = threats.find(t => t.player === g.current);
      const myKing = g.kingOf(g.current);

      for (const id of B.order) {
        const n = this.nodes[id];
        const owner = g.owners[id];
        n.own.setAttribute('stroke', owner === undefined ? 'none' : 'var(' + PCOL[owner] + ')');

        const piece = g.pieces.get(id);
        n.glyph.textContent = piece ? P.PIECE_INFO[piece.type].glyph : '';
        n.glyph.setAttribute('fill', piece ? 'var(' + PCOL[piece.owner] + ')' : 'none');
        if (n.badge) n.badge.style.display = piece ? '' : 'none';

        n.hex.classList.toggle('robbed', g.robber === id);

        let ring = 'none', dash = 'none';
        const robberTarget = g.phase === 'robber' && targets.has(id);
        const promoting = !!g.pendingPromotion && g.pendingPromotion.at === id;
        if (robberTarget) { ring = 'var(--hot)'; dash = '4 4'; }
        else if (targets.has(id)) { ring = captures.has(id) ? 'var(--hot)' : 'var(--ink)'; dash = captures.has(id) ? 'none' : '5 4'; }
        else if (promoting) ring = 'var(' + PCOL[g.pendingPromotion.player] + ')';
        else if (id === myKing && mine) ring = 'var(--hot)';
        n.ring.setAttribute('stroke', ring);
        n.ring.setAttribute('stroke-dasharray', dash);
        n.ring.classList.toggle('pulse', robberTarget || promoting);
        // 갈 수 있는 칸 · 놓을 수 있는 칸은 밝은 노란색으로 반짝인다 (도둑 칸 고르기는 붉은 점선 그대로)
        n.hl.classList.toggle('on', targets.has(id) && !robberTarget);

        n.hex.classList.toggle('sel', id === this.sel);
        const clickable = this.myMove() && (g.phase === 'setup' || g.phase === 'robber'
          || (g.phase === 'action' && !g.actionUsed && !g.pendingPromotion));
        n.hex.classList.toggle('click', clickable);
      }

      this.renderAura(threats);
      this.renderRobber();
      this.renderFatigue();
      this.renderTurn();
      this.renderHand();
      this.renderSummon();
      this.renderTrade();
      this.renderPlayers();
      this.renderLog();
      this.renderBanner();
      this.renderAttention();
      this.renderEnd();
    }

    /** 도둑 표시 — 칸 오른쪽 위에 작은 원판 */
    renderRobber() {
      const id = this.game.robber;
      if (!id) { this.robberMark.style.display = 'none'; return; }
      const n = this.nodes[id];
      const by = this.game.robberBy;
      // 원판은 도둑을 옮긴 사람의 진영 색
      this.robberMark.style.setProperty('--by', by === null || by === undefined ? 'var(--hot)' : 'var(' + PCOL[by] + ')');
      this.robberMark.style.display = '';
      this.robberMark.setAttribute('transform',
        'translate(' + (n.x + HEX_R * 0.5).toFixed(1) + ',' + (n.y - HEX_R * 0.48).toFixed(1) + ')');
    }

    // ---- 전쟁 피로 -------------------------------------------------------

    /** 0: 평시, 1: 소환 +1, 2: 소환 불가 */
    fatigueStageOf(round) {
      return round >= R.FATIGUE_NO_SUMMON ? 2 : (round >= R.FATIGUE_SURCHARGE ? 1 : 0);
    }

    /** 보드 맨 위 줄 — 전쟁 피로까지 몇 라운드 남았는지. 단계가 올라가면 알린다. */
    renderFatigue() {
      const g = this.game;
      const r = g.round;
      const stage = this.fatigueStageOf(r);
      const left = n => '<b>' + n + '라운드</b>';
      let html;
      if (g.phase === 'gameover') html = '게임 종료 · ' + r + '라운드';
      else if (stage === 0) {
        html = '전쟁 피로까지 ' + left(R.FATIGUE_SURCHARGE - r) + ' 남음 <span class="lab">'
          + R.FATIGUE_SURCHARGE + '라운드부터 소환 비용 +1</span>';
      } else if (stage === 1) {
        html = '<span class="warn">전쟁 피로</span> 소환 비용 +1 · 소환 불가까지 ' + left(R.FATIGUE_NO_SUMMON - r) + ' 남음';
      } else {
        html = '<span class="warn">전쟁 피로</span> 소환 불가 · 게임 종료까지 ' + left(R.FINAL_ROUND - r + 1) + ' 남음';
      }
      const el = $('fatigue');
      el.innerHTML = '<span class="rnd">' + r + ' / ' + R.FINAL_ROUND + '라운드</span>' + html;
      el.classList.toggle('on', stage > 0 && g.phase !== 'gameover');

      // 처음 그릴 때는 알리지 않는다 (중간에 접속한 사람에게 지난 일을 알리지 않도록)
      if (this.fatigueStage !== null && stage > this.fatigueStage && g.phase !== 'gameover') {
        // 라운드가 바뀌는 순간은 차례 알림과 겹치므로, 띄우는 일은 renderAttention 이 합쳐서 한다
        this.fatigueNote = stage === 1
          ? '⚔ 전쟁 피로 시작! 이제 모든 소환 비용 +1'
          : '⚔ 전쟁 피로 심화! 이제 소환할 수 없습니다';
      }
      this.fatigueStage = stage;
    }

    // ---- 게임 종료 -------------------------------------------------------

    renderEnd() {
      const g = this.game;
      const modal = $('endmodal');
      if (g.phase !== 'gameover') { this.endShown = false; modal.hidden = true; return; }
      if (this.endShown) return;
      this.endShown = true;

      const winners = g.winners || [];
      const names = winners.map(i => 'P' + (i + 1)).join(' · ');
      const last = g.log.length ? g.log[g.log.length - 1].text : '';
      const why = (last.match(/\((.*)\)$/) || [])[1] || '';
      let title, icon, kind;
      if (g.viewer === null) { title = names + ' 승리!'; icon = '🏆'; kind = 'win'; }
      else if (winners.indexOf(g.viewer) >= 0) {
        title = winners.length > 1 ? '공동 승리! (' + names + ')' : '승리!'; icon = '🏆'; kind = 'win';
      } else { title = '패배'; icon = '💀'; kind = 'lose'; }

      $('endicon').textContent = icon;
      $('endtitle').textContent = title;
      $('endwhy').textContent = (g.viewer !== null && kind === 'lose' ? names + ' 승리 — ' : '') + why;
      modal.querySelector('.modal-card').className = 'modal-card ' + kind;
      $('endcount').value = $('pcount').value;
      modal.hidden = false;
      if (!this.hotseat()) this.beep(kind === 'win' ? 'turn' : 'danger');
    }

    /** 새 게임. 온라인은 방 전체에, 핫시트는 페이지를 새로 연다. */
    restart(count) {
      if (global.Net && global.Net.token) { global.Net.reset(count); return; }
      const url = new URL(location.href);
      if (count === 2) url.searchParams.set('players', '2'); else url.searchParams.delete('players');
      location.href = url.toString();
    }

    // ---- 내 차례 알림 ----------------------------------------------------

    /** 핫시트(한 기기에서 여럿이)인가 */
    hotseat() { return this.game.viewer === null && this.game.controls.length > 1; }

    /** 지금 무언가를 골라야 하는 자리 */
    actor() {
      const g = this.game;
      if (g.phase === 'setup' && g.setupJob()) return g.setupJob().player;
      if (g.phase === 'discard' && g.discardJob()) return g.discardJob().player;
      if (g.pendingPromotion) return g.pendingPromotion.player;
      return g.current;
    }

    /** 지금 내가 꼭 해야 하는 일. key 가 바뀌는 순간에만 알림을 띄운다
     *  (같은 턴 안에서 주사위 → 행위로 넘어갈 때는 다시 알리지 않는다). */
    attention() {
      const g = this.game;
      if (g.phase === 'gameover') return null;
      const name = i => (this.hotseat() ? 'P' + (i + 1) + ' — ' : '');
      if (g.offer && g.canAct(g.offer.to) && !this.hotseat()) {
        return { key: 'offer:' + g.log.length, kind: 'info', text: 'P' + (g.offer.from + 1) + '이 교역을 제안했습니다' };
      }
      if (!this.myMove()) return null;
      const turn = g.round + ':' + g.current;
      const who = this.actor();
      if (g.phase === 'setup') {
        return { key: 'setup:' + who, kind: 'turn', text: name(who) + '내 차례! 킹 주변에 기물을 놓으세요' };
      }
      if (g.phase === 'discard') {
        return { key: 'discard:' + turn + ':' + who, kind: 'danger',
          text: name(who) + '7이 나왔습니다! 자원 ' + g.discardJob().count + '장을 버리세요' };
      }
      if (g.phase === 'robber') {
        return { key: 'robber:' + turn, kind: 'danger', text: name(who) + '🦝 7! 도둑을 옮길 칸을 고르세요' };
      }
      if (g.pendingPromotion) {
        return { key: 'promo:' + turn, kind: 'turn', text: name(who) + '폰 승급! 바꿀 기물을 고르세요' };
      }
      return { key: 'turn:' + turn, kind: 'turn', text: name(who) + '내 차례입니다! 주사위를 굴리세요' };
    }

    renderAttention() {
      const g = this.game;
      const urgent = this.myMove() && g.phase !== 'gameover';
      const card = $('turncard');
      card.classList.toggle('myturn', urgent);
      card.style.setProperty('--me', 'var(' + PCOL[this.actor()] + ')');
      if (!this.hotseat()) document.title = (urgent ? '● 내 차례 — ' : '') + this.baseTitle;

      const att = this.attention();
      const key = att ? att.key : null;
      const fresh = att && key !== this.lastAttention;
      this.lastAttention = key;
      const note = this.fatigueNote;
      this.fatigueNote = null;
      if (note) {
        this.toast(note + (fresh ? '\n' + att.text : ''), 'danger');
        if (!this.hotseat()) this.beep('danger');
        return;
      }
      if (!fresh) return;
      this.toast(att.text, att.kind);
      if (!this.hotseat()) this.beep(att.kind);
    }

    toast(text, kind) {
      const t = $('toast');
      if (!t) return;
      t.textContent = text;
      t.className = 'toast ' + (kind || 'turn');
      t.style.setProperty('--me', 'var(' + PCOL[this.actor()] + ')');
      t.hidden = false;
      void t.offsetWidth;                 // 애니메이션을 처음부터 다시
      t.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { t.classList.remove('show'); t.hidden = true; },
        kind === 'danger' ? 3600 : 2600);
    }

    /** 짧은 알림음. 브라우저가 소리를 막아 두었으면(아직 아무것도 안 눌렀으면) 조용히 넘어간다. */
    beep(kind) {
      try {
        const Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return;
        this.audio = this.audio || new Ctx();
        const ctx = this.audio;
        const notes = kind === 'danger' ? [660, 440, 660] : [523, 784];
        notes.forEach((f, k) => {
          const o = ctx.createOscillator(), gain = ctx.createGain();
          const at = ctx.currentTime + k * 0.16;
          o.frequency.value = f;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
          o.connect(gain).connect(ctx.destination);
          o.start(at); o.stop(at + 0.15);
        });
      } catch (e) { /* 소리는 덤이다 */ }
    }

    /** 지금 체크를 받고 있는 킹과, 체크를 거는 기물들.
     *  차례인 사람은 물론, 온라인에서 내 킹이 위협받고 있으면 그것도 같이 보여 준다. */
    threats() {
      const g = this.game;
      if (g.phase === 'gameover' || g.phase === 'setup') return [];
      const seats = [g.current];
      if (g.viewer !== null && g.viewer !== g.current) seats.push(g.viewer);
      const out = [];
      seats.forEach(i => {
        if (!g.player(i).alive) return;
        const by = g.checkers(i);
        if (by.length) out.push({ player: i, king: g.kingOf(i), by });
      });
      return out;
    }

    /** 체크를 거는 기물과 킹을 붉게 감싸고, 둘을 선으로 잇는다. */
    renderAura(threats) {
      const g = this.game;
      while (this.overlay.firstChild) this.overlay.removeChild(this.overlay.firstChild);
      threats.forEach(t => {
        const k = this.nodes[t.king];
        t.by.forEach(id => {
          const a = this.nodes[id];
          svgEl('line', {
            x1: a.x, y1: a.y, x2: k.x, y2: k.y, class: 'aura-line',
          }, this.overlay);
        });
        t.by.forEach(id => {
          const a = this.nodes[id];
          svgEl('circle', { cx: a.x, cy: a.y, r: HEX_R * 1.12, class: 'aura' }, this.overlay);
          const piece = g.pieces.get(id);
          if (piece) {
            const tag = svgEl('text', { x: a.x, y: a.y + HEX_R * 1.28, class: 'aura-tag' }, this.overlay);
            tag.textContent = P.PIECE_INFO[piece.type].name;
          }
        });
        svgEl('circle', { cx: k.x, cy: k.y, r: HEX_R * 1.12, class: 'aura king' }, this.overlay);
      });
    }

    renderTurn() {
      const g = this.game;
      const who = g.phase === 'setup' ? g.setupJob().player : g.current;
      $('turn').innerHTML = '<span class="pname"><span class="pdot" style="background:var(' + PCOL[who] + ')"></span>'
        + 'P' + (who + 1) + ' · ' + B.HOMES[who] + '</span>'
        + '<span class="clock' + (this.lowClock() ? ' low' : '') + '" id="clock">' + this.clockText() + '</span>';
      const bits = [PHASE_TEXT[g.phase], g.round + '라운드'];
      bits.push(g.robber
        ? '🦝 도둑 ' + g.robber + (g.robberBy !== null ? ' (P' + (g.robberBy + 1) + '이 옮김)' : '')
        : '🦝 도둑 판 밖');
      if (g.round >= R.FATIGUE_NO_SUMMON) bits.push('소환 불가');
      else if (g.round >= R.FATIGUE_SURCHARGE) bits.push('소환 비용 +1');
      if (g.phase !== 'gameover' && g.inCheck(g.current)) {
        const by = g.checkers(g.current).map(id => {
          const pc = g.pieces.get(id);
          return id + ' ' + (pc ? 'P' + (pc.owner + 1) + ' ' + P.PIECE_INFO[pc.type].name : '');
        }).join(', ');
        bits.push('체크 (' + by + ')');
        bits.push(g.hasCheckRelief() ? '체크를 푸는 행위만' : '풀 방법 없음 — 아무 행위나 가능');
      }
      $('phase').textContent = bits.join(' · ');

      const d = g.dice;
      $('dice').innerHTML = d
        ? '<span class="die">' + d[0] + '</span><span class="die">' + d[1] + '</span><span class="sum">= ' + (d[0] + d[1]) + '</span>'
        : '<span class="sum">아직 굴리지 않았습니다</span>';
      $('roll').disabled = g.phase !== 'roll' || !g.canAct(g.current);
      $('pass').disabled = !(g.phase === 'action' && !g.pendingPromotion && g.canAct(g.current));
    }

    clockText() {
      const s = this.game.secondsLeft();
      return s === null ? '–' : s + 's';
    }
    lowClock() {
      const s = this.game.secondsLeft();
      return s !== null && s <= 10;
    }

    tick() {
      const g = this.game;
      const s = g.secondsLeft();
      if (s === null) return;
      const c = $('clock');
      if (c) {
        c.textContent = s + 's';
        c.classList.toggle('low', s <= 10);
      }
      if (s === 0 && g.canAct(g.current) && g.useTimer) g.timeout();
    }

    /** 손패는 본인만 확인 (규칙서 12장). 핫시트에서는 차례인 사람 것만 펼친다. */
    renderHand() {
      const g = this.game;
      const owner = g.viewer !== null ? g.viewer
        : (g.phase === 'discard' ? g.discardJob().player
          : (g.phase === 'setup' ? g.setupJob().player : g.current));
      const hand = g.player(owner).hand;
      $('handwho').textContent = 'P' + (owner + 1);
      $('hand').innerHTML = B.RESOURCES.map(k =>
        '<div class="res sw' + k + '"><div class="n">' + hand[k] + '</div>'
        + '<div class="k">' + B.RES_INFO[k].name + '</div></div>').join('');
      $('handtotal').textContent = R.handSize(hand) + '장'
        + (R.handSize(hand) >= R.DISCARD_LIMIT ? ' · 7이 나오면 절반 버리기' : '');
    }

    renderSummon() {
      const g = this.game;
      const i = g.current;
      const sc = g.surcharge(i);
      const open = g.phase === 'action' && !g.actionUsed && !g.pendingPromotion;

      $('surcharge').textContent = g.summonBlocked()
        ? '전쟁 피로: 소환 불가'
        : (sc.extra ? '추가 비용 +' + sc.extra + ' (' + sc.reasons.join(', ') + ')' : '추가 비용 없음');

      $('summon').innerHTML = P.SUMMONABLE.map(t => {
        const cost = Object.assign({ F: 0, W: 0, I: 0, M: 0 }, P.COSTS[t]);
        const can = open && !g.summonBlocked() && g.canAfford(i, t)
          && !(t === 'Q' && g.queenOnBoard(i)) && g.summonCells(i).length;
        return '<button class="sbtn" data-type="' + t + '"'
          + ' aria-pressed="' + (this.summonType === t) + '"' + (can ? '' : ' disabled') + '>'
          + '<span class="pg">' + P.PIECE_INFO[t].glyph + '</span>'
          + '<span>' + P.PIECE_INFO[t].name + (t === 'Q' ? ' <small>1개</small>' : '') + '</span>'
          + '<span class="cost">' + (R.fmtHand(cost) || '—') + '</span></button>';
      }).join('');
      $('summon').querySelectorAll('button').forEach(b => {
        b.onclick = () => {
          this.summonType = this.summonType === b.dataset.type ? null : b.dataset.type;
          this.extraPicks = [];
          this.sel = null;
          this.message = this.summonType
            ? (g.surcharge(i).extra ? '추가 비용으로 낼 자원을 고르세요.' : '킹과 맞닿은 빈칸을 고르세요.')
            : '';
          this.render();
        };
      });

      // 추가 비용으로 어느 자원을 낼지 고르는 줄
      const need = this.summonType ? sc.extra : 0;
      const box = $('extra');
      if (!need) { box.innerHTML = ''; box.hidden = true; }
      else {
        box.hidden = false;
        const base = P.COSTS[this.summonType];
        const spare = {};
        B.RESOURCES.forEach(k => {
          spare[k] = g.player(i).hand[k] - (base[k] || 0)
            - this.extraPicks.filter(x => x === k).length;
        });
        box.innerHTML = '<p class="lab">추가 비용 ' + this.extraPicks.length + '/' + need + '장</p><div class="row">'
          + B.RESOURCES.map(k => '<button data-k="' + k + '"' + (spare[k] > 0 ? '' : ' disabled') + '>'
            + B.RES_INFO[k].name + '</button>').join('')
          + (this.extraPicks.length ? '<button data-k="reset">되돌리기</button>' : '')
          + '</div>';
        box.querySelectorAll('button').forEach(b => {
          b.onclick = () => {
            if (b.dataset.k === 'reset') this.extraPicks = [];
            else if (this.extraPicks.length < need) this.extraPicks.push(b.dataset.k);
            this.message = this.extraPicks.length === need ? '킹과 맞닿은 빈칸을 고르세요.' : '';
            this.render();
          };
        });
      }
    }

    renderTrade() {
      const g = this.game;
      const open = g.canTrade() && !g.pendingPromotion;
      $('tradecard').hidden = g.phase === 'setup' || g.phase === 'gameover';

      // 은행 4:1
      const hand = g.player(g.current).hand;
      $('bank').innerHTML = B.RESOURCES.map(k =>
        '<button data-k="' + k + '"' + (open && hand[k] >= R.BANK_RATE ? '' : ' disabled') + '>'
        + B.RES_INFO[k].name + R.BANK_RATE + ' →</button>').join('');
      $('bank').querySelectorAll('button').forEach(b => {
        b.onclick = () => { this.bankFrom = b.dataset.k; this.render(); };
      });
      const to = $('bankto');
      to.disabled = !open || !this.bankFrom;
      $('bankdo').disabled = !open || !this.bankFrom;
      $('bankfrom').textContent = this.bankFrom ? B.RES_INFO[this.bankFrom].name + ' ' + R.BANK_RATE + '장' : '왼쪽에서 고르세요';

      // 플레이어 간 교역
      const others = g.alivePlayers().filter(p => p.index !== g.current);
      const sel = $('tradeto');
      sel.innerHTML = others.map(p => '<option value="' + p.index + '">P' + (p.index + 1) + '</option>').join('');
      sel.disabled = !open;
      $('propose').disabled = !open || !others.length;
      $('tradefields').querySelectorAll('input').forEach(inp => { inp.disabled = !open; });

      const o = g.offer;
      const resp = $('offer');
      if (!o) { resp.hidden = true; resp.innerHTML = ''; }
      else {
        resp.hidden = false;
        const mine = g.canAct(o.to);
        resp.innerHTML = '<p class="lab">P' + (o.from + 1) + ' → P' + (o.to + 1) + ' 제안</p>'
          + '<div>' + esc(R.fmtHand(o.offer) || '없음') + ' ↔ ' + esc(R.fmtHand(o.want) || '없음') + '</div>'
          + (mine
            ? '<div class="row" style="margin-top:7px"><button class="primary" id="acc">P' + (o.to + 1) + ' 수락</button>'
              + '<button id="rej">거절</button></div>'
            : '<p class="lab" style="margin-top:7px">P' + (o.to + 1) + '의 대답을 기다립니다.</p>');
        if (mine) {
          $('acc').onclick = () => this.report(g.respondTrade(true));
          $('rej').onclick = () => this.report(g.respondTrade(false));
        }
      }
    }

    renderPlayers() {
      const g = this.game;
      $('players').innerHTML = '<tr><th>진영</th><th>자원</th><th>점령</th><th>기물</th><th>상태</th></tr>'
        + g.players.filter(p => !p.absent).map(p => {
          const st = !p.alive ? p.eliminatedRound + '라운드 탈락'
            : (g.inCheck(p.index) ? '체크' : (g.winners && g.winners.indexOf(p.index) >= 0 ? '승리' : '—'));
          const cur = g.phase !== 'gameover' && p.index === g.current;
          return '<tr class="' + (p.alive ? '' : 'off') + (cur ? ' cur' : '') + '">'
            + '<td><span class="pdot" style="background:var(' + PCOL[p.index] + ')"></span>P' + (p.index + 1)
            + (g.viewer === p.index ? ' (나)' : '') + (cur ? ' ◀ 차례' : '') + '</td>'
            + '<td>' + R.handSize(p.hand) + '</td>'
            + '<td>' + g.ownedCells(p.index).length + '</td>'
            + '<td>' + g.materialOf(p.index) + '</td>'
            + '<td>' + st + '</td></tr>';
        }).join('');
    }

    renderLog() {
      const g = this.game;
      $('log').innerHTML = g.log.slice(-80).map(e =>
        '<div class="e"><span class="r">R' + e.round + '</span>' + esc(e.text) + '</div>').join('');
    }

    /** 지금 무엇을 해야 하는지 한 줄로. 꼭 골라야 하는 것이 있으면 오류 메시지가 그것을 덮지 않는다. */
    renderBanner() {
      const g = this.game;
      const bar = $('banner');
      const note = this.message ? '<span style="color:var(--hot)">' + esc(this.message) + '</span> ' : '';
      let wire = null;

      if (g.phase === 'gameover') {
        bar.innerHTML = '<b>' + g.winners.map(i => 'P' + (i + 1)).join(' · ')
          + ' 승리!</b> 새 게임을 시작하려면 다시 시작을 누르세요.';
      } else if (g.pendingPromotion) {
        const job = g.pendingPromotion;
        const choices = g.promotionChoices(job.player);
        bar.innerHTML = note + '<b>P' + (job.player + 1) + ' 폰 승급</b> (' + job.at + ') — 바꿀 기물을 고르세요: '
          + P.PROMOTIONS.map(t => '<button data-k="' + t + '"' + (choices.indexOf(t) >= 0 ? '' : ' disabled') + '>'
            + P.PIECE_INFO[t].glyph + ' ' + P.PIECE_INFO[t].name + '</button>').join(' ');
        wire = b => this.report(g.choosePromotion(b.dataset.k));
      } else if (g.phase === 'discard') {
        const job = g.discardJob();
        // 엔진은 정확한 장수를 한 번에 받으므로, 다 고를 때까지 여기서 모아 둔다.
        if (!this.draft || this.draft.player !== job.player) {
          this.draft = { player: job.player, picks: { F: 0, W: 0, I: 0, M: 0 } };
        }
        const picks = this.draft.picks;
        const hand = g.player(job.player).hand;
        const chosen = B.RESOURCES.reduce((a, k) => a + picks[k], 0);
        const waitingOn = this.myMove() ? '' : ' <span class="lab" style="margin:0">— P' + (job.player + 1) + '이 고르는 중입니다</span>';
        bar.innerHTML = note + '<b>7! P' + (job.player + 1) + '</b> 자원 ' + job.count + '장 버리기 ('
          + chosen + '/' + job.count + (chosen ? ' — ' + esc(R.fmtHand(picks)) : '') + '): '
          + B.RESOURCES.map(k => '<button data-k="' + k + '"'
            + (hand[k] - picks[k] > 0 && chosen < job.count ? '' : ' disabled') + '>'
            + B.RES_INFO[k].name + '</button>').join(' ')
          + (chosen ? ' <button data-k="reset">되돌리기</button>' : '') + waitingOn;
        wire = b => {
          if (b.dataset.k === 'reset') { this.draft = null; this.message = ''; return this.render(); }
          picks[b.dataset.k] += 1;
          this.message = '';
          if (B.RESOURCES.reduce((a, k) => a + picks[k], 0) < job.count) return this.render();
          this.draft = null;
          this.report(g.discard(picks));
        };
      } else {
        const text = {
          setup: '킹 주변 2칸의 빈칸을 눌러 ' + P.PIECE_INFO[(g.setupJob() || { type: 'P' }).type].name + '을 놓으세요.',
          roll: '주사위를 굴리세요.',
          robber: '도둑을 옮길 칸을 누르세요. 그 칸을 점령한 플레이어의 자원 1장을 빼앗습니다.',
          action: g.actionUsed ? '행위를 다 썼습니다.'
            : (this.summonType ? '소환할 칸을 고르세요.'
              : (this.sel ? '갈 칸을 고르세요.'
                : '기물을 눌러 이동하거나, 오른쪽에서 소환할 기물을 고르세요. 교역은 자유입니다.')),
        }[g.phase];
        // 내 차례가 아니면 누구를 기다리는지 적는다
        const who = this.actor();
        const wait = {
          setup: 'P' + (who + 1) + '이 첫 기물을 놓는 중입니다.',
          roll: 'P' + (who + 1) + ' 차례입니다. 주사위를 기다리는 중…',
          robber: '7이 나왔습니다. P' + (who + 1) + '이 도둑을 옮기는 중입니다.',
          action: 'P' + (who + 1) + ' 차례입니다. 행위를 기다리는 중…',
        }[g.phase];
        bar.innerHTML = note + ((this.myMove() ? text : wait) || '');
      }

      const must = this.myMove() && (g.phase === 'discard' || g.phase === 'robber' || !!g.pendingPromotion);
      bar.classList.toggle('alert', must);
      bar.classList.toggle('mine', this.myMove() && !must && g.phase !== 'gameover');
      bar.style.setProperty('--me', 'var(' + PCOL[this.actor()] + ')');
      bar.classList.toggle('err', !!this.message && !wire);
      if (wire && this.myMove()) bar.querySelectorAll('button').forEach(b => { b.onclick = () => wire(b); });
      else if (wire) bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
    }

    // ---- 패널 버튼 -------------------------------------------------------

    bindPanels() {
      const g = this.game;
      $('roll').onclick = () => this.report(g.roll());
      $('pass').onclick = () => this.report(g.timeout());
      $('bankdo').onclick = () => {
        const r = g.tradeBank(this.bankFrom, $('bankto').value);
        if (r.ok) this.bankFrom = null;
        this.report(r);
      };
      $('propose').onclick = () => {
        const read = which => {
          const out = { F: 0, W: 0, I: 0, M: 0 };
          B.RESOURCES.forEach(k => { out[k] = Math.max(0, parseInt($(which + k).value, 10) || 0); });
          return out;
        };
        this.report(g.proposeTrade(+$('tradeto').value, read('give'), read('get')));
      };
      $('timer').onclick = () => {
        g.useTimer = !g.useTimer;
        $('timer').setAttribute('aria-pressed', g.useTimer);
        if (g.useTimer && (g.phase === 'roll' || g.phase === 'action')) g.startTimer(); else g.stopTimer();
        this.render();
      };
      $('timer').setAttribute('aria-pressed', g.useTimer);
      $('restart').onclick = () => {
        const count = +$('pcount').value;
        if (!confirm(count + '인전으로 새 게임을 시작할까요?')) return;
        this.restart(count);
      };
      $('endrestart').onclick = () => {
        const count = +$('endcount').value;
        $('pcount').value = String(count);
        $('endmodal').hidden = true;
        this.restart(count);
      };
      $('endclose').onclick = () => { $('endmodal').hidden = true; };
    }
  }

  global.UI = UI;
})(window);
