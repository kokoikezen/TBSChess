/* pieces.js — 기물 정의와 이동 규칙(규칙서 8·9장)
 *
 * 기물 배치는 Map<칸id, {owner, type}> 하나로만 들고 다닌다.
 * 체크 판정에 쓸 가상 수를 둬 보려면 이 Map 만 얕게 복사하면 된다.
 */
(function (global) {
  'use strict';

  const B = global.Board;

  const TYPES = ['P', 'N', 'B', 'R', 'Q', 'K'];

  const PIECE_INFO = {
    P: { name: '폰',     value: 1, glyph: '♟' },
    N: { name: '나이트', value: 3, glyph: '♞' },
    B: { name: '비숍',   value: 3, glyph: '♝' },
    R: { name: '룩',     value: 5, glyph: '♜' },
    Q: { name: '퀸',     value: 9, glyph: '♛' },
    K: { name: '킹',     value: 0, glyph: '♚' },
  };

  /* 소환 비용 (규칙서 8장). 킹은 소환 대상이 아니다. */
  const COSTS = {
    P: { F: 1, W: 1 },
    N: { F: 1, I: 2 },
    B: { F: 1, I: 1, M: 1 },
    R: { W: 2, I: 1 },
    Q: { F: 1, I: 2, M: 2 },
  };

  const SUMMONABLE = ['P', 'N', 'B', 'R', 'Q'];

  /* 한 방향으로 막힐 때까지 미끄러진다. 상대 기물이 있는 칸은 잡고 멈춘다. */
  function slide(pieces, from, dirs, owner, out) {
    for (const dir of dirs) {
      let at = from;
      for (;;) {
        at = B.step(at, dir);
        if (!at) break;
        const occupant = pieces.get(at);
        if (!occupant) { out.push({ to: at, capture: null }); continue; }
        if (occupant.owner !== owner) out.push({ to: at, capture: occupant });
        break;   // 아군이든 적이든 그 뒤로는 못 지나간다
      }
    }
  }

  function hop(pieces, from, dirs, owner, out) {
    for (const dir of dirs) {
      const at = B.step(from, dir);
      if (!at) continue;
      const occupant = pieces.get(at);
      if (occupant && occupant.owner === owner) continue;
      out.push({ to: at, capture: occupant || null });
    }
  }

  /* 폰의 전진 방향 / 잡는 방향 — 전진 방향의 좌우 60도 칸 */
  function pawnDirs(owner) {
    const i = B.PAWN_FWD_INDEX[owner];
    return {
      forward: B.EDGE_DIRS[i],
      captures: [B.EDGE_DIRS[(i + 1) % 6], B.EDGE_DIRS[(i + 5) % 6]],
    };
  }

  /* 폰이 전진 방향으로 판 끝에 닿았는가 (귀환 조건) */
  function pawnAtEdge(owner, id) {
    return B.step(id, pawnDirs(owner).forward) === null;
  }

  /**
   * 한 기물의 이동 가능 칸.
   * @param pieces  Map<칸id, {owner,type}>
   * @param from    기물이 선 칸
   * @returns [{to, capture}]
   */
  function moves(pieces, from) {
    const piece = pieces.get(from);
    if (!piece) return [];
    const owner = piece.owner;
    const out = [];

    switch (piece.type) {
      case 'K':   // 변 6방향 + 꼭짓점 6방향으로 1칸 (총 12칸)
        hop(pieces, from, B.EDGE_DIRS, owner, out);
        hop(pieces, from, B.DIAG_DIRS, owner, out);
        break;
      case 'Q':   // 룩 + 비숍
        slide(pieces, from, B.EDGE_DIRS, owner, out);
        slide(pieces, from, B.DIAG_DIRS, owner, out);
        break;
      case 'R':
        slide(pieces, from, B.EDGE_DIRS, owner, out);
        break;
      case 'B':
        slide(pieces, from, B.DIAG_DIRS, owner, out);
        break;
      case 'N':   // 다른 기물을 뛰어넘는다
        hop(pieces, from, B.KNIGHT_DIRS, owner, out);
        break;
      case 'P': {
        const d = pawnDirs(owner);
        const ahead = B.step(from, d.forward);
        if (ahead && !pieces.get(ahead)) out.push({ to: ahead, capture: null });
        for (const dir of d.captures) {
          const at = B.step(from, dir);
          if (!at) continue;
          const occupant = pieces.get(at);
          if (occupant && occupant.owner !== owner) out.push({ to: at, capture: occupant });
        }
        break;
      }
    }
    return out;
  }

  /* 그 기물이 공격하는 칸들 — 폰만 이동과 공격이 다르다. */
  function attacks(pieces, from) {
    const piece = pieces.get(from);
    if (!piece) return [];
    if (piece.type !== 'P') return moves(pieces, from).map(m => m.to);
    return pawnDirs(piece.owner).captures
      .map(dir => B.step(from, dir))
      .filter(Boolean);
  }

  const findKing = (pieces, owner) => {
    for (const [id, p] of pieces) if (p.owner === owner && p.type === 'K') return id;
    return null;
  };

  /** owner 의 킹을 잡을 수 있는 기물들의 칸 목록 (규칙서 10장: 누구의 기물이든 체크). */
  function checkers(pieces, owner) {
    const king = findKing(pieces, owner);
    if (!king) return [];
    const out = [];
    for (const [id, p] of pieces) {
      if (p.owner === owner) continue;
      if (attacks(pieces, id).indexOf(king) >= 0) out.push(id);
    }
    return out;
  }

  const inCheck = (pieces, owner) => checkers(pieces, owner).length > 0;

  /* 체크 해소 여부를 보려고 가상으로 수를 둔다. 자원·점령은 체크 판정과 무관하므로 건드리지 않는다. */
  function withMove(pieces, from, to) {
    const next = new Map(pieces);
    next.delete(from);
    next.set(to, pieces.get(from));
    return next;
  }

  function withSummon(pieces, at, owner, type) {
    const next = new Map(pieces);
    next.set(at, { owner, type });
    return next;
  }

  global.Pieces = {
    TYPES, PIECE_INFO, COSTS, SUMMONABLE,
    moves, attacks, findKing, checkers, inCheck,
    withMove, withSummon, pawnDirs, pawnAtEdge,
  };
})(window);
