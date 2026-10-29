/* server.js — 같은 게임을 여러 컴퓨터에서 함께 두기 위한 작은 서버.
 *
 * 의존성 없이 Node 기본 모듈만 쓴다.  `node server/server.js` 로 띄우고
 * 다른 컴퓨터에서 http://<이 컴퓨터의 IP>:8080 으로 접속하면 된다.
 *
 * 구조
 *   - 판정은 전적으로 서버가 한다. 브라우저는 "이렇게 두고 싶다"만 보낸다.
 *   - 서버는 바뀐 상태를 SSE(EventSource)로 밀어 준다. 폴링도 웹소켓도 필요 없다.
 *   - 자원 종류는 본인에게만 보낸다 (규칙서 12장). 남의 것은 장수만 간다.
 *   - 2인전도 된다. 새 게임을 시작할 때 인원을 고르거나, `PLAYERS=2` 로 띄운다.
 *     2인전은 P1(f11)·P2(a1)만 앉고, P3 본진(l1) 쪽은 빈 땅으로 남는다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

global.window = {};
const root = path.join(__dirname, '..');
require(path.join(root, 'js/board.js'));
require(path.join(root, 'js/pieces.js'));
require(path.join(root, 'js/game.js'));
const R = global.window.GameRules;

const PORT = Number(process.env.PORT) || 8080;
let playerCount = Number(process.env.PLAYERS) === 2 ? 2 : 3;

// ---- 방 -------------------------------------------------------------------

const seats = [null, null, null];   // 자리마다 토큰
const names = [null, null, null];   // 자리마다 표시 이름
const clients = [];                 // {res, token}
let game = null;

function seatOf(token) {
  const i = seats.indexOf(token);
  return i < 0 ? null : i;
}

/** 이번 판에 쓰는 자리 번호 — 2인전이면 [0, 1] */
const activeSeats = () => [0, 1, 2].slice(0, playerCount);

function newGame(count) {
  if (count === 2 || count === 3) playerCount = count;
  // 인원을 줄이면 남는 자리에 앉아 있던 사람은 관전으로 돌아간다
  for (let i = playerCount; i < seats.length; i++) {
    if (seats[i]) log('P' + (i + 1) + ' (' + names[i] + ') 는 ' + playerCount + '인전이라 관전으로 바뀝니다.');
    seats[i] = null;
    names[i] = null;
  }
  game = new R.Game({ useTimer: true, onChange: broadcast, seats: activeSeats() });
  log(playerCount + '인전 새 게임을 시작했습니다.');
}

function roomState() {
  return {
    players: playerCount,
    seats: activeSeats().map(i => ({ seat: i, taken: !!seats[i], name: names[i] })),
    watching: clients.length,
  };
}

function broadcast() {
  const dead = [];
  clients.forEach(c => {
    const seat = seatOf(c.token);
    const payload = JSON.stringify({ room: roomState(), state: game.snapshot(seat), seat });
    try { c.res.write('data: ' + payload + '\n\n'); }
    catch (e) { dead.push(c); }
  });
  dead.forEach(c => { const i = clients.indexOf(c); if (i >= 0) clients.splice(i, 1); });
}

const log = msg => console.log('[' + new Date().toLocaleTimeString('ko-KR') + '] ' + msg);

/** 제한 시간은 서버가 센다. 브라우저를 닫아도 턴이 멈추지 않는다. */
setInterval(() => {
  if (!game || !game.deadline) return;
  if (game.secondsLeft() === 0) {
    log('P' + (game.current + 1) + ' 시간 초과');
    game.timeout();
  }
}, 500);

// ---- 행위 권한 -------------------------------------------------------------

/** 이 행위를 할 수 있는 자리. 틀린 사람이 보내면 서버가 막는다. */
function actorFor(type) {
  switch (type) {
    case 'place': return game.setupJob() ? game.setupJob().player : null;
    case 'discard': return game.discardJob() ? game.discardJob().player : null;
    case 'respondTrade': return game.offer ? game.offer.to : null;
    case 'choosePromotion': return game.pendingPromotion ? game.pendingPromotion.player : null;
    default: return game.current;      // roll · moveRobber · 교역 · 소환 · 이동 · 턴 넘기기
  }
}

const ALLOWED = ['place', 'roll', 'discard', 'moveRobber', 'tradeBank', 'proposeTrade',
  'respondTrade', 'summon', 'move', 'choosePromotion', 'timeout'];

