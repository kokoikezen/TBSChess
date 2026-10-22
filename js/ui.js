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
        node.ring = svgEl('circle', { cx: X, cy: Y, r: HEX_R - 7, class: 'ring', stroke: 'none' }, g);
        node.glyph = svgEl('text', { x: X, y: Y + 1, class: 'glyph' }, g);
        node.robber = svgEl('text', { x: X + HEX_R * 0.52, y: Y - HEX_R * 0.5, class: 'robber' }, g);

        node.hex.addEventListener('click', () => this.click(id));
        node.hex.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(id); }
        });
        this.nodes[id] = node;
      }
      this.drawAxes();
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
      if (g.phase === 'setup') return this.report(g.place(id));
      if (g.phase === 'robber') return this.report(g.moveRobber(id));
      if (g.phase !== 'action' || g.actionUsed || g.pendingPawnReturn) return this.render();

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

    report(result) {
      if (result && !result.ok) this.message = result.message;
      this.render();
    }

    /** 지금 강조해야 하는 칸 목록 */
    targets() {
      const g = this.game;
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
      const checkers = new Set(g.phase === 'gameover' ? [] : g.checkers(g.current));
      const myKing = g.kingOf(g.current);

      for (const id of B.order) {
        const n = this.nodes[id];
        const owner = g.owners[id];
        n.own.setAttribute('stroke', owner === undefined ? 'none' : 'var(' + PCOL[owner] + ')');

        const piece = g.pieces.get(id);
        n.glyph.textContent = piece ? P.PIECE_INFO[piece.type].glyph : '';
        n.glyph.setAttribute('fill', piece ? 'var(' + PCOL[piece.owner] + ')' : 'none');

        n.robber.textContent = g.robber === id ? '🦝' : '';

        let ring = 'none', dash = 'none';
        if (targets.has(id)) { ring = captures.has(id) ? 'var(--hot)' : 'var(--ink)'; dash = captures.has(id) ? 'none' : '5 4'; }
        else if (id === myKing && checkers.size) ring = 'var(--hot)';
        else if (checkers.has(id)) { ring = 'var(--hot)'; dash = '3 3'; }
        n.ring.setAttribute('stroke', ring);
        n.ring.setAttribute('stroke-dasharray', dash);

        n.hex.classList.toggle('sel', id === this.sel);
        const clickable = g.phase === 'setup' || g.phase === 'robber'
          || (g.phase === 'action' && !g.actionUsed && !g.pendingPawnReturn);
        n.hex.classList.toggle('click', clickable);
      }

      this.renderTurn();
      this.renderHand();
      this.renderSummon();
      this.renderTrade();
      this.renderPlayers();
      this.renderLog();
      this.renderBanner();
    }

    renderTurn() {
      const g = this.game;
      const who = g.phase === 'setup' ? g.setupJob().player : g.current;
      $('turn').innerHTML = '<span class="pname"><span class="pdot" style="background:var(' + PCOL[who] + ')"></span>'
        + 'P' + (who + 1) + ' · ' + B.HOMES[who] + '</span>'
        + '<span class="clock' + (this.lowClock() ? ' low' : '') + '" id="clock">' + this.clockText() + '</span>';
      const bits = [PHASE_TEXT[g.phase], g.round + '라운드'];
      if (g.round >= R.FATIGUE_NO_SUMMON) bits.push('소환 불가');
      else if (g.round >= R.FATIGUE_SURCHARGE) bits.push('소환 비용 +1');
      if (g.phase !== 'gameover' && g.inCheck(g.current)) {
        bits.push(g.hasCheckRelief() ? '체크 — 체크를 푸는 행위만' : '체크 — 풀 방법 없음, 아무 행위나 가능');
      }
      $('phase').textContent = bits.join(' · ');

      const d = g.dice;
      $('dice').innerHTML = d
        ? '<span class="die">' + d[0] + '</span><span class="die">' + d[1] + '</span><span class="sum">= ' + (d[0] + d[1]) + '</span>'
        : '<span class="sum">아직 굴리지 않았습니다</span>';
      $('roll').disabled = g.phase !== 'roll';
      $('pass').disabled = !(g.phase === 'action' && !g.pendingPawnReturn);
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
      if (s === 0) g.timeout();
    }

    /** 손패는 본인만 확인 (규칙서 12장). 핫시트에서는 차례인 사람 것만 펼친다. */
    renderHand() {
      const g = this.game;
      const owner = g.phase === 'discard' ? g.discardJob().player
        : (g.phase === 'setup' ? g.setupJob().player : g.current);
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
      const open = g.phase === 'action' && !g.actionUsed && !g.pendingPawnReturn;

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
      const open = g.canTrade() && !g.pendingPawnReturn;
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
        resp.innerHTML = '<p class="lab">P' + (o.from + 1) + ' → P' + (o.to + 1) + ' 제안</p>'
          + '<div>' + esc(R.fmtHand(o.offer) || '없음') + ' ↔ ' + esc(R.fmtHand(o.want) || '없음') + '</div>'
          + '<div class="row" style="margin-top:7px"><button class="primary" id="acc">P' + (o.to + 1) + ' 수락</button>'
          + '<button id="rej">거절</button></div>';
        $('acc').onclick = () => this.report(g.respondTrade(true));
        $('rej').onclick = () => this.report(g.respondTrade(false));
      }
    }

    renderPlayers() {
      const g = this.game;
      $('players').innerHTML = '<tr><th>진영</th><th>자원</th><th>점령</th><th>기물</th><th>상태</th></tr>'
        + g.players.map(p => {
          const st = !p.alive ? p.eliminatedRound + '라운드 탈락'
            : (g.inCheck(p.index) ? '체크' : (g.winners && g.winners.indexOf(p.index) >= 0 ? '승리' : '—'));
          return '<tr class="' + (p.alive ? '' : 'off') + '">'
            + '<td><span class="pdot" style="background:var(' + PCOL[p.index] + ')"></span>P' + (p.index + 1) + '</td>'
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
      } else if (g.pendingPawnReturn) {
        bar.innerHTML = note + '<b>폰 귀환</b> — 받을 자원을 고르세요 ('
          + g.pendingPawnReturn.remaining + '장 남음): '
          + B.RESOURCES.map(k => '<button data-k="' + k + '">' + B.RES_INFO[k].name + '</button>').join(' ');
        wire = b => this.report(g.choosePawnReward(b.dataset.k));
      } else if (g.phase === 'discard') {
        const job = g.discardJob();
        // 엔진은 정확한 장수를 한 번에 받으므로, 다 고를 때까지 여기서 모아 둔다.
        if (!this.draft || this.draft.player !== job.player) {
          this.draft = { player: job.player, picks: { F: 0, W: 0, I: 0, M: 0 } };
        }
        const picks = this.draft.picks;
        const hand = g.player(job.player).hand;
        const chosen = B.RESOURCES.reduce((a, k) => a + picks[k], 0);
        bar.innerHTML = note + '<b>P' + (job.player + 1) + '</b> 자원 ' + job.count + '장 버리기 ('
          + chosen + '/' + job.count + (chosen ? ' — ' + esc(R.fmtHand(picks)) : '') + '): '
          + B.RESOURCES.map(k => '<button data-k="' + k + '"'
            + (hand[k] - picks[k] > 0 && chosen < job.count ? '' : ' disabled') + '>'
            + B.RES_INFO[k].name + '</button>').join(' ')
          + (chosen ? ' <button data-k="reset">되돌리기</button>' : '');
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
        bar.innerHTML = note + (text || '');
      }

      bar.classList.toggle('err', !!this.message && !wire);
      if (wire) bar.querySelectorAll('button').forEach(b => { b.onclick = () => wire(b); });
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
      $('restart').onclick = () => { if (confirm('새 게임을 시작할까요?')) location.reload(); };
    }
  }

  global.UI = UI;
})(window);
