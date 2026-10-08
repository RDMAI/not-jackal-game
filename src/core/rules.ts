import { shipCellFor } from './setup';
import type { Action, CardType, GameState, Vec } from './types';
import { cardKey } from './types';

export interface Validation {
  ok: boolean;
  reason?: string;
}

/** Keypad digits -> vectors (see first_implementation.md). */
const DIR_VECS: Record<string, Vec> = {
  '0': { x: -1, y: -1 },
  '1': { x: 0, y: -1 },
  '2': { x: 1, y: -1 },
  '3': { x: 1, y: 0 },
  '4': { x: 1, y: 1 },
  '5': { x: 0, y: 1 },
  '6': { x: -1, y: 1 },
  '7': { x: -1, y: 0 },
};

/** 'arrow_1_5' -> [{x:0,y:-1},{x:0,y:1}] */
export function parseArrowExits(type: CardType): Vec[] {
  if (!type.startsWith('arrow_')) return [];
  const digits = type.slice('arrow_'.length).split('_');
  const out: Vec[] = [];
  for (const d of digits) {
    const v = DIR_VECS[d];
    if (v) out.push({ ...v });
  }
  return out;
}

/** 'chest_3' -> 3, else 0 */
export function parseChestCoins(type: CardType): number {
  if (!type.startsWith('chest_')) return 0;
  const n = Number(type.slice('chest_'.length));
  return Number.isFinite(n) ? n : 0;
}

/** 'trap_2' -> 2, 'trap_3' -> 3, else 0 */
export function parseTrapCost(type: CardType): number {
  if (!type.startsWith('trap_')) return 0;
  const n = Number(type.slice('trap_'.length));
  return Number.isFinite(n) ? n : 0;
}

export function isField(x: number, y: number, state: GameState): boolean {
  return x >= 0 && y >= 0 && x < state.fieldSizeX && y < state.fieldSizeY;
}

/** Field plus the surrounding sea ring (ships live at -1 / fieldSize). */
export function isInBounds(x: number, y: number, state: GameState): boolean {
  return (
    x >= -1 && y >= -1 && x <= state.fieldSizeX && y <= state.fieldSizeY
  );
}

/** Ship cell of a given player in the given state. */
export function shipCellOf(state: GameState, playerId: string): Vec | null {
  const p = state.players[playerId];
  if (!p) return null;
  return shipCellFor(p.edge, p.shipPos, state.fieldSizeX, state.fieldSizeY);
}

/**
 * True if cell is sea: outside the field, except any player's current
 * ship cell. Far outside the ring also counts as sea.
 */
export function isSea(state: GameState, x: number, y: number): boolean {
  if (isField(x, y, state)) return false;
  for (const pid of Object.keys(state.players)) {
    const s = shipCellOf(state, pid);
    if (s && s.x === x && s.y === y) return false;
  }
  return true;
}

export function isOwnShipCell(state: GameState, playerId: string, x: number, y: number): boolean {
  const s = shipCellOf(state, playerId);
  return !!s && s.x === x && s.y === y;
}

function isNeighbour(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
}

function orderedPlayerIds(state: GameState): string[] {
  return Object.values(state.players)
    .sort((a, b) => a.order - b.order)
    .map((p) => p.id);
}

export function nextPlayerId(state: GameState): string {
  const ids = orderedPlayerIds(state);
  if (ids.length === 0) return '';
  const idx = ids.indexOf(state.currentTurn);
  if (idx === -1) return ids[0];
  return ids[(idx + 1) % ids.length];
}

/** Coins grabbable on a card: just coinsOnGround, for every card type. */
export function coinsOnCard(state: GameState, x: number, y: number): number {
  const c = state.cards[cardKey(x, y)];
  if (!c) return 0;
  return c.coinsOnGround ?? 0;
}

function isArrowCard(type: CardType): boolean {
  return type.startsWith('arrow_');
}

function trapStepOf(piece: { trapStep?: number }): number {
  return piece.trapStep ?? 0;
}

// ---- validation (pure, no I/O) ----

