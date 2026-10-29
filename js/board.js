/* board.js — 육각 판 좌표계, 자원 배치, 방향 정의
 *
 * 좌표계: 글린스키 육각 체스판 91칸. 열(file) a~l에서 j 제외 = 11열, 행(rank) 1~11.
 *   x  = 열 인덱스 - 5            (-5 .. +5, 중앙 열 f = 0)
 *   n  = 11 - |x|                 (그 열의 칸 수)
 *   y  = 2*rank - 12 + |x|        (세로 좌표, 같은 열에서 2씩 증가)
 * 큐브 좌표 (q, r, s) 로 바꾸면 칸 사이 거리를 max(|dq|,|dr|,|ds|) 로 구할 수 있다.
 *
 * 자원 배치(MAP)는 "삼국 마석 헥스맵2" 의 DATA 를 그대로 가져온 것이다.
 * 120도 회전 대칭이라 세 진영(f11 / a1 / l1)의 자원·숫자 구성이 완전히 같다.
 */
(function (global) {
  'use strict';

  const FILES = 'abcdefghikl';

  // ["지형", 주사위 숫자]  — S = 본진(생산 없음), F 식량 / W 목재 / I 철 / M 마석
  const MAP = {
    f11:['S',null], a1:['S',null], l1:['S',null],
    g10:['F',9],  a2:['F',9],  k1:['F',9],
    h9: ['W',3],  a3:['W',3],  i1:['W',3],
    i8: ['F',8],  a4:['F',8],  h1:['F',8],
    k7: ['W',5],  a5:['W',5],  g1:['W',5],
    a6: ['M',6],  f1:['M',6],  l6:['M',6],
    e10:['I',5],  b1:['I',5],  l2:['I',5],
    f10:['W',4],  b2:['W',4],  k2:['W',4],
    g9: ['F',8],  b3:['F',8],  i2:['F',8],
    h8: ['I',5],  b4:['I',5],  h2:['I',5],
    i7: ['M',2],  b5:['M',2],  g2:['M',2],
    b6: ['I',4],  f2:['I',4],  k6:['I',4],
    b7: ['W',3],  e1:['W',3],  l5:['W',3],
    d9: ['W',6],  c1:['W',6],  l3:['W',6],
    e9: ['F',3],  c2:['F',3],  k3:['F',3],
    f9: ['I',11], c3:['I',11], i3:['I',11],
    g8: ['W',10], c4:['W',10], h3:['W',10],
    h7: ['F',6],  c5:['F',6],  g3:['F',6],
    c6: ['W',10], f3:['W',10], i6:['W',10],
    c7: ['M',6],  e2:['M',6],  k5:['M',6],
    c8: ['F',12], d1:['F',12], l4:['F',12],
    d8: ['I',9],  d2:['I',9],  k4:['I',9],
    e8: ['W',8],  d3:['W',8],  i4:['W',8],
    f8: ['F',9],  d4:['F',9],  h4:['F',9],
    g7: ['I',5],  d5:['I',5],  g4:['I',5],
    d6: ['M',4],  f4:['M',4],  h6:['M',4],
    d7: ['F',11], e3:['F',11], i5:['F',11],
    e7: ['I',10], e4:['I',10], h5:['I',10],
    f7: ['W',8],  e5:['W',8],  g5:['W',8],
    e6: ['F',9],  f5:['F',9],  g6:['F',9],
    f6: ['M',7],
  };

  const HOMES = ['f11', 'a1', 'l1'];      // P1, P2, P3 본진
  const CENTER = 'f6';                    // 공용 마석 칸

  const RESOURCES = ['F', 'W', 'I', 'M'];
  const RES_INFO = {
    F: { name: '식량', glyph: '식' },
    W: { name: '목재', glyph: '목' },
    I: { name: '철',   glyph: '철' },
    M: { name: '마석', glyph: '마' },
  };

  /* 변이 맞닿은 6방향. 0번부터 시계 방향(북 → 북동 → 남동 → 남 → 남서 → 북서). */
  const EDGE_DIRS = [[0, 2], [1, 1], [1, -1], [0, -2], [-1, -1], [-1, 1]];
  /* 꼭짓점 방향 6방향 = 인접한 두 변 방향의 합. 비숍이 쓰는 대각선. */
  const DIAG_DIRS = [[1, 3], [2, 0], [1, -3], [-1, -3], [-2, 0], [-1, 3]];

  /* 나이트: 꼭짓점 방향으로 한 번 뛰어 2칸 거리의 6곳에 내린다 (사이 칸은 뛰어넘는다).
   * 조정: 글린스키 나이트(직선 2칸 + 60도 꺾어 1칸, 3칸 거리 12곳)는 이 판에서 너무 넓었다. */
  const KNIGHT_DIRS = DIAG_DIRS.slice();

  /* 폰의 전진 방향: 본진에서 중앙 f6 을 향하는 변 방향.
   * f11(0,10) → (0,-2) = EDGE 3 / a1(-5,-5) → (1,1) = EDGE 1 / l1(5,-5) → (-1,1) = EDGE 5 */
  const PAWN_FWD_INDEX = [3, 1, 5];

  // ---- 칸 테이블 만들기 ---------------------------------------------------

  const cells = {};   // id -> {id, file, rank, x, y, cube, terrain, dice, dist[3], zone[]}
  const order = [];   // 열/행 순서대로 정렬된 id 목록

  FILES.split('').forEach((file, qi) => {
    const x = qi - 5;
    const n = 11 - Math.abs(x);
    for (let rank = 1; rank <= n; rank++) {
      const y = 2 * rank - 12 + Math.abs(x);
      const id = file + rank;
      const q = x;
      const r = (-y - x) / 2;
      const entry = MAP[id];
      if (!entry) throw new Error('자원 배치에 없는 칸: ' + id);
      cells[id] = {
        id, file, rank, x, y,
        cube: [q, r, -q - r],
        terrain: entry[0],
        dice: entry[1],
      };
      order.push(id);
    }
  });

  const idAt = (x, y) => {
    const qi = x + 5;
    if (qi < 0 || qi > 10) return null;
    const file = FILES[qi];
    const rank = (y + 12 - Math.abs(x)) / 2;
    if (!Number.isInteger(rank) || rank < 1 || rank > 11 - Math.abs(x)) return null;
    return file + rank;
  };

  const step = (id, dir) => {
    const c = cells[id];
    return idAt(c.x + dir[0], c.y + dir[1]);
  };

  const distance = (a, b) => {
    const p = cells[a].cube, q = cells[b].cube;
    return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
  };

  /* 각 칸에서 세 본진까지의 거리, 그리고 가장 가까운 진영(영역 판정용) */
  Object.values(cells).forEach(c => {
    c.dist = HOMES.map(h => distance(c.id, h));
    const min = Math.min.apply(null, c.dist);
    c.zone = c.dist.map((d, i) => (d === min ? i : -1)).filter(i => i >= 0);
  });

  const neighbors = id => EDGE_DIRS.map(d => step(id, d)).filter(Boolean);
  const within = (id, radius) => order.filter(o => distance(id, o) <= radius);

  global.Board = {
    FILES, MAP, HOMES, CENTER, RESOURCES, RES_INFO,
    EDGE_DIRS, DIAG_DIRS, KNIGHT_DIRS, PAWN_FWD_INDEX,
    cells, order, idAt, step, distance, neighbors, within,
  };
})(window);
