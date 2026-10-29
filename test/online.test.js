/* 온라인 대전 통합 테스트.
 * 서버를 띄우고 세 대의 "컴퓨터"가 각각 접속해 한 판을 끝까지 둔다.
 * 자리 배정 · 차례 강제 · 손패 가리기 · 상태 전파를 함께 확인한다.
 * `node test/online.test.js`
 */
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

global.window = {};
const root = path.join(__dirname, '..');
require(path.join(root, 'js/board.js'));
require(path.join(root, 'js/pieces.js'));
require(path.join(root, 'js/game.js'));
const B = window.Board, P = window.Pieces, R = window.GameRules;

const PORT = 8099;
const BASE = 'http://127.0.0.1:' + PORT;

let pass = 0;
function check(cond, what) {
  if (!cond) { console.error('  FAIL ' + what); process.exitCode = 1; throw new Error(what); }
  pass++;
  console.log('  ok   ' + what);
}

const post = (route, body) => fetch(BASE + route, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => r.json());

/** SSE 를 직접 읽는다. 마지막으로 받은 상태를 들고 있는다. */
function listen(token, onState) {
  return new Promise(resolve => {
    const req = http.get(BASE + '/events?token=' + token, res => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = frame.split('\n').find(l => l.startsWith('data: '));
          if (line) onState(JSON.parse(line.slice(6)));
        }
      });
      resolve(req);
    });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
/** 조건이 맞을 때까지 기다린다 (상태가 밀려오는 것을 기다리는 용도) */
async function until(fn, what) {
  for (let n = 0; n < 400; n++) { if (await fn()) return; await wait(25); }
  throw new Error('기다리다 지쳤습니다: ' + what);
}