export function validateMove(
  state: GameState,
  playerId: string,
  action: Action,
): Validation {
  if (state.status === 'finished') return { ok: false, reason: 'game finished' };
  if (state.status === 'lobby') return { ok: false, reason: 'game not started' };
  if (!state.players[playerId]) return { ok: false, reason: 'unknown player' };
  if (state.currentTurn !== playerId) return { ok: false, reason: 'not your turn' };

  switch (action.kind) {
    case 'endTurn':
      return { ok: true };

    case 'moveShip': {
      if (state.moved) return { ok: false, reason: 'already moved this turn' };
      if (action.dir !== -1 && action.dir !== 1) return { ok: false, reason: 'bad dir' };
      const p = state.players[playerId];
      const max = p.edge === 'north' || p.edge === 'south' ? state.fieldSizeX : state.fieldSizeY;
      const next = p.shipPos + action.dir;
      if (next < 0 || next >= max) return { ok: false, reason: 'ship at edge' };
      const target = shipCellFor(p.edge, next, state.fieldSizeX, state.fieldSizeY);
      // Cannot sail onto another ship's cell.
      for (const otherId of Object.keys(state.players)) {
        if (otherId === playerId) continue;
        const s = shipCellOf(state, otherId);
        if (s && s.x === target.x && s.y === target.y) {
          return { ok: false, reason: 'cell occupied by enemy ship' };
        }
      }
      return { ok: true };
    }

    case 'movePiece': {
      const piece = state.pieces[action.pieceId];
      if (!piece) return { ok: false, reason: 'unknown piece' };
      if (piece.playerId !== playerId) return { ok: false, reason: 'not your piece' };
      const pending = state.pendingArrow;
      const isContinuation = !!pending && pending.pieceId === action.pieceId;
      if (pending && !isContinuation) {
        return { ok: false, reason: 'must continue arrow move' };
      }
      if (!isContinuation && state.moved) return { ok: false, reason: 'already moved this turn' };
      // Trapped mid-path: must advanceTrap, cannot movePiece away.
      if (trapStepOf(piece) > 0) {
        const curCard = state.cards[cardKey(piece.x, piece.y)];
        if (curCard && curCard.faceUp && curCard.type.startsWith('trap_')) {
          const n = parseTrapCost(curCard.type);
          if (trapStepOf(piece) < n) {
            return { ok: false, reason: 'must advance trap' };
          }
          // trapStep === N: fall through to normal neighbour checks below.
        }
      }
      const { x: tx, y: ty } = action.to;
      if (!isInBounds(tx, ty, state)) return { ok: false, reason: 'out of bounds' };
      if (!isNeighbour(piece.x, piece.y, tx, ty)) return { ok: false, reason: 'must move to neighbour' };
      if (isSea(state, tx, ty) && !isOwnShipCell(state, playerId, tx, ty)) {
        return { ok: false, reason: 'cannot sail to open sea' };
      }
      // Arrow-exit restriction: leaving a face-up arrow only via its exits.
      // This also enforces chained continuation (piece sits on the arrow
      // it just landed on). Stale pending with no arrow card cannot continue.
      if (isContinuation) {
        const cur = state.cards[cardKey(piece.x, piece.y)];
        if (!cur || !cur.faceUp || !isArrowCard(cur.type)) {
          return { ok: false, reason: 'must follow arrow exits' };
        }
      }
      if (!piece.onShip) {
        const cur = state.cards[cardKey(piece.x, piece.y)];
        if (cur && cur.faceUp && isArrowCard(cur.type)) {
          const exits = parseArrowExits(cur.type);
          const dx = tx - piece.x;
          const dy = ty - piece.y;
          const allowed = exits.some((v) => v.x === dx && v.y === dy);
          if (!allowed) return { ok: false, reason: 'must follow arrow exits' };
        }
      }
      if (piece.carrying) {
        // Carrying a coin: destination must already be discovered.
        if (!isOwnShipCell(state, playerId, tx, ty)) {
          const card = state.cards[cardKey(tx, ty)];
          if (!card) return { ok: false, reason: 'no card there' };
          if (!card.faceUp) return { ok: false, reason: 'cannot enter unknown with coin' };
        }
      }
      return { ok: true };
    }

    case 'advanceTrap': {
      const piece = state.pieces[action.pieceId];
      if (!piece) return { ok: false, reason: 'unknown piece' };
      if (piece.playerId !== playerId) return { ok: false, reason: 'not your piece' };
      if (state.pendingArrow) return { ok: false, reason: 'must continue arrow move' };
      if (state.moved) return { ok: false, reason: 'already moved this turn' };
      if (piece.onShip) return { ok: false, reason: 'piece is on ship' };
      if (piece.carrying) return { ok: false, reason: 'cannot advance while carrying' };
      if (trapStepOf(piece) <= 0) return { ok: false, reason: 'piece not on trap' };
      const card = state.cards[cardKey(piece.x, piece.y)];
      if (!card || !card.faceUp || !card.type.startsWith('trap_')) {
        return { ok: false, reason: 'piece not on trap' };
      }
      const n = parseTrapCost(card.type);
      if (trapStepOf(piece) >= n) return { ok: false, reason: 'already at last step' };
      return { ok: true };
    }

    case 'grab': {
      const piece = state.pieces[action.pieceId];
      if (!piece) return { ok: false, reason: 'unknown piece' };
      if (piece.playerId !== playerId) return { ok: false, reason: 'not your piece' };
      if (piece.onShip) return { ok: false, reason: 'piece is on ship' };
      if (piece.carrying) return { ok: false, reason: 'already carrying' };
      if (isSea(state, piece.x, piece.y)) return { ok: false, reason: 'cannot grab at sea' };
      if (!isOwnShipCell(state, playerId, piece.x, piece.y)) {
        // Ships hold no piles; also blocks grabbing on enemy ship cells.
      } else {
        return { ok: false, reason: 'no coin here' };
      }
      const card = state.cards[cardKey(piece.x, piece.y)];
      if (!card) return { ok: false, reason: 'no coin here' };
      if (card.faceUp && card.type.startsWith('trap_')) {
        const n = parseTrapCost(card.type);
        if (trapStepOf(piece) !== n) return { ok: false, reason: 'must reach last trap step' };
      }
      if ((card.coinsOnGround ?? 0) <= 0) return { ok: false, reason: 'no coin here' };
      return { ok: true };
    }

    case 'drop': {
      const piece = state.pieces[action.pieceId];
      if (!piece) return { ok: false, reason: 'unknown piece' };
      if (piece.playerId !== playerId) return { ok: false, reason: 'not your piece' };
      if (!piece.carrying) return { ok: false, reason: 'not carrying' };
      if (piece.onShip) {
        // Dropping while on ship = deposit only on own ship cell.
        if (!isOwnShipCell(state, playerId, piece.x, piece.y)) {
          return { ok: false, reason: 'must be on own ship to score' };
        }
        return { ok: true };
      }
      if (isSea(state, piece.x, piece.y)) return { ok: false, reason: 'cannot drop at sea' };
      return { ok: true };
    }
  }
}

