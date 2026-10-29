/* 무작위 자동 플레이. 300판을 끝까지 돌리며 매 수마다 불변식을 검사한다.
 * `node test/selfplay.test.js` — 위반이 있으면 예외를 던지고 1로 끝난다. */
'use strict';
global.window = {};
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'js/board.js'));
require(path.join(root, 'js/pieces.js'));
require(path.join(root, 'js/game.js'));
const B = window.Board, P = window.Pieces, G = window.GameRules;

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function playOne(seed, seats) {
  const rng = mulberry(seed);
  const g = new G.Game({ rng, useTimer: false, seats });
  const pick = arr => arr[Math.floor(rng() * arr.length)];
  let guard = 0;

  while (g.phase !== 'gameover' && guard++ < 20000) {
    if (g.phase === 'setup') {
      const job = g.setupJob();
      const r = g.place(pick(g.setupCells(job.player)));
      if (!r.ok) throw new Error('setup: ' + r.message);
    } else if (g.phase === 'roll') {
      const r = g.roll(); if (!r.ok) throw new Error('roll: ' + r.message);
    } else if (g.phase === 'discard') {
      const job = g.discardJob();
      const hand = g.player(job.player).hand;
      const picks = { F: 0, W: 0, I: 0, M: 0 };
      let n = job.count;
      while (n > 0) {
        const k = pick(B.RESOURCES.filter(k => hand[k] - picks[k] > 0));
        picks[k]++; n--;
      }
      const r = g.discard(picks); if (!r.ok) throw new Error('discard: ' + r.message);
    } else if (g.phase === 'robber') {
      const spots = B.order.filter(id => id !== g.robber && B.cells[id].terrain !== 'S');
      const r = g.moveRobber(pick(spots)); if (!r.ok) throw new Error('robber: ' + r.message);
    } else if (g.pendingPromotion) {
      const r = g.choosePromotion(pick(g.promotionChoices(g.pendingPromotion.player)));
      if (!r.ok) throw new Error('promotion: ' + r.message);
      promotions++;
    } else if (g.phase === 'action') {
      // 가끔 교역, 그 다음 소환 아니면 이동
      const i = g.current, hand = g.player(i).hand;
      if (rng() < 0.3) {
        const rich = B.RESOURCES.filter(k => hand[k] >= 4);
        if (rich.length) g.tradeBank(pick(rich), pick(B.RESOURCES.filter(k => k !== rich[0])));
      }
      const summons = [];
      if (!g.summonBlocked()) {
        for (const t of P.SUMMONABLE) {
          if (!g.canAfford(i, t)) continue;
          const cells = g.legalSummonCells(t);
          if (cells.length) summons.push([t, cells]);
        }
      }
      const moves = [];
      for (const [from, pc] of g.pieces) {
        if (pc.owner !== i) continue;
        const ms = g.legalMoves(from);
        if (ms.length) moves.push([from, ms]);
      }
      if (summons.length && (rng() < 0.45 || !moves.length)) {
        const [t, cells] = pick(summons);
        const extra = g.surcharge(i).extra;
        const picks = [];
        const spare = Object.assign({}, hand);
        B.RESOURCES.forEach(k => { spare[k] -= (P.COSTS[t][k] || 0); });
        for (let n = 0; n < extra; n++) {
          const k = pick(B.RESOURCES.filter(k => spare[k] > 0));
          spare[k]--; picks.push(k);
        }
        const r = g.summon(t, pick(cells), picks);
        if (!r.ok) throw new Error('summon ' + t + ': ' + r.message);
      } else if (moves.length) {
        const [from, ms] = pick(moves);
        const r = g.move(from, pick(ms).to);
        if (!r.ok) throw new Error('move: ' + r.message);
      } else {
        g.timeout();   // 둘 수 있는 게 없으면 시간 초과로 턴 종료
      }
    } else throw new Error('알 수 없는 단계 ' + g.phase);

    // --- 불변식 검사 ---
    for (const [id, pc] of g.pieces) {
      if (!B.cells[id]) throw new Error('판 밖 기물 ' + id);
      if (!g.player(pc.owner).alive) throw new Error('탈락자 기물 남음 ' + id);
      if (g.player(pc.owner).absent) throw new Error('불참 자리 기물 ' + id);
      if (g.owners[id] !== pc.owner) throw new Error('기물이 선 칸의 점령자 불일치 ' + id);
    }
    g.players.forEach(p => {
      B.RESOURCES.forEach(k => { if (p.hand[k] < 0) throw new Error('자원 음수 P' + (p.index + 1)); });
      if (p.alive && !g.kingOf(p.index)) throw new Error('생존자에 킹 없음 P' + (p.index + 1));
      let q = 0;
      for (const pc of g.pieces.values()) if (pc.owner === p.index && pc.type === 'Q') q++;
      if (q > 1) throw new Error('퀸 2개 P' + (p.index + 1));
    });
    Object.keys(g.owners).forEach(id => {
      if (!g.player(g.owners[id]).alive) throw new Error('탈락자 점령 남음 ' + id);
    });
  }
  if (guard >= 20000) throw new Error('끝나지 않음');
  return g;
}

let kills = 0, timeouts = 0, rounds = [], promotions = 0;
for (let s = 1; s <= 300; s++) {
  const g = playOne(s);
  rounds.push(g.round);
  const last = g.log[g.log.length - 1].text;
  if (/마지막까지/.test(last)) kills++; else timeouts++;
  if (s <= 3) console.log('seed', s, '→', last);
}
rounds.sort((a, b) => a - b);
console.log('300판 완주, 불변식 위반 없음.');
console.log('  킹 사살로 끝난 판', kills, '· 32라운드까지 간 판', timeouts);
console.log('  라운드 중앙값', rounds[150], '최소', rounds[0], '최대', rounds[299], '· 폰 승급', promotions + '회');

// 2인전: P1·P2 만 두고, P3 는 한 번도 차례가 오지 않아야 한다
let duelKills = 0;
for (let s = 1; s <= 150; s++) {
  const g = playOne(10000 + s, [0, 1]);
  if (g.player(2).alive || !g.player(2).absent) throw new Error('2인전에서 P3 가 살아 있음');
  if (g.log.some(e => /^P3 /.test(e.text))) throw new Error('2인전에서 P3 가 두었음');
  if (g.winners.some(i => i === 2)) throw new Error('2인전에서 P3 승리');
  if (/마지막까지/.test(g.log[g.log.length - 1].text)) duelKills++;
}
console.log('2인전 150판 완주, P3 개입 없음. 킹 사살로 끝난 판', duelKills);
console.log('\nPASS');