(async function main() {
  const server = spawn(process.execPath, [path.join(root, 'server/server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.resume();
  server.stderr.on('data', d => process.stderr.write('[서버] ' + d));

  try {
    await until(async () => {
      try { await fetch(BASE + '/'); return true; } catch (e) { return false; }
    }, '서버 기동');

    // ---- 자리 배정 ----
    const seatsTaken = [];
    const tokens = [];
    for (let n = 0; n < 3; n++) {
      const j = await post('/join', { name: '컴퓨터' + (n + 1) });
      tokens.push(j.token);
      seatsTaken.push(j.seat);
    }
    check(JSON.stringify(seatsTaken) === '[0,1,2]', '접속 순서대로 P1·P2·P3 자리를 받는다');

    const spectator = await post('/join', { name: '구경꾼' });
    check(spectator.seat === null, '네 번째 접속자는 관전이 된다');

    const again = await post('/join', { token: tokens[1] });
    check(again.seat === 1, '같은 토큰으로 다시 오면 원래 자리로 돌아온다 (새로고침·재접속)');

    // ---- 상태 전파 ----
    const latest = [null, null, null];
    const views = [];
    for (let n = 0; n < 3; n++) {
      views.push(await listen(tokens[n], msg => { latest[n] = msg.state; }));
    }
    const specLatest = { state: null };
    views.push(await listen(spectator.token, msg => { specLatest.state = msg.state; }));
    await until(() => latest[0] && latest[1] && latest[2] && specLatest.state, '첫 상태 수신');
    check(true, '접속하면 서버가 바로 현재 판을 보내 준다');

    // ---- 손패 가리기 (규칙서 12장) ----
    const v = latest[1];
    check(v.players[1].hand !== null, 'P2 화면에는 P2 자신의 자원 종류가 온다');
    check(v.players[0].hand === null && v.players[2].hand === null,
      '남의 자원은 종류가 가려진 채로 온다');
    check(typeof v.players[0].count === 'number', '남의 자원도 장수는 공개된다');
    check(specLatest.state.players.every(p => p.hand === null), '관전자에게는 모든 손패가 가려진다');

    // ---- 차례 강제 ----
    const wrong = await post('/action', { token: tokens[1], type: 'place', args: ['c3'] });
    check(!wrong.ok && /P1/.test(wrong.message), '남의 차례에 두려 하면 서버가 막는다');
    const notSeated = await post('/action', { token: 'ㅇㅇ없는토큰', type: 'roll', args: [] });
    check(!notSeated.ok, '자리에 앉지 않은 사람은 둘 수 없다');

    // ---- 한 판을 끝까지 ----
    // 각 자리는 자기에게 온 상태만 보고 둔다. 실제 플레이와 같은 조건이다.
    const mirror = seat => new R.Game({ useTimer: false, controls: [seat], viewer: seat })
      .applySnapshot(latest[seat]);
    const pick = a => a[Math.floor(Math.random() * a.length)];

    async function playToEnd() {
    let steps = 0, summons = 0, moves = 0, pawns = 0, discards = 0, robbers = 0, trades = 0;
    while (latest[0].phase !== 'gameover') {
      if (steps++ > 4000) throw new Error('판이 끝나지 않습니다');
      const s = latest[0];                       // 누가 둘 차례인지는 공개 정보다
      let actor, type, args;

      if (s.phase === 'setup') { actor = s.setupQueue[0].player; type = 'place'; }
      else if (s.phase === 'discard') { actor = s.pendingDiscards[0].player; type = 'discard'; }
      else if (s.pendingPromotion) { actor = s.pendingPromotion.player; type = 'choosePromotion'; }
      else if (s.phase === 'robber') { actor = s.current; type = 'moveRobber'; }
      else if (s.phase === 'roll') { actor = s.current; type = 'roll'; }
      else { actor = s.current; type = 'action'; }

      const g = mirror(actor);
      if (type === 'place') args = [pick(g.setupCells(actor))];
      else if (type === 'roll') args = [];
      else if (type === 'discard') {
        const job = g.discardJob();
        const picks = { F: 0, W: 0, I: 0, M: 0 };
        let c = job.count;
        while (c > 0) for (const k of B.RESOURCES) {
          if (c > 0 && g.player(job.player).hand[k] > picks[k]) { picks[k]++; c--; }
        }
        args = [picks]; discards++;
      } else if (type === 'moveRobber') {
        args = [pick(B.order.filter(id => id !== g.robber && B.cells[id].terrain !== 'S'))];
        robbers++;
      } else if (type === 'choosePromotion') { args = [pick(g.promotionChoices(actor))]; pawns++; }
      else {
        // 행위 단계: 가끔 은행 교역, 그 다음 소환 아니면 이동
        if (Math.random() < 0.2) {
          const rich = B.RESOURCES.filter(k => g.player(actor).hand[k] >= R.BANK_RATE);
          if (rich.length) {
            const r = await post('/action', {
              token: tokens[actor], type: 'tradeBank',
              args: [rich[0], pick(B.RESOURCES.filter(k => k !== rich[0]))],
            });
            if (r.ok) { trades++; await until(() => latest[0] !== s, '교역 반영'); continue; }
          }
        }
        const can = P.SUMMONABLE.filter(t => g.canAfford(actor, t) && g.legalSummonCells(t).length);
        if (can.length && Math.random() < 0.45) {
          const t = pick(can);
          const spare = Object.assign({}, g.player(actor).hand);
          B.RESOURCES.forEach(k => { spare[k] -= (P.COSTS[t][k] || 0); });
          const extra = [];
          for (let e = 0; e < g.surcharge(actor).extra; e++) {
            const k = B.RESOURCES.find(k => spare[k] > 0);
            spare[k]--; extra.push(k);
          }
          type = 'summon'; args = [t, pick(g.legalSummonCells(t)), extra]; summons++;
        } else {
          const mine = [];
          for (const [id, pc] of g.pieces) if (pc.owner === actor && g.legalMoves(id).length) mine.push(id);
          if (mine.length) {
            const from = pick(mine);
            type = 'move'; args = [from, pick(g.legalMoves(from)).to]; moves++;
          } else { type = 'timeout'; args = []; }
        }
      }

      const before = latest[0];
      const r = await post('/action', { token: tokens[actor], type, args });
      if (!r.ok) throw new Error(type + ' 거부됨: ' + r.message);
      await until(() => latest[0] !== before, type + ' 반영');
    }
    return steps + '수: 소환 ' + summons + ' 이동 ' + moves + ' 교역 ' + trades
      + ' 버리기 ' + discards + ' 도둑 ' + robbers + ' 승급 ' + pawns;
    }

    check(true, '세 대가 한 판을 끝까지 두었다 (' + await playToEnd() + ')');

    const fin = latest[0];
    check(Array.isArray(fin.winners) && fin.winners.length >= 1, '승자가 정해졌다: '
      + fin.winners.map(i => 'P' + (i + 1)).join('·'));
    check(latest[1].phase === 'gameover' && latest[2].phase === 'gameover',
      '세 대가 모두 같은 결과를 보고 있다');
    check(JSON.stringify(latest[0].owners) === JSON.stringify(latest[2].owners),
      '점령 상태가 모든 화면에서 같다');

    // ---- 새 게임 ----
    const reset = await post('/reset', { token: tokens[0] });
    check(reset.ok, '앉아 있는 사람은 새 게임을 시작할 수 있다');
    await until(() => latest[0].phase === 'setup', '새 게임 전파');
    check(latest[2].round === 1, '모두의 화면이 새 판으로 바뀐다');
    const badReset = await post('/reset', { token: '없는토큰' });
    check(!badReset.ok, '관전자는 새 게임을 시작할 수 없다');

    // ---- 2인전 ----
    let room = null;
    views.push(await listen(tokens[0], msg => { room = msg.room; }));
    const duel = await post('/reset', { token: tokens[1], players: 2 });
    check(duel.ok && duel.players === 2, '새 게임을 2인전으로 시작할 수 있다');
    await until(() => latest[0].seats && latest[0].seats.length === 2 && room && room.players === 2, '2인전 전파');
    check(latest[0].players[2].absent && !latest[0].players[2].alive, '2인전에서 P3 자리는 불참으로 비어 있다');
    check(!latest[0].pieces.some(([, owner]) => owner === 2), 'P3 본진(l1)에는 킹이 놓이지 않는다');
    const kicked = await post('/join', { token: tokens[2] });
    check(kicked.seat === null, '3인전 때 P3 였던 사람은 관전으로 바뀐다');
    const third = await post('/join', { name: '늦게 온 사람' });
    check(third.seat === null && room.seats.length === 2, '2인전에서는 세 번째 접속자가 관전이 된다');
    const p3act = await post('/action', { token: tokens[2], type: 'roll', args: [] });
    check(!p3act.ok, '관전으로 바뀐 사람은 둘 수 없다');

    const duelLog = await playToEnd();
    check(latest[0].winners.every(i => i !== 2) && !latest[0].log.some(e => /^P3 /.test(e.text)),
      '두 대가 2인전 한 판을 끝까지 두었다 (' + duelLog + ')');
    check(latest[1].phase === 'gameover', '두 화면 모두 같은 결과를 본다');

    const back = await post('/reset', { token: tokens[0], players: 3 });
    check(back.ok && back.players === 3, '다시 3인전으로 돌릴 수 있다');

    views.forEach(req => req.destroy());
    console.log('\nPASS ' + pass + '개 확인');
  } finally {
    server.kill();
  }
})().catch(e => {
  console.error('\nFAIL ' + e.message);
  process.exit(1);
});