// ---- apply (assumes valid; returns new state, does not mutate input) ----

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Move all on-ship pieces of the player along with the ship. */
function rideAlong(next: GameState, playerId: string): void {
  const s = shipCellOf(next, playerId);
  if (!s) return;
  for (const piece of Object.values(next.pieces)) {
    if (piece.playerId === playerId && piece.onShip) {
      piece.x = s.x;
      piece.y = s.y;
    }
  }
}

function checkWin(next: GameState): void {
  const scored = Object.values(next.players).reduce((sum, p) => sum + p.score, 0);
  if (scored >= next.totalCoins) {
    next.status = 'finished';
    let best: string | null = null;
    let bestScore = -1;
    for (const p of Object.values(next.players)) {
      if (p.score > bestScore) {
        bestScore = p.score;
        best = p.id;
      }
    }
    next.winner = best;
  }
}

/** Knock out enemies on the same cell AND same trap step; coins drop to the card. */
function knockoutAt(next: GameState, playerId: string, x: number, y: number, attackerStep: number): void {
  for (const other of Object.values(next.pieces)) {
    if (other.playerId !== playerId && !other.onShip && other.x === x && other.y === y) {
      if ((other.trapStep ?? 0) !== attackerStep) continue;
      if (other.carrying) {
        const c = next.cards[cardKey(x, y)];
        if (c) c.coinsOnGround = (c.coinsOnGround ?? 0) + 1;
        other.carrying = false;
      }
      const home = shipCellOf(next, other.playerId);
      other.onShip = true;
      if (home) {
        other.x = home.x;
        other.y = home.y;
      }
      other.trapStep = 0;
      delete (other as unknown as { stuck?: number }).stuck;
    }
  }
}

