import { shipCellFor } from './setup';
import type { Action, GameState, Vec } from './types';
import { cardKey } from './types';

export interface Validation {
  ok: boolean;
  reason?: string;
}

export function isInBounds(x: number, y: number, state: GameState): boolean {
  return x >= 0 && y >= 0 && x < state.boardSizeX && y < state.boardSizeY;
}

function isBorder(x: number, y: number, state: GameState): boolean {
  return x === 0 || y === 0 || x === state.boardSizeX - 1 || y === state.boardSizeY - 1;
}

function isCorner(x: number, y: number, state: GameState): boolean {
  const maxX = state.boardSizeX - 1;
  const maxY = state.boardSizeY - 1;
  return (x === 0 || x === maxX) && (y === 0 || y === maxY);
}

/** Ship cell of a given player in the given state. */
export function shipCellOf(state: GameState, playerId: string): Vec | null {
  const p = state.players[playerId];
  if (!p) return null;
  return shipCellFor(p.edge, p.shipPos);
}

/** True if cell is sea: border water except any player's current ship cell. */
export function isSea(state: GameState, x: number, y: number): boolean {
  if (!isInBounds(x, y, state)) return true;
  if (!isBorder(x, y, state)) return false;
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

function coinsOnCard(state: GameState, x: number, y: number): number {
  const c = state.cards[cardKey(x, y)];
  if (!c || c.type !== 'chest') return 0;
  return (c.coinsLeft ?? 0) + (c.coinsOnGround ?? 0);
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
      const next = p.shipPos + action.dir;
      if (next < 1 || next > state.boardSizeX - 2) return { ok: false, reason: 'ship at edge' };
      const target =
        p.edge === 'north' || p.edge === 'south'
          ? { x: next, y: p.edge === 'north' ? 0 : state.boardSizeY - 1 }
          : { x: p.edge === 'west' ? 0 : state.boardSizeX - 1, y: next };
      if (isCorner(target.x, target.y, state)) return { ok: false, reason: 'ship cannot go to corner' };
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
      if (state.moved) return { ok: false, reason: 'already moved this turn' };
      const piece = state.pieces[action.pieceId];
      if (!piece) return { ok: false, reason: 'unknown piece' };
      if (piece.playerId !== playerId) return { ok: false, reason: 'not your piece' };
      if (piece.stuck > 0) return { ok: false, reason: 'piece stuck in trap' };
      const { x: tx, y: ty } = action.to;
      if (!isInBounds(tx, ty, state)) return { ok: false, reason: 'out of bounds' };
      if (!isNeighbour(piece.x, piece.y, tx, ty)) return { ok: false, reason: 'must move to neighbour' };
      if (isSea(state, tx, ty) && !isOwnShipCell(state, playerId, tx, ty)) {
        return { ok: false, reason: 'cannot sail to open sea' };
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

    case 'grab': {
      const piece = state.pieces[action.pieceId];
      if (!piece) return { ok: false, reason: 'unknown piece' };
      if (piece.playerId !== playerId) return { ok: false, reason: 'not your piece' };
      if (piece.stuck > 0) return { ok: false, reason: 'piece stuck in trap' };
      if (piece.onShip) return { ok: false, reason: 'piece is on ship' };
      if (piece.carrying) return { ok: false, reason: 'already carrying' };
      if (coinsOnCard(state, piece.x, piece.y) <= 0) return { ok: false, reason: 'no coin here' };
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

export function applyMove(state: GameState, playerId: string, action: Action): GameState {
  const next: GameState = clone(state);

  switch (action.kind) {
    case 'endTurn': {
      // Stuck counters tick down each own turn.
      for (const piece of Object.values(next.pieces)) {
        if (piece.playerId === playerId && piece.stuck > 0) {
          piece.stuck -= 1;
        }
      }
      next.moved = false;
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
      if (card && card.type === 'chest') {
        if ((card.coinsOnGround ?? 0) > 0) {
          card.coinsOnGround = (card.coinsOnGround ?? 0) - 1;
          piece.carrying = true;
        } else if ((card.coinsLeft ?? 0) > 0) {
          card.coinsLeft = (card.coinsLeft ?? 0) - 1;
          piece.carrying = true;
        }
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
          if (card.type !== 'chest') {
            // Dropping on non-chest land: convert to ground pile holder.
            // Keep type but track coinsOnGround so grab can pick it up.
            card.coinsOnGround = (card.coinsOnGround ?? 0) + 1;
          } else {
            card.coinsOnGround = (card.coinsOnGround ?? 0) + 1;
          }
        }
        piece.carrying = false;
      }
      next.lastMove = { by: playerId, action: `drop:${piece.id}`, at: Date.now() };
      return next;
    }

    case 'movePiece': {
      const piece = next.pieces[action.pieceId];
      const dest = action.to;
      const destIsShip = isOwnShipCell(next, playerId, dest.x, dest.y);

      piece.x = dest.x;
      piece.y = dest.y;
      piece.onShip = destIsShip;

      if (!destIsShip) {
        const key = cardKey(dest.x, dest.y);
        const card = next.cards[key];
        if (card && !card.faceUp) {
          card.faceUp = true; // discover
        }

        // Knockout enemies on the landing card.
        for (const other of Object.values(next.pieces)) {
          if (other.playerId !== playerId && !other.onShip && other.x === dest.x && other.y === dest.y) {
            if (other.carrying) {
              const c = next.cards[key];
              if (c) c.coinsOnGround = (c.coinsOnGround ?? 0) + 1;
              other.carrying = false;
            }
            const home = shipCellOf(next, other.playerId);
            other.onShip = true;
            if (home) {
              other.x = home.x;
              other.y = home.y;
            }
            other.stuck = 0;
          }
        }

        // Arrow chain with loop guard.
        let guard = 0;
        const seen = new Set<string>([key]);
        while (guard++ < 20) {
          const cur = next.cards[cardKey(piece.x, piece.y)];
          if (!cur || cur.type !== 'arrow' || !cur.faceUp || !cur.arrowDir) break;
          const nx = piece.x + cur.arrowDir.x;
          const ny = piece.y + cur.arrowDir.y;
          if (!isInBounds(nx, ny, next)) break;
          if (isSea(next, nx, ny) && !isOwnShipCell(next, playerId, nx, ny)) break;
          const nkey = cardKey(nx, ny);
          if (seen.has(nkey)) break;
          seen.add(nkey);
          piece.x = nx;
          piece.y = ny;
          const landingOnShip = isOwnShipCell(next, playerId, nx, ny);
          piece.onShip = landingOnShip;
          if (landingOnShip) break;
          const landed = next.cards[nkey];
          if (landed && !landed.faceUp) landed.faceUp = true;
          // Knockout after each arrow step too.
          for (const other of Object.values(next.pieces)) {
            if (other.playerId !== playerId && !other.onShip && other.x === nx && other.y === ny) {
              if (other.carrying) {
                const c = next.cards[nkey];
                if (c) c.coinsOnGround = (c.coinsOnGround ?? 0) + 1;
                other.carrying = false;
              }
              const home = shipCellOf(next, other.playerId);
              other.onShip = true;
              if (home) {
                other.x = home.x;
                other.y = home.y;
              }
              other.stuck = 0;
            }
          }
          const after = next.cards[nkey];
          if (!after || after.type !== 'arrow' || !after.faceUp) {
            // Apply trap/chest effects of final cell below, then stop.
            break;
          }
        }

        // Trap effect on final cell.
        if (!piece.onShip) {
          const finalCard = next.cards[cardKey(piece.x, piece.y)];
          if (finalCard && finalCard.type === 'trap' && finalCard.faceUp) {
            piece.stuck = finalCard.trapCost ?? 2;
            if (piece.carrying) {
              finalCard.coinsOnGround = (finalCard.coinsOnGround ?? 0) + 1;
              piece.carrying = false;
            }
          }
        }
      } else {
        piece.stuck = 0;
      }

      next.moved = true;
      next.lastMove = { by: playerId, action: `movePiece:${piece.id}->${dest.x},${dest.y}`, at: Date.now() };
      return next;
    }
  }
}
