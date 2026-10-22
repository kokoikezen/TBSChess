/* game.js — 카탄 증강 체스 규칙 엔진 (규칙서 v0.1)
 *
 * UI 를 전혀 모르는 순수 상태 기계다. 모든 변화는 메서드 하나를 거치고,
 * 바뀔 때마다 log 에 한 줄씩 남기고 onChange 를 부른다.
 *
 * 턴 구조 (규칙서 5장)
 *   setup  : 첫 공짜 소환 — 킹 주변 2칸에 폰2 + 나이트1
 *   roll   : 주사위 2개
 *   discard: 합이 7 이고 8장 이상 가진 플레이어가 절반 버리기
 *   robber : 합이 7 이면 굴린 사람이 도둑을 옮기고 1장 약탈, 그 뒤 f6 생산
 *   action : 교역은 자유, 이동 또는 소환 중 하나만 1회 → 턴 종료
 */
(function (global) {
  'use strict';

  const B = global.Board;
  const P = global.Pieces;

  const TURN_SECONDS = 30;          // 규칙서 5장
  const DISCARD_LIMIT = 8;          // 이 장수부터 절반 버리기
  const BANK_RATE = 4;              // 은행 교역 4:1
  const FATIGUE_SURCHARGE = 17;     // 이 라운드부터 소환 비용 +1
  const FATIGUE_NO_SUMMON = 27;     // 이 라운드부터 소환 불가
  const FINAL_ROUND = 32;           // 이 라운드가 끝나면 점령 수로 판정
  const EMERGENCY_SURCHARGE = 1;    // 긴급 소환 추가 비용

  const emptyHand = () => ({ F: 0, W: 0, I: 0, M: 0 });
  const handSize = h => B.RESOURCES.reduce((a, k) => a + h[k], 0);
  const fmtHand = h => B.RESOURCES.filter(k => h[k]).map(k => B.RES_INFO[k].name + h[k]).join('+');

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.rng = opts.rng || Math.random;
      this.useTimer = opts.useTimer !== false;
      this.onChange = opts.onChange || function () {};

      this.owners = {};                 // 칸id -> 플레이어 인덱스 (점령, 규칙서 7장)
      this.pieces = new Map();          // 칸id -> {owner, type}
      this.players = [0, 1, 2].map(i => ({
        index: i,
        home: B.HOMES[i],
        hand: emptyHand(),
        alive: true,
        eliminatedRound: null,
      }));

      this.robber = null;               // 도둑은 판 밖에서 시작
      this.round = 1;
      this.current = 0;
      this.turnStarts = 0;              // 이번 라운드에 턴을 시작한 생존 플레이어 수
      this.dice = null;
      this.actionUsed = false;
      this.phase = 'setup';
      this.setupQueue = [];             // [{player, type}] 순서대로 공짜 배치
      this.pendingDiscards = [];        // [{player, count}]
      this.pendingPawnReturn = null;    // {player, remaining} — 폰 귀환 자원 선택
      this.offer = null;                // 진행 중인 플레이어 간 교역 제안
      this.winners = null;
      this.log = [];
      this.deadline = null;
      this.lastError = null;

      // 킹을 본진에 놓는다 (규칙서 4장). 본진 칸도 점령 표시가 된다.
      this.players.forEach(p => {
        this.pieces.set(p.home, { owner: p.index, type: 'K' });
        this.owners[p.home] = p.index;
      });
      // 세 진영의 2칸 범위는 겹치지 않으므로 순서는 중요하지 않다.
      [0, 1, 2].forEach(i => {
        this.setupQueue.push(
          { player: i, type: 'P' },
          { player: i, type: 'P' },
          { player: i, type: 'N' });
      });
      this.say('플레이어 1부터 킹 주변 2칸에 폰 2개와 나이트 1개를 공짜로 놓습니다.');
    }

    // ---- 기본 조회 -------------------------------------------------------

    say(text) { this.log.push({ round: this.round, text }); }
    alivePlayers() { return this.players.filter(p => p.alive); }
    player(i) { return this.players[i]; }
    handSize(i) { return handSize(this.players[i].hand); }
    kingOf(i) { return P.findKing(this.pieces, i); }
    inCheck(i) { return P.inCheck(this.pieces, i); }
    checkers(i) { return P.checkers(this.pieces, i); }

    ownedCells(i) { return Object.keys(this.owners).filter(id => this.owners[id] === i); }

    materialOf(i) {
      let sum = 0;
      for (const p of this.pieces.values()) if (p.owner === i) sum += P.PIECE_INFO[p.type].value;
      return sum;
    }

    queenOnBoard(i) {
      for (const p of this.pieces.values()) if (p.owner === i && p.type === 'Q') return true;
      return false;
    }

    /** 이번 턴 소환 추가 비용 — 전쟁 피로(11장) + 긴급 소환(8장) */
    surcharge(i) {
      let extra = 0;
      const reasons = [];
      if (this.round >= FATIGUE_SURCHARGE) { extra += 1; reasons.push('전쟁 피로 +1'); }
      if (this.inCheck(i)) { extra += EMERGENCY_SURCHARGE; reasons.push('긴급 소환 +' + EMERGENCY_SURCHARGE); }
      return { extra, reasons };
    }

    summonBlocked() { return this.round >= FATIGUE_NO_SUMMON; }

    /** 소환 가능 칸: 킹과 변이 맞닿은 6칸 중 빈칸 (첫 공짜 소환만 2칸) */
    summonCells(i) {
      const king = this.kingOf(i);
      if (!king) return [];
      return B.neighbors(king).filter(id => !this.pieces.has(id));
    }

    setupCells(i) {
      const king = this.kingOf(i);
      if (!king) return [];
      return B.within(king, 2).filter(id => !this.pieces.has(id));
    }

    /** 실제로 낼 비용. extraFrom 은 추가 비용으로 낼 자원 종류(들). */
    costOf(i, type, extraFrom) {
      const base = P.COSTS[type];
      if (!base) return null;
      const cost = Object.assign(emptyHand(), base);
      const extra = this.surcharge(i).extra;
      if (extra > 0) {
        const picks = [].concat(extraFrom || []);
        if (picks.length !== extra) return null;      // 어느 자원으로 낼지 정해야 한다
        for (const k of picks) {
          if (B.RESOURCES.indexOf(k) < 0) return null;
          cost[k] += 1;
        }
      }
      return cost;
    }

    /** 추가 비용을 아무 자원으로든 낼 수 있는지 — 조합이 하나라도 되면 true */
    affordableWithExtra(i, type, extra) {
      const hand = this.players[i].hand;
      const base = P.COSTS[type];
      let slack = 0;
      for (const k of B.RESOURCES) {
        const need = base[k] || 0;
        if (hand[k] < need) return false;
        slack += hand[k] - need;
      }
      return slack >= extra;
    }

    canAfford(i, type) {
      return this.affordableWithExtra(i, type, this.surcharge(i).extra);
    }

    // ---- 행위 목록 -------------------------------------------------------

    /** 이 기물로 둘 수 있는 수. 체크 중이면 체크가 풀리는 수만 남긴다. */
    legalMoves(from) {
      const piece = this.pieces.get(from);
      if (!piece || piece.owner !== this.current) return [];
      if (this.phase !== 'action' || this.actionUsed) return [];
      const all = P.moves(this.pieces, from);
      if (!this.inCheck(this.current) || !this.hasCheckRelief()) return all;
      return all.filter(m => !P.inCheck(P.withMove(this.pieces, from, m.to), this.current));
    }

    legalSummonCells(type) {
      const i = this.current;
      if (this.phase !== 'action' || this.actionUsed) return [];
      if (this.summonBlocked()) return [];
      if (type === 'Q' && this.queenOnBoard(i)) return [];
      const cells = this.summonCells(i);
      if (!this.inCheck(i) || !this.hasCheckRelief()) return cells;
      return cells.filter(id => !P.inCheck(P.withSummon(this.pieces, id, i, type), i));
    }

    /** 체크를 풀 방법이 하나라도 있는가. 전혀 없으면 아무 행위나 허용(규칙서 10장). */
    hasCheckRelief() {
      const key = this.positionKey();
      if (this._reliefKey === key) return this._relief;
      const i = this.current;
      let relief = false;
      for (const [from, piece] of this.pieces) {
        if (piece.owner !== i) continue;
        for (const m of P.moves(this.pieces, from)) {
          if (!P.inCheck(P.withMove(this.pieces, from, m.to), i)) { relief = true; break; }
        }
        if (relief) break;
      }
      if (!relief && !this.summonBlocked()) {
        // 소환으로 사이를 막는 것도 체크 해소다. 실제로 낼 수 있는 기물만 센다.
        const extra = this.surcharge(i).extra;
        for (const type of P.SUMMONABLE) {
          if (type === 'Q' && this.queenOnBoard(i)) continue;
          if (!this.affordableWithExtra(i, type, extra)) continue;
          for (const id of this.summonCells(i)) {
            if (!P.inCheck(P.withSummon(this.pieces, id, i, type), i)) { relief = true; break; }
          }
          if (relief) break;
        }
      }
      this._reliefKey = key;
      this._relief = relief;
      return relief;
    }

    positionKey() {
      const parts = [];
      for (const [id, p] of this.pieces) parts.push(id + p.owner + p.type);
      return parts.sort().join('|') + '#' + this.current + '#' + this.round
        + '#' + fmtHand(this.players[this.current].hand);
    }

    // ---- 자원 주고받기 ---------------------------------------------------

    give(i, res, n) {
      if (n > 0) this.players[i].hand[res] += n;
    }

    /** 무작위 1장 뽑기 — 약탈과 도둑에 쓴다. */
    stealRandom(from, to) {
      const hand = this.players[from].hand;
      const pool = [];
      B.RESOURCES.forEach(k => { for (let n = 0; n < hand[k]; n++) pool.push(k); });
      if (!pool.length) return null;
      const res = pool[Math.floor(this.rng() * pool.length)];
      hand[res] -= 1;
      if (to !== null && to !== undefined) this.give(to, res, 1);
      return res;
    }

    // ---- 세팅 단계 -------------------------------------------------------

    setupJob() { return this.phase === 'setup' ? this.setupQueue[0] : null; }

    /** 첫 공짜 소환. 킹 주변 2칸의 빈칸에 직접 놓는다. */
    place(id) {
      if (this.phase !== 'setup') return this.fail('세팅 단계가 아닙니다.');
      const job = this.setupQueue[0];
      if (this.setupCells(job.player).indexOf(id) < 0) {
        return this.fail('킹 주변 2칸의 빈칸에만 놓을 수 있습니다.');
      }
      this.pieces.set(id, { owner: job.player, type: job.type });
      this.owners[id] = job.player;      // 기물을 놓은 칸은 점령된다
      this.say('P' + (job.player + 1) + ' ' + P.PIECE_INFO[job.type].name + '을 ' + id + '에 공짜로 놓았습니다.');
      this.setupQueue.shift();
      if (!this.setupQueue.length) {
        this.phase = 'roll';
        this.current = 0;
        this.turnStarts = 1;
        this.startTimer();
        this.say('— 1라운드 시작. P1 차례입니다.');
      } else {
        this.current = this.setupQueue[0].player;
      }
      return this.done();
    }

    // ---- 주사위와 생산 ---------------------------------------------------

    roll() {
      if (this.phase !== 'roll') return this.fail('지금은 주사위를 굴릴 수 없습니다.');
      const a = 1 + Math.floor(this.rng() * 6);
      const b = 1 + Math.floor(this.rng() * 6);
      this.dice = [a, b];
      const sum = a + b;
      this.say('P' + (this.current + 1) + ' 주사위 ' + a + '+' + b + ' = ' + sum);

      if (sum === 7) {
        this.stopTimer();          // 버리기·도둑 처리 동안 제한 시간은 멈춘다
        this.pendingDiscards = this.alivePlayers()
          .filter(p => handSize(p.hand) >= DISCARD_LIMIT)
          .map(p => ({ player: p.index, count: Math.floor(handSize(p.hand) / 2) }));
        if (this.pendingDiscards.length) {
          this.phase = 'discard';
          this.say('7! 자원 ' + DISCARD_LIMIT + '장 이상인 플레이어는 절반을 버립니다.');
        } else {
          this.phase = 'robber';
          this.say('7! 도둑을 옮길 칸을 고르세요.');
        }
      } else {
        this.produce(sum);
        this.phase = 'action';
      }
      return this.done();
    }

    /** 생산: 나온 숫자의 칸을 점령한 플레이어가 1장, 그 칸에 자기 킹/퀸이 서 있으면 2장. */
    produce(sum) {
      const gains = [];
      for (const id of B.order) {
        const cell = B.cells[id];
        if (cell.dice !== sum || cell.terrain === 'S') continue;
        const owner = this.owners[id];
        if (owner === undefined || !this.players[owner].alive) continue;
        if (this.robber === id) {
          this.say(id + '는 도둑이 있어 생산하지 않습니다.');
          continue;
        }
        const piece = this.pieces.get(id);
        const doubled = !!piece && piece.owner === owner && (piece.type === 'K' || piece.type === 'Q');
        const n = doubled ? 2 : 1;
        this.give(owner, cell.terrain, n);
        gains.push('P' + (owner + 1) + ' ' + B.RES_INFO[cell.terrain].name + n
          + '(' + id + (doubled ? ' 2배' : '') + ')');
      }
      this.say(gains.length ? '생산: ' + gains.join(', ') : '생산 없음');
    }

    discardJob() { return this.phase === 'discard' ? this.pendingDiscards[0] : null; }

    /** 버리기. picks 는 {F,W,I,M} 장수. */
    discard(picks) {
      if (this.phase !== 'discard') return this.fail('버리기 단계가 아닙니다.');
      const job = this.pendingDiscards[0];
      const hand = this.players[job.player].hand;
      let total = 0;
      for (const k of B.RESOURCES) {
        const n = picks[k] || 0;
        if (n < 0 || n > hand[k]) return this.fail('가지고 있지 않은 자원은 버릴 수 없습니다.');
        total += n;
      }
      if (total !== job.count) return this.fail('정확히 ' + job.count + '장을 버려야 합니다.');
      B.RESOURCES.forEach(k => { hand[k] -= (picks[k] || 0); });
      this.say('P' + (job.player + 1) + ' 자원 ' + job.count + '장을 버렸습니다.');
      this.pendingDiscards.shift();
      if (!this.pendingDiscards.length) {
        this.phase = 'robber';
        this.say('도둑을 옮길 칸을 고르세요.');
      }
      return this.done();
    }

    /** 도둑 이동 → 그 칸 점령자에게서 1장 약탈 → f6 생산 (규칙서 6장 순서) */
    moveRobber(id) {
      if (this.phase !== 'robber') return this.fail('도둑을 옮길 단계가 아닙니다.');
      if (!B.cells[id]) return this.fail('없는 칸입니다.');
      if (id === this.robber) return this.fail('도둑을 같은 칸에 둘 수는 없습니다.');
      this.robber = id;
      this.say('도둑이 ' + id + '로 이동했습니다.');
      const victim = this.owners[id];
      if (victim !== undefined && victim !== this.current && this.players[victim].alive) {
        const res = this.stealRandom(victim, this.current);
        this.say(res
          ? 'P' + (this.current + 1) + '이 P' + (victim + 1) + '의 ' + B.RES_INFO[res].name + ' 1장을 빼앗았습니다.'
          : 'P' + (victim + 1) + '은 빼앗길 자원이 없습니다.');
      }
      this.produce(7);           // f6 생산은 버리기·도둑 뒤에 (FAQ)
      this.phase = 'action';
      this.startTimer();
      return this.done();
    }

    // ---- 교역 ------------------------------------------------------------

    canTrade() { return this.phase === 'action' && !this.actionUsed; }

    /** 은행 4:1 */
    tradeBank(from, to) {
      if (!this.canTrade()) return this.fail('교역 단계가 아닙니다.');
      if (from === to) return this.fail('같은 자원끼리는 교환할 수 없습니다.');
      const hand = this.players[this.current].hand;
      if (hand[from] < BANK_RATE) return this.fail(B.RES_INFO[from].name + ' ' + BANK_RATE + '장이 필요합니다.');
      hand[from] -= BANK_RATE;
      this.give(this.current, to, 1);
      this.say('P' + (this.current + 1) + ' 은행 교역: '
        + B.RES_INFO[from].name + BANK_RATE + ' → ' + B.RES_INFO[to].name + '1');
      return this.done();
    }

    /** 플레이어 간 교역 제안. 상대가 수락해야 성립한다(턴 진행자와만 거래, FAQ). */
    proposeTrade(to, offer, want) {
      if (!this.canTrade()) return this.fail('교역 단계가 아닙니다.');
      if (to === this.current || !this.players[to].alive) return this.fail('거래할 수 없는 상대입니다.');
      const mine = this.players[this.current].hand;
      if (!B.RESOURCES.every(k => mine[k] >= (offer[k] || 0))) return this.fail('내놓을 자원이 부족합니다.');
      const total = B.RESOURCES.reduce((a, k) => a + (offer[k] || 0) + (want[k] || 0), 0);
      if (total === 0) return this.fail('주거나 받을 자원을 정해야 합니다.');
      this.offer = { from: this.current, to, offer, want };
      this.say('P' + (this.current + 1) + ' → P' + (to + 1) + ' 교역 제안: '
        + (fmtHand(offer) || '없음') + ' ↔ ' + (fmtHand(want) || '없음'));
      return this.done();
    }

    respondTrade(accept) {
      if (!this.offer) return this.fail('진행 중인 제안이 없습니다.');
      const o = this.offer;
      if (!accept) {
        this.offer = null;
        this.say('P' + (o.to + 1) + '이 교역을 거절했습니다.');
        return this.done();
      }
      const theirs = this.players[o.to].hand;
      if (!B.RESOURCES.every(k => theirs[k] >= (o.want[k] || 0))) {
        return this.fail('상대가 요구한 자원을 가지고 있지 않습니다.');
      }
      B.RESOURCES.forEach(k => {
        const a = o.offer[k] || 0, b = o.want[k] || 0;
        this.players[o.from].hand[k] += b - a;
        this.players[o.to].hand[k] += a - b;
      });
      this.say('교역 성립: P' + (o.from + 1) + ' ' + (fmtHand(o.offer) || '없음')
        + ' ↔ P' + (o.to + 1) + ' ' + (fmtHand(o.want) || '없음'));
      this.offer = null;
      return this.done();
    }

    // ---- 행위: 소환 ------------------------------------------------------

    summon(type, id, extraFrom) {
      const i = this.current;
      if (this.phase !== 'action') return this.fail('행위 단계가 아닙니다.');
      if (this.actionUsed) return this.fail('이번 턴의 행위를 이미 썼습니다.');
      if (this.summonBlocked()) return this.fail(FATIGUE_NO_SUMMON + '라운드부터는 소환할 수 없습니다.');
      if (P.SUMMONABLE.indexOf(type) < 0) return this.fail('소환할 수 없는 기물입니다.');
      if (type === 'Q' && this.queenOnBoard(i)) return this.fail('퀸은 판 위에 1개까지입니다.');
      if (this.legalSummonCells(type).indexOf(id) < 0) return this.fail('그 칸에는 소환할 수 없습니다.');
      const cost = this.costOf(i, type, extraFrom);
      if (!cost) return this.fail('추가 비용으로 낼 자원을 정해야 합니다.');
      const hand = this.players[i].hand;
      if (!B.RESOURCES.every(k => hand[k] >= cost[k])) return this.fail('자원이 부족합니다.');

      const reasons = this.surcharge(i).reasons;        // 소환 전에 읽어 둔다 (체크가 풀리면 사라진다)
      B.RESOURCES.forEach(k => { hand[k] -= cost[k]; });
      this.pieces.set(id, { owner: i, type });
      this.owners[id] = i;               // 소환한 칸도 점령된다
      this.say('P' + (i + 1) + ' ' + P.PIECE_INFO[type].name + ' 소환 → ' + id
        + ' (' + fmtHand(cost) + (reasons.length ? ', ' + reasons.join(', ') : '') + ')');
      return this.finishAction();
    }

    // ---- 행위: 이동 ------------------------------------------------------

    move(from, to) {
      const i = this.current;
      if (this.phase !== 'action') return this.fail('행위 단계가 아닙니다.');
      if (this.actionUsed) return this.fail('이번 턴의 행위를 이미 썼습니다.');
      const piece = this.pieces.get(from);
      if (!piece || piece.owner !== i) return this.fail('내 기물이 아닙니다.');
      const legal = this.legalMoves(from).find(m => m.to === to);
      if (!legal) return this.fail('그 칸으로는 갈 수 없습니다.');

      const victim = legal.capture;
      this.pieces.delete(from);
      this.pieces.set(to, piece);
      this.owners[to] = i;               // 칸은 마지막으로 밟은 사람의 것
      this.say('P' + (i + 1) + ' ' + P.PIECE_INFO[piece.type].name + ' ' + from + ' → ' + to
        + (victim ? ' (P' + (victim.owner + 1) + ' ' + P.PIECE_INFO[victim.type].name + ' 잡음)' : ''));

      if (victim) {
        // 약탈: 잡힌 플레이어의 자원 1장을 무작위로
        const res = this.stealRandom(victim.owner, i);
        if (res) this.say('약탈: P' + (victim.owner + 1) + '의 ' + B.RES_INFO[res].name + ' 1장');
        if (victim.type === 'K') this.eliminate(victim.owner, i);
      }

      // 폰 귀환: 전진 방향으로 판 끝에 닿으면 판에서 빼고 자원 2장
      if (piece.type === 'P' && P.pawnAtEdge(i, to) && this.phase !== 'gameover') {
        this.pieces.delete(to);
        this.pendingPawnReturn = { player: i, remaining: 2 };
        this.say('P' + (i + 1) + ' 폰이 판 끝(' + to + ')에 닿아 귀환합니다. 자원 2장을 고르세요.');
      }
      return this.finishAction();
    }

    /** 폰 귀환 보상 선택 */
    choosePawnReward(res) {
      if (!this.pendingPawnReturn) return this.fail('고를 보상이 없습니다.');
      if (B.RESOURCES.indexOf(res) < 0) return this.fail('없는 자원입니다.');
      this.give(this.pendingPawnReturn.player, res, 1);
      this.pendingPawnReturn.remaining -= 1;
      this.say('폰 귀환 보상: ' + B.RES_INFO[res].name + ' 1장');
      if (this.pendingPawnReturn.remaining <= 0) {
        this.pendingPawnReturn = null;
        this.advanceIfReady();
      }
      return this.done();
    }

    // ---- 탈락과 승리 -----------------------------------------------------

    /** 킹 사살 (규칙서 10장) */
    eliminate(victim, killer) {
      const p = this.players[victim];
      if (!p.alive) return;
      p.alive = false;
      p.eliminatedRound = this.round;

      // 킹을 잡은 플레이어가 자원 절반(버림)을 받는다
      let steal = Math.floor(handSize(p.hand) / 2);
      const got = emptyHand();
      while (steal-- > 0) {
        const res = this.stealRandom(victim, killer);
        if (!res) break;
        got[res] += 1;
      }
      this.say('P' + (victim + 1) + ' 탈락! P' + (killer + 1) + '이 자원 절반('
        + (fmtHand(got) || '없음') + ')을 가져갑니다.');

      // 기물은 모두 빼고, 점령했던 칸은 아무의 것도 아닌 칸이 된다
      for (const [id, piece] of Array.from(this.pieces)) {
        if (piece.owner === victim) this.pieces.delete(id);
      }
      Object.keys(this.owners).forEach(id => {
        if (this.owners[id] === victim) delete this.owners[id];
      });

      const alive = this.alivePlayers();
      if (alive.length === 1) this.finish([alive[0].index], '마지막까지 남았습니다');
    }

    /** 32라운드 종료 판정 (규칙서 11장) */
    scoreFinal() {
      const rank = this.alivePlayers().map(p => ({
        i: p.index,
        cells: this.ownedCells(p.index).length,
        material: this.materialOf(p.index),
      }));
      const best = Math.max.apply(null, rank.map(r => r.cells));
      let top = rank.filter(r => r.cells === best);
      if (top.length > 1) {
        const bestMat = Math.max.apply(null, top.map(r => r.material));
        top = top.filter(r => r.material === bestMat);
      }
      const detail = rank.map(r => 'P' + (r.i + 1) + ' ' + r.cells + '칸/기물 ' + r.material).join(', ');
      this.finish(top.map(r => r.i), FINAL_ROUND + '라운드 종료 — ' + detail);
    }

    finish(winners, why) {
      this.winners = winners;
      this.phase = 'gameover';
      this.stopTimer();
      this.say('게임 종료: ' + winners.map(i => 'P' + (i + 1)).join(' · ') + ' 승리 (' + why + ')');
    }

    // ---- 턴 넘기기 -------------------------------------------------------

    finishAction() {
      this.actionUsed = true;
      this.advanceIfReady();
      return this.done();
    }

    advanceIfReady() {
      if (this.phase === 'gameover') return;
      if (this.pendingPawnReturn) return;     // 보상을 고르기 전에는 넘기지 않는다
      this.endTurn();
    }

    /** 제한 시간 초과 — 행위 없이 턴 종료, 이미 처리된 생산은 유지 */
    timeout() {
      if (this.phase === 'gameover') return this.done();
      if (this.phase === 'roll') {            // 굴리지도 않았으면 굴려서 생산만 처리한다
        this.roll();
        if (this.phase !== 'action') return this.done();   // 버리기·도둑은 시간 제한 밖
      }
      if (this.phase !== 'action') return this.done();
      this.say('P' + (this.current + 1) + ' 시간 초과 — 행위 없이 턴을 넘깁니다.');
      this.endTurn();
      return this.done();
    }

    endTurn() {
      this.offer = null;
      this.actionUsed = false;
      this.dice = null;

      // 라운드 판정: 남아 있는 플레이어가 모두 한 번씩 턴을 마치면 1라운드
      if (this.turnStarts >= this.alivePlayers().length) {
        if (this.round >= FINAL_ROUND) { this.scoreFinal(); return; }
        this.round += 1;
        this.turnStarts = 0;
        this.say('— ' + this.round + '라운드');
        if (this.round === FATIGUE_SURCHARGE) this.say('전쟁 피로: 모든 소환 비용 +1');
        if (this.round === FATIGUE_NO_SUMMON) this.say('전쟁 피로: 더 이상 소환할 수 없습니다');
      }

      // 다음 생존 플레이어 (시계 방향 1 → 2 → 3)
      let next = this.current;
      for (let n = 0; n < 3; n++) {
        next = (next + 1) % 3;
        if (this.players[next].alive) break;
      }
      this.current = next;
      this.turnStarts += 1;
      this.phase = 'roll';
      this.startTimer();
    }

    // ---- 제한 시간 -------------------------------------------------------

    startTimer() { this.deadline = this.useTimer ? Date.now() + TURN_SECONDS * 1000 : null; }
    stopTimer() { this.deadline = null; }
    secondsLeft() {
      if (!this.deadline) return null;
      return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    }

    // ---- 결과 통지 -------------------------------------------------------

    fail(message) {
      this.lastError = message;
      this.onChange(this);
      return { ok: false, message };
    }
    done() {
      this.lastError = null;
      this.onChange(this);
      return { ok: true };
    }
  }

  global.GameRules = {
    Game, TURN_SECONDS, DISCARD_LIMIT, BANK_RATE,
    FATIGUE_SURCHARGE, FATIGUE_NO_SUMMON, FINAL_ROUND,
    handSize, fmtHand,
  };
})(window);