export function applyMove(state: GameState, playerId: string, action: Action): GameState {
  const next: GameState = clone(state);
  // Migrate legacy `stuck` saves: stuck N -> trapStep N (clamped later).
  for (const piece of Object.values(next.pieces)) {
    const legacy = (piece as unknown as { stuck?: number }).stuck;
    if (piece.trapStep === undefined) {
      piece.trapStep = typeof legacy === 'number' ? legacy : 0;
    }
    delete (piece as unknown as { stuck?: number }).stuck;
  }

  switch (action.kind) {
    case 'endTurn': {
      // Transient carrying: auto-drop (land) or auto-score (own ship).
      for (const piece of Object.values(next.pieces)) {
        if (piece.playerId !== playerId || !piece.carrying) continue;
        if (isOwnShipCell(next, playerId, piece.x, piece.y)) {
          piece.carrying = false;
          next.players[playerId].score += 1;
        } else {
          const card = next.cards[cardKey(piece.x, piece.y)];
          if (card) {
            card.coinsOnGround = (card.coinsOnGround ?? 0) + 1;
          }
          piece.carrying = false;
        }
      }
      checkWin(next);
      // Trap progress advances only via advanceTrap; endTurn ticks nothing.
      next.moved = false;
      next.pendingArrow = null;
      next.currentTurn = nextPlayerId(next);
      next.lastMove = { by: playerId, action: 'endTurn', at: Date.now() };
      return next;
    }

    case 'moveShip': {
      const p = next.players[playerId];
      p.shipPos += action.dir;
      rideAlong(next, playerId);
      next.moved = true;
      next.lastMove = { by: playerId, action: `moveShip:${action.dir}`, at: Date.now() };
      return next;
    }

    case 'grab': {
      const piece = next.pieces[action.pieceId];
      const card = next.cards[cardKey(piece.x, piece.y)];
      if (card && (card.coinsOnGround ?? 0) > 0) {
        card.coinsOnGround = (card.coinsOnGround ?? 0) - 1;
        piece.carrying = true;
      }
      next.lastMove = { by: playerId, action: `grab:${piece.id}`, at: Date.now() };
      return next;
    }

    case 'drop': {
      const piece = next.pieces[action.pieceId];
      if (piece.onShip && isOwnShipCell(next, playerId, piece.x, piece.y)) {
        piece.carrying = false;
        next.players[playerId].score += 1;
        checkWin(next);
      } else {
        const card = next.cards[cardKey(piece.x, piece.y)];
        if (card) {
          card.coinsOnGround = (card.coinsOnGround ?? 0) + 1;
        }
        piece.carrying = false;
      }
      next.lastMove = { by: playerId, action: `drop:${piece.id}`, at: Date.now() };
      return next;
    }

    case 'advanceTrap': {
      const piece = next.pieces[action.pieceId];
      piece.trapStep += 1;
      // Advancing onto an enemy's step knocks out enemies on that step.
      knockoutAt(next, playerId, piece.x, piece.y, piece.trapStep);
      next.moved = true;
      next.pendingArrow = null;
      next.lastMove = { by: playerId, action: `advanceTrap:${piece.id}->${piece.trapStep}`, at: Date.now() };
      return next;
    }

    case 'movePiece': {
      const piece = next.pieces[action.pieceId];
      const dest = action.to;
      const destIsShip = isOwnShipCell(next, playerId, dest.x, dest.y);

      // Leaving the trap card resets progress (any move goes to a new x,y).
      piece.trapStep = 0;
      piece.x = dest.x;
      piece.y = dest.y;
      piece.onShip = destIsShip;

      if (!destIsShip) {
        const key = cardKey(dest.x, dest.y);
        const card = next.cards[key];
        if (card && !card.faceUp) {
          card.faceUp = true; // discover
          if (card.type.startsWith('chest_')) {
            card.coinsOnGround = (card.coinsOnGround ?? 0) + parseChestCoins(card.type);
          }
        }

        // Trap effect on final cell: enter at step 1, drop coin to pile.
        // Determine attacker step first so knockout is same-step only.
        if (!piece.onShip) {
          const finalCard = next.cards[cardKey(piece.x, piece.y)];
          if (finalCard && finalCard.faceUp && finalCard.type.startsWith('trap_')) {
            piece.trapStep = 1;
            if (piece.carrying) {
              finalCard.coinsOnGround = (finalCard.coinsOnGround ?? 0) + 1;
              piece.carrying = false;
            }
          }
        }

        // Knockout enemies on the same step only.
        knockoutAt(next, playerId, dest.x, dest.y, piece.trapStep ?? 0);
      } else {
        piece.trapStep = 0;
      }

      next.moved = true;
      // Chained arrows: landing on a face-up arrow keeps the turn open
      // for that piece to continue along its exits. Anything else ends it.
      if (!destIsShip) {
        const finalCard = next.cards[cardKey(piece.x, piece.y)];
        if (finalCard && finalCard.faceUp && isArrowCard(finalCard.type)) {
          next.pendingArrow = { pieceId: piece.id };
        } else {
          next.pendingArrow = null;
        }
      } else {
        next.pendingArrow = null;
      }
      next.lastMove = { by: playerId, action: `movePiece:${piece.id}->${dest.x},${dest.y}`, at: Date.now() };
      return next;
    }
  }
}
