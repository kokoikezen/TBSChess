/* 규칙서 조항별 시나리오 테스트. 의존성 없이 `node test/rules.test.js` 로 돌린다. */
'use strict';
global.window = {};
const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'js/board.js'));
require(path.join(root, 'js/pieces.js'));
require(path.join(root, 'js/game.js'));
const B = window.Board, P = window.Pieces, R = window.GameRules;

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('  ok   ' + name); }
  catch (e) { fail++; results.push('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((what || '') + ' 기대 ' + b + ' 실제 ' + a);
}
function ok(cond, what) { if (!cond) throw new Error(what || '거짓'); }

/** 세팅 단계를 건너뛴 게임. 기물·자원은 테스트가 직접 놓는다. */
function bare(opts) {
  const g = new R.Game(Object.assign({ useTimer: false }, opts));
  g.setupQueue.length = 0;
  g.phase = 'roll';
  g.current = 0;
  g.turnStarts = 1;
  g.log.length = 0;
  return g;
}
function put(g, id, owner, type) {
  g.pieces.set(id, { owner, type });
  g.owners[id] = owner;
}
function hand(g, i, h) {
  B.RESOURCES.forEach(k => { g.player(i).hand[k] = h[k] || 0; });
}
/** 주사위를 원하는 합으로 고정한다. */
function rig(g, sum) {
  const a = Math.max(1, sum - 6);
  g.rng = (() => { let n = 0; return () => (n++ === 0 ? (a - 1) / 6 + 0.001 : (sum - a - 1) / 6 + 0.001); })();
}

// ---- 2·3장: 구성물과 자원 배치 -------------------------------------------

test('판은 91칸이고 식량27·목재27·철21·마석13·본진3', () => {
  eq(B.order.length, 91, '칸 수');
  const n = {};
  B.order.forEach(id => { const t = B.cells[id].terrain; n[t] = (n[t] || 0) + 1; });
  eq(['S', 'F', 'W', 'I', 'M'].map(k => k + n[k]), ['S3', 'F27', 'W27', 'I21', 'M13'], '지형 분포');
});

test('배치는 120도 회전 대칭 — 세 진영의 자원·숫자 구성이 같다', () => {
  const profile = p => {
    const rows = B.order
      .filter(id => B.cells[id].zone.length === 1 && B.cells[id].zone[0] === p && B.cells[id].terrain !== 'S')
      .map(id => B.cells[id].terrain + (B.cells[id].dice || 0));
    return rows.sort().join(',');
  };
  eq(profile(1), profile(0), 'P2 영역');
  eq(profile(2), profile(0), 'P3 영역');
});

test('본진 바로 옆 3칸은 식량9·철5·목재4', () => {
  B.HOMES.forEach(home => {
    const near = B.neighbors(home).map(id => B.cells[id].terrain + B.cells[id].dice).sort();
    eq(near, ['F9', 'I5', 'W4'], home + ' 인접');
  });
});

test('마석은 어느 본진에서든 4칸 이상 떨어져 있고 f6은 공용 7', () => {
  B.order.filter(id => B.cells[id].terrain === 'M').forEach(id => {
    ok(Math.min.apply(null, B.cells[id].dist) >= 4, id + '가 본진에 너무 가깝다');
  });
  eq(B.cells[B.CENTER].dice, 7, 'f6 숫자');
  eq(B.cells[B.CENTER].dist, [5, 5, 5], 'f6 거리');
});

// ---- 4장: 게임 준비 --------------------------------------------------------

test('킹은 본진에서 시작하고 공짜 소환은 2칸 안, 다 놓으면 1라운드가 시작된다', () => {
  const g = new R.Game({ useTimer: false });
  eq(g.pieces.get('f11'), { owner: 0, type: 'K' }, 'P1 킹');
  eq(g.setupJob(), { player: 0, type: 'P' }, '첫 배치');
  ok(g.setupCells(1).indexOf('c3') >= 0, 'a1 진영은 c3(2칸)에 놓을 수 있어야 한다');
  ok(g.setupCells(1).indexOf('d4') < 0, 'a1 진영은 d4(3칸)에 놓을 수 없다');
  ok(!g.place('d4').ok, '3칸 밖 배치는 거부');
  // 9개를 순서대로 놓는다
  for (let n = 0; n < 9; n++) {
    const job = g.setupJob();
    const r = g.place(g.setupCells(job.player)[0]);
    ok(r.ok, '배치 실패: ' + r.message);
  }
  eq(g.phase, 'roll', '세팅 후 단계');
  eq(g.round, 1, '라운드');
  eq(g.current, 0, '선 플레이어');
  eq([0, 1, 2].map(i => g.ownedCells(i).length), [4, 4, 4], '본진+기물 3개로 4칸씩 점령');
  eq([0, 1, 2].map(i => g.handSize(i)), [0, 0, 0], '자원은 0장에서 시작');
});

// ---- 5장: 생산 ------------------------------------------------------------

test('생산은 점령한 칸에서 1장, 킹·퀸이 선 칸은 2장', () => {
  const g = bare();
  put(g, 'g10', 0, 'P');        // 식량 9
  put(g, 'd4', 1, 'K');         // 식량 9 — 2배
  g.owners['f8'] = 2;           // 식량 9, 기물 없이 점령만
  rig(g, 9);
  g.roll();
  eq(g.player(0).hand.F, 1, 'P1 식량');
  eq(g.player(1).hand.F, 2, 'P2 식량(킹 2배)');
  eq(g.player(2).hand.F, 1, 'P3 식량(점령만)');
});

test('본진은 생산하지 않고, 도둑이 있는 칸도 생산하지 않는다', () => {
  const g = bare();
  put(g, 'g10', 0, 'P');
  g.robber = 'g10';
  rig(g, 9);
  g.roll();
  eq(g.player(0).hand.F, 0, '도둑 칸 생산');
  ok(g.log.some(e => /도둑이 있어 생산하지 않/.test(e.text)), '도둑 안내');
  // 본진(f11)은 숫자가 없어 어떤 합에도 생산되지 않는다
  eq(B.cells['f11'].dice, null, '본진 숫자');
});

test('한 턴에는 이동이나 소환 중 하나만 — 쓴 뒤에는 차례가 넘어간다', () => {
  const g = bare();
  put(g, 'g10', 0, 'P');
  rig(g, 9);
  g.roll();
  eq(g.phase, 'action', '행위 단계');
  ok(g.move('g10', 'g9').ok, '폰 전진');
  eq(g.current, 1, '다음 플레이어');
  ok(!g.move('g9', 'g8').ok, '턴이 넘어간 뒤 같은 기물을 다시 움직일 수 없다');
});

test('시간 초과는 행위 없이 턴을 끝내고 생산은 유지한다', () => {
  const g = bare();
  put(g, 'g10', 0, 'P');
  rig(g, 9);
  g.roll();
  g.timeout();
  eq(g.player(0).hand.F, 1, '생산 유지');
  eq(g.current, 1, '턴 종료');
});

// ---- 6장: 주사위 7 --------------------------------------------------------

test('7이면 8장 이상인 플레이어가 절반을 버린 뒤 도둑, 그 다음 f6 생산', () => {
  const g = bare();
  hand(g, 0, { F: 5, W: 4 });      // 9장 → 4장 버림
  hand(g, 1, { F: 3 });            // 그대로
  g.owners[B.CENTER] = 0;          // f6 점령
  put(g, 'b1', 1, 'R');            // 도둑 희생자
  hand(g, 1, { F: 3 });
  rig(g, 7);
  g.roll();
  eq(g.phase, 'discard', '버리기 단계');
  eq(g.discardJob(), { player: 0, count: 4 }, '버릴 장수');
  ok(!g.discard({ F: 2 }).ok, '장수가 모자라면 거부');
  ok(g.discard({ F: 4 }).ok, '4장 버리기');
  eq(g.phase, 'robber', '도둑 단계');
  eq(g.player(0).hand.M, 0, 'f6 생산은 도둑 뒤에');
  ok(g.moveRobber('b1').ok, '도둑 이동');
  eq(g.player(1).hand.F, 2, 'P2에게서 1장 약탈');
  eq(g.player(0).hand.M, 1, 'f6 마석 생산');
  eq(g.phase, 'action', '행위 단계로');
});

test('7이 나와도 8장 미만이면 바로 도둑 단계', () => {
  const g = bare();
  hand(g, 0, { F: 7 });
  rig(g, 7);
  g.roll();
  eq(g.phase, 'robber', '단계');
  eq(g.player(0).hand.F, 7, '버리지 않음');
});

// ---- 7장: 점령 ------------------------------------------------------------

test('칸은 마지막으로 밟은 사람의 것이고 떠나도 유지된다', () => {
  const g = bare();
  put(g, 'g10', 0, 'R');
  g.owners['g9'] = 1;
  rig(g, 2);
  g.roll();
  g.move('g10', 'g9');
  eq(g.owners['g9'], 0, '밟은 칸의 점령자');
  eq(g.owners['g10'], 0, '떠난 칸도 유지');
});

// ---- 8장: 소환 ------------------------------------------------------------

test('소환은 킹과 맞닿은 빈칸에만, 비용만큼 자원을 낸다', () => {
  const g = bare();
  hand(g, 0, { F: 3, W: 2, I: 4, M: 2 });
  rig(g, 2);
  g.roll();
  ok(g.summonCells(0).indexOf('f10') >= 0, 'f10은 킹 인접');
  ok(!g.summon('N', 'f9').ok, '킹에서 2칸 떨어진 칸은 거부');
  ok(g.summon('N', 'f10').ok, '나이트 소환');
  eq(g.player(0).hand, { F: 1, W: 2, I: 0, M: 2 }, '비용 차감(식량2·철4)');
  eq(g.owners['f10'], 0, '소환한 칸 점령');
});

test('모든 기물 가격은 규칙서 표의 2배다', () => {
  const draft = {           // 규칙서 8장 원래 표
    P: { F: 1, W: 1 }, N: { F: 1, I: 2 }, B: { F: 1, I: 1, M: 1 },
    R: { W: 2, I: 1 }, Q: { F: 1, I: 2, M: 2 },
  };
  const swapped = { P: 'P', N: 'N', B: 'R', R: 'B', Q: 'Q' };   // 룩↔비숍은 재료를 맞바꿨다
  P.SUMMONABLE.forEach(t => {
    const base = draft[swapped[t]];
    B.RESOURCES.forEach(k => {
      eq(P.COSTS[t][k] || 0, (base[k] || 0) * 2, P.PIECE_INFO[t].name + ' ' + B.RES_INFO[k].name);
    });
  });
});

test('룩과 비숍은 재료가 서로 바뀌었다 — 룩이 마석을, 비숍이 목재를 쓴다', () => {
  eq(P.COSTS.R, { F: 2, I: 2, M: 2 }, '룩');
  eq(P.COSTS.B, { W: 4, I: 2 }, '비숍');
  const g = bare();
  hand(g, 0, { F: 2, I: 2, M: 2 });
  rig(g, 2);
  g.roll();
  ok(!g.canAfford(0, 'B'), '목재가 없으면 비숍은 못 낸다');
  ok(g.summon('R', 'f10').ok, '같은 자원으로 룩은 낼 수 있다');
  eq(g.player(0).hand, { F: 0, W: 0, I: 0, M: 0 }, '룩 비용 전부 소모');
});

test('퀸은 판 위에 1개까지, 잡히면 다시 소환할 수 있다', () => {
  const g = bare();
  hand(g, 0, { F: 2, I: 4, M: 4 });     // 퀸 = 식량2·철4·마석4
  rig(g, 2);
  g.roll();
  ok(g.summon('Q', 'f10').ok, '첫 퀸');
  eq(g.legalSummonCells('Q'), [], '두 번째 퀸은 놓을 칸이 없다');
  g.pieces.delete('f10');
  g.current = 0; g.phase = 'action'; g.actionUsed = false;
  ok(g.legalSummonCells('Q').length > 0, '판에서 사라지면 다시 소환 가능');
});

test('체크를 막으려 소환하면 아무 자원 1장을 더 낸다', () => {
  const g = bare();
  put(g, 'f1', 1, 'R');                 // f열 직선으로 f11 킹을 노린다
  hand(g, 0, { F: 2, W: 2, M: 3 });
  rig(g, 2);
  g.roll();
  ok(g.inCheck(0), '체크 상태');
  eq(g.surcharge(0), { extra: 1, reasons: ['긴급 소환 +1'] }, '추가 비용');
  ok(!g.summon('P', 'f10').ok, '추가 비용을 정하지 않으면 거부');
  ok(g.summon('P', 'f10', ['M']).ok, '마석으로 추가 비용');
  eq(g.player(0).hand, { F: 0, W: 0, I: 0, M: 2 }, '폰 비용(식2목2) + 추가 1장');
  ok(!g.inCheck(0), '사이를 막아 체크 해소');
});

// ---- 9장: 이동 ------------------------------------------------------------

test('폰은 앞 · 오른쪽 대각선 · 왼쪽 대각선 1칸으로 가고 같은 칸으로 잡는다', () => {
  const g = bare();
  put(g, 'f6', 0, 'P');       // P1 은 y 감소 방향 — f6 앞은 f5, 대각선은 e5 · g5
  eq(P.moves(g.pieces, 'f6').map(m => m.to).sort(), ['e5', 'f5', 'g5'], '빈 판에서 전방 3칸');
  put(g, 'e5', 1, 'N');
  put(g, 'g5', 0, 'R');
  const ms = P.moves(g.pieces, 'f6');
  eq(ms.map(m => m.to).sort(), ['e5', 'f5'], '아군 칸은 못 가고 상대 칸은 잡는다');
  ok(ms.find(m => m.to === 'e5').capture, '대각선 잡기');
  eq(P.attacks(g.pieces, 'f6').sort(), ['e5', 'f5'], '공격 칸도 같은 3칸');
  ok(!P.moves(g.pieces, 'f6').some(m => m.to === 'f7'), '뒤로는 못 간다');
});

test('폰이 판 끝에 닿으면 퀸 · 룩 · 비숍 · 나이트 중 하나로 승급한다', () => {
  const g = bare();
  put(g, 'f2', 0, 'P');       // P1 은 y 감소 방향, f2 → f1 이 판 끝
  rig(g, 2);
  g.roll();
  ok(g.move('f2', 'f1').ok, '판 끝으로 전진');
  eq(g.pendingPromotion, { player: 0, at: 'f1' }, '승급 대기');
  eq(g.current, 0, '고르기 전에는 턴이 넘어가지 않는다');
  ok(!g.choosePromotion('K').ok, '킹으로는 승급할 수 없다');
  ok(!g.choosePromotion('P').ok, '폰으로 남을 수는 없다');
  ok(g.choosePromotion('R').ok, '룩으로 승급');
  eq(g.pieces.get('f1'), { owner: 0, type: 'R' }, '그 자리에 룩');
  eq(g.owners['f1'], 0, '칸은 점령된 채로');
  eq(g.current, 1, '고르면 턴 종료');
});

test('퀸이 이미 있으면 퀸으로는 승급할 수 없고, 시간이 지나면 자동 승급', () => {
  const g = bare();
  put(g, 'f2', 0, 'P');
  put(g, 'c3', 0, 'Q');
  rig(g, 2);
  g.roll();
  g.move('f2', 'f1');
  eq(g.promotionChoices(0), ['R', 'B', 'N'], '퀸 제외');
  ok(!g.choosePromotion('Q').ok, '퀸 거부');
  g.timeout();
  eq(g.pieces.get('f1').type, 'R', '시간 초과면 남은 것 중 가장 센 기물');
  eq(g.current, 1, '그리고 턴이 넘어간다');
});

test('킹은 공격받는 칸으로 들어갈 수 없다', () => {
  const g = bare();
  put(g, 'g2', 1, 'R');       // g열 직선으로 g10 을 노린다 (f11 킹은 노리지 않는다)
  rig(g, 2);
  g.roll();
  ok(!g.inCheck(0), '지금은 체크가 아니다');
  ok(P.moves(g.pieces, 'f11').some(m => m.to === 'g10'), '기물 규칙만 보면 g10 으로 갈 수 있지만');
  const tos = g.legalMoves('f11').map(m => m.to);
  ok(tos.indexOf('g10') < 0, '공격받는 g10 은 막힌다');
  ok(tos.length > 0, '안전한 칸으로는 갈 수 있다');
  ok(!g.move('f11', 'g10').ok, '서버 판정도 거부');
});

test('기물을 잡으면 자원 1장을 약탈한다', () => {
  const g = bare();
  put(g, 'f10', 0, 'R');
  put(g, 'f9', 1, 'N');
  hand(g, 1, { M: 3 });
  rig(g, 2);
  g.roll();
  g.move('f10', 'f9');
  eq(g.player(1).hand.M, 2, '잡힌 쪽 자원 감소');
  eq(g.player(0).hand.M, 1, '잡은 쪽 자원 증가');
});

test('룩과 비숍은 막히면 지나갈 수 없고 나이트는 뛰어넘는다', () => {
  const g = bare();
  put(g, 'f10', 0, 'R');
  put(g, 'f9', 0, 'P');
  ok(!P.moves(g.pieces, 'f10').some(m => m.to === 'f8'), '아군 뒤로는 못 간다');
  put(g, 'f6', 0, 'N');
  eq(P.moves(g.pieces, 'f6').length, 12, '중앙 나이트는 12칸');
  put(g, 'e5', 1, 'P');           // 나이트는 인접 기물에 막히지 않는다
  put(g, 'f5', 1, 'P');
  eq(P.moves(g.pieces, 'f6').length, 12, '뛰어넘기');
});

// ---- 10장: 체크·탈락·승리 -------------------------------------------------

test('킹은 변이 맞닿은 주변 6칸으로만 1칸 움직인다', () => {
  const g = bare();
  const center = new Map([['f6', { owner: 0, type: 'K' }]]);
  eq(P.moves(center, 'f6').map(m => m.to).sort(), B.neighbors('f6').sort(), '중앙 킹');
  eq(P.moves(center, 'f6').length, 6, '꼭짓점 방향은 쓰지 않는다');
  ok(P.moves(center, 'f6').every(m => B.distance('f6', m.to) === 1), '모두 1칸 거리');
  // 본진은 판 꼭짓점이라 이웃이 3칸뿐이다
  eq(P.moves(g.pieces, 'f11').map(m => m.to).sort(), ['e10', 'f10', 'g10'], 'f11 킹');
  eq(g.summonCells(0).sort(), P.moves(g.pieces, 'f11').map(m => m.to).sort(),
    '킹의 이동 범위와 소환 가능 칸이 같아졌다');
});

test('체크 중에는 체크를 푸는 행위만 할 수 있다', () => {
  const g = bare();
  put(g, 'f1', 1, 'R');
  put(g, 'b7', 0, 'N');       // 체크와 무관한 내 기물
  rig(g, 2);
  g.roll();
  ok(g.inCheck(0), '체크');
  ok(g.hasCheckRelief(), '풀 방법 있음');
  eq(g.legalMoves('b7'), [], '무관한 기물은 움직일 수 없다');
  ok(g.legalMoves('f11').length > 0, '킹은 피할 수 있다');
  ok(g.legalMoves('f11').every(m => m.to[0] !== 'f'), 'f열에 머무르는 수는 제외된다');
});

test('체크를 풀 방법이 전혀 없으면 아무 행위나 할 수 있다', () => {
  const g = bare();
  // 나이트 체크는 사이를 막을 수 없다. f11(꼭짓점) 킹의 이동칸 5개를 내 기물로 메워 두고,
  // g8 에 상대 나이트를 둔다. 내 폰·나이트는 어느 것도 g8 에 닿지 못하고 자원도 0장이므로
  // 이동·잡기·막기·소환 어느 쪽으로도 체크를 풀 수 없다.
  put(g, 'g8', 1, 'N');
  ['g10', 'f10', 'e10'].forEach(id => put(g, id, 0, 'P'));   // 킹 주변 3칸을 막는다
  put(g, 'b7', 0, 'N');
  eq(g.legalMoves('f11'), [], '킹은 갈 칸이 없다');
  eq(g.handSize(0), 0, '자원 0장');
  rig(g, 2);
  g.roll();
  ok(g.inCheck(0), '체크');
  ok(!g.hasCheckRelief(), '풀 방법 없음');
  ok(g.legalMoves('b7').length > 0, '무관한 기물도 움직일 수 있다');
});

test('킹을 잡으면 탈락 — 기물·점령이 사라지고 자원 절반을 가져간다', () => {
  const g = bare();
  put(g, 'b2', 0, 'R');
  put(g, 'b1', 1, 'K');       // P2 킹을 b1 에 두고
  g.pieces.delete('a1');      // 원래 본진 킹은 치운다
  delete g.owners['a1'];
  put(g, 'c3', 1, 'N');
  g.owners['c5'] = 1;
  hand(g, 1, { F: 3, M: 2 });  // 5장 → 절반 2장
  rig(g, 2);
  g.roll();
  g.move('b2', 'b1');
  ok(!g.player(1).alive, 'P2 탈락');
  ok(!g.pieces.has('c3'), '탈락자 기물 제거');
  eq(g.owners['c5'], undefined, '탈락자 점령 해제');
  eq(g.handSize(0), 3, '약탈 1장 + 절반 2장');
  eq(g.handSize(1), 2, '남은 자원');
  eq(g.alivePlayers().length, 2, '생존자');
});

test('마지막까지 남은 1명이 승리한다', () => {
  const g = bare();
  g.player(1).alive = false;
  put(g, 'l2', 0, 'R');
  put(g, 'l1', 2, 'K');
  rig(g, 2);
  g.roll();
  g.move('l2', 'l1');
  eq(g.phase, 'gameover', '종료');
  eq(g.winners, [0], '승자');
});

// ---- 11장: 전쟁 피로 ------------------------------------------------------

test('17라운드부터 소환 비용 +1, 27라운드부터 소환 불가', () => {
  const g = bare();
  hand(g, 0, { F: 4, W: 4, I: 3, M: 3 });
  g.round = 17;
  eq(g.surcharge(0), { extra: 1, reasons: ['전쟁 피로 +1'] }, '17라운드 추가 비용');
  rig(g, 2);
  g.roll();
  ok(!g.summon('P', 'f10').ok, '추가 비용을 정해야 한다');
  ok(g.summon('P', 'f10', ['I']).ok, '철로 추가 비용');
  eq(g.player(0).hand, { F: 2, W: 2, I: 2, M: 3 }, '폰 2·2 + 추가 철 1');
  g.round = 27;
  g.phase = 'action'; g.actionUsed = false; g.current = 0;
  ok(g.summonBlocked(), '소환 불가');
  eq(g.legalSummonCells('P'), [], '놓을 칸 없음');
});

test('라운드는 생존자가 모두 한 번씩 턴을 마치면 올라간다', () => {
  const g = bare();
  rig(g, 2);
  for (let n = 0; n < 3; n++) { g.roll(); g.timeout(); }
  eq(g.round, 2, '한 바퀴 후 라운드');
  g.player(1).alive = false;      // 2인이 되면 두 턴마다 한 라운드
  g.current = 0; g.turnStarts = 1; g.phase = 'roll';
  g.roll(); g.timeout();
  g.roll(); g.timeout();
  eq(g.round, 3, '2인에서의 라운드');
});

test('32라운드가 끝나면 점령 칸이 많은 쪽이 이기고 동점이면 기물 가치로 가른다', () => {
  const g = bare();
  g.round = 32;
  g.turnStarts = 3;               // 마지막 턴
  g.owners['c6'] = 0; g.owners['c7'] = 0;         // P1 본진 + 2칸 = 3칸
  g.owners['b6'] = 1;                              // P2 본진 + 1칸 = 2칸
  put(g, 'd5', 2, 'Q');                            // P3 본진 + 1칸 = 2칸, 기물 가치 높음
  rig(g, 2);
  g.roll();
  g.timeout();
  eq(g.phase, 'gameover', '종료');
  eq(g.winners, [0], '점령 3칸인 P1 승리');

  const h = bare();
  h.round = 32; h.turnStarts = 3;
  put(h, 'd5', 2, 'Q');            // P3 만 기물 가치 +9, 점령은 모두 본진 1칸뿐
  rig(h, 2);
  h.roll();
  h.timeout();
  eq(h.winners, [2], '점령 동점이면 기물 가치로 P3 승리');
});

// ---- 12장: 정보 공개 ------------------------------------------------------

test('자원 장수는 공개, 종류는 본인 손패에만 있다', () => {
  const g = bare();
  hand(g, 1, { F: 2, M: 1 });
  eq(g.handSize(1), 3, '장수는 누구나 셀 수 있다');
  eq(g.player(1).hand, { F: 2, W: 0, I: 0, M: 1 }, '종류는 본인 손패에서만');
});

// ---- 교역 -----------------------------------------------------------------

test('은행 교역은 4:1', () => {
  const g = bare();
  hand(g, 0, { W: 4 });
  rig(g, 2);
  g.roll();
  ok(!g.tradeBank('F', 'W').ok, '없는 자원은 교환 불가');
  ok(g.tradeBank('W', 'I').ok, '목재 4 → 철 1');
  eq(g.player(0).hand, { F: 0, W: 0, I: 1, M: 0 }, '교환 결과');
  ok(!g.actionUsed, '교역은 행위를 쓰지 않는다');
});

test('플레이어 간 교역은 상대가 수락해야 성립한다', () => {
  const g = bare();
  hand(g, 0, { F: 2 });
  hand(g, 1, { M: 1 });
  rig(g, 2);
  g.roll();
  ok(g.proposeTrade(1, { F: 2 }, { M: 1 }).ok, '제안');
  ok(g.respondTrade(false).ok, '거절');
  eq(g.player(0).hand.F, 2, '거절하면 그대로');
  g.proposeTrade(1, { F: 2 }, { M: 1 });
  ok(g.respondTrade(true).ok, '수락');
  eq(g.player(0).hand, { F: 0, W: 0, I: 0, M: 1 }, 'P1 결과');
  eq(g.player(1).hand, { F: 2, W: 0, I: 0, M: 0 }, 'P2 결과');
});

test('행위를 쓰면 교역할 수 없다', () => {
  const g = bare();
  hand(g, 0, { W: 4 });
  put(g, 'g10', 0, 'P');
  rig(g, 9);
  g.roll();
  g.move('g10', 'g9');
  ok(!g.tradeBank('W', 'I').ok, '턴이 끝난 뒤 교역 불가');
});

// ---- 결과 -----------------------------------------------------------------

console.log(results.join('\n'));
console.log('\n' + (fail ? 'FAIL ' : 'PASS ') + pass + '/' + (pass + fail) + ' 통과');
process.exit(fail ? 1 : 0);