function applyAction(token, type, args) {
  const seat = seatOf(token);
  if (seat === null) return { ok: false, message: '관전자는 둘 수 없습니다. 빈 자리에 앉으세요.' };
  if (ALLOWED.indexOf(type) < 0) return { ok: false, message: '알 수 없는 행위입니다.' };
  const actor = actorFor(type);
  if (actor === null) return { ok: false, message: '지금은 그 행위를 할 수 없습니다.' };
  if (actor !== seat) return { ok: false, message: 'P' + (actor + 1) + '의 차례입니다.' };
  return game[type].apply(game, args || []);
}

// ---- 정적 파일 --------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveFile(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.resolve(root, rel);
  // 루트 밖으로 나가는 경로는 거부한다
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, '403');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, '404 ' + rel);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(body);
};
const sendJson = (res, obj, code) => send(res, code || 200, JSON.stringify(obj), 'application/json; charset=utf-8');

function readBody(req, done) {
  let body = '';
  req.on('data', c => {
    body += c;
    if (body.length > 1e5) { body = ''; req.destroy(); }
  });
  req.on('end', () => {
    try { done(JSON.parse(body || '{}')); }
    catch (e) { done(null); }
  });
}

// ---- 라우팅 -----------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;

  // 자리 잡기. 토큰을 가지고 다시 오면 같은 자리로 돌아온다 (새로고침·재접속).
  if (route === '/join' && req.method === 'POST') {
    return readBody(req, body => {
      if (!body) return sendJson(res, { ok: false, message: '잘못된 요청' }, 400);
      let token = body.token;
      let seat = token ? seatOf(token) : null;
      if (seat === null) {
        seat = activeSeats().find(i => !seats[i]);
        if (seat === undefined) {                        // 자리가 다 찼으면 관전
          return sendJson(res, { ok: true, token: token || crypto.randomUUID(), seat: null, room: roomState() });
        }
        token = token || crypto.randomUUID();
        seats[seat] = token;
      }
      names[seat] = (body.name || '').toString().slice(0, 16) || ('P' + (seat + 1));
      log('P' + (seat + 1) + ' (' + names[seat] + ') 접속');
      broadcast();
      return sendJson(res, { ok: true, token, seat, room: roomState() });
    });
  }

  // 상태 밀어주기 (Server-Sent Events)
  if (route === '/events') {
    const token = url.searchParams.get('token') || '';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': 연결됨\n\n');
    const client = { res, token };
    clients.push(client);
    const seat = seatOf(token);
    res.write('data: ' + JSON.stringify({ room: roomState(), state: game.snapshot(seat), seat }) + '\n\n');
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => {
      clearInterval(keepAlive);
      const i = clients.indexOf(client);
      if (i >= 0) clients.splice(i, 1);
      broadcast();
    });
    return;
  }

  // 행위 보내기
  if (route === '/action' && req.method === 'POST') {
    return readBody(req, body => {
      if (!body) return sendJson(res, { ok: false, message: '잘못된 요청' }, 400);
      const result = applyAction(body.token, body.type, body.args);
      return sendJson(res, result);
    });
  }

  // 새 게임
  if (route === '/reset' && req.method === 'POST') {
    return readBody(req, body => {
      if (!body || seatOf(body.token) === null) {
        return sendJson(res, { ok: false, message: '앉아 있는 사람만 새 게임을 시작할 수 있습니다.' }, 403);
      }
      newGame(Number(body.players));
      broadcast();
      return sendJson(res, { ok: true, players: playerCount });
    });
  }

  // 자리 비우기
  if (route === '/leave' && req.method === 'POST') {
    return readBody(req, body => {
      const seat = body && seatOf(body.token);
      if (seat !== null && seat !== undefined) {
        seats[seat] = null;
        names[seat] = null;
        log('P' + (seat + 1) + ' 자리를 비웠습니다.');
        broadcast();
      }
      return sendJson(res, { ok: true });
    });
  }

  if (req.method !== 'GET') return send(res, 405, '405');
  return serveFile(req, res, route);
});

newGame();
server.listen(PORT, () => {
  const addrs = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(name => {
    (nets[name] || []).forEach(n => {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    });
  });
  console.log('\n카탄 증강 체스 서버가 떴습니다.\n');
  console.log('  이 컴퓨터     http://localhost:' + PORT);
  addrs.forEach(a => console.log('  같은 와이파이 http://' + a + ':' + PORT));
  console.log('\n지금은 ' + playerCount + '인전입니다. 다른 컴퓨터에서 위 주소를 열면 빈 자리에 앉고, 자리가 차면 관전이 됩니다.');
  console.log('인원은 화면의 "다시 시작" 옆에서 2인·3인을 골라 바꿀 수 있습니다.');
  console.log('멈추려면 Ctrl+C.\n');
});
