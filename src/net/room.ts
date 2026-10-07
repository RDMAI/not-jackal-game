import { get, onValue, ref, runTransaction, set, type Unsubscribe } from 'firebase/database';
import { applyMove, validateMove } from '../core/rules';
import { createInitialState, edgeForOrder, shipCellFor } from '../core/setup';
import type { Action, GameState } from '../core/types';
import { getDb } from './firebase';

export function roomRef(roomId: string) {
  return ref(getDb(), `rooms/${roomId}`);
}

export function generatePlayerId(): string {
  return 'p_' + Math.random().toString(36).slice(2, 8);
}

export function getMyId(): string {
  let id = localStorage.getItem('notjackal_playerId');
  if (!id) {
    id = generatePlayerId();
    localStorage.setItem('notjackal_playerId', id);
  }
  return id;
}

export async function createRoom(roomId: string, maxPlayers: number, playerId: string): Promise<void> {
  const snap = await get(roomRef(roomId));
  if (snap.exists()) throw new Error('room already exists');
  const state = createInitialState([playerId], maxPlayers);
  await set(roomRef(roomId), state);
}

export async function joinRoom(
  roomId: string,
  playerId: string,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await runTransaction(roomRef(roomId), (cur: GameState | null) => {
      if (!cur) return; // abort: no room
      if (cur.status === 'finished') return; // abort
      if (cur.players[playerId]) return cur; // already in: no-op
      const count = Object.keys(cur.players).length;
      if (count >= cur.maxPlayers) return; // abort: full
      if (cur.status !== 'lobby') return; // abort: already running
      const order = count;
      const edge = edgeForOrder(order);
      const shipPos = 4;
      cur.players[playerId] = { id: playerId, edge, shipPos, order, score: 0 };
      const ship = shipCellFor(edge, shipPos);
      for (let i = 0; i < 3; i++) {
        const pid = `${playerId}_${i}`;
        cur.pieces[pid] = {
          id: pid,
          playerId,
          x: ship.x,
          y: ship.y,
          onShip: true,
          carrying: false,
          stuck: 0,
        };
      }
      return cur;
    });
    if (!res.committed) return { ok: false, reason: 'cannot join (full / running / missing)' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export async function startGame(roomId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await runTransaction(roomRef(roomId), (cur: GameState | null) => {
      if (!cur) return;
      if (cur.status !== 'lobby') return;
      if (Object.keys(cur.players).length < 2) return;
      cur.status = 'running';
      const first = Object.values(cur.players).sort((a, b) => a.order - b.order)[0];
      cur.currentTurn = first.id;
      cur.moved = false;
      return cur;
    });
    if (!res.committed) return { ok: false, reason: 'need 2+ players in lobby' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Validate client-side, then apply inside a transaction to reduce races. */
export async function submitAction(
  roomId: string,
  playerId: string,
  action: Action,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await runTransaction(roomRef(roomId), (cur: GameState | null) => {
      if (!cur) return;
      const v = validateMove(cur, playerId, action);
      if (!v.ok) return; // abort
      return applyMove(cur, playerId, action);
    });
    if (!res.committed) return { ok: false, reason: 'invalid move or race, try again' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export function subscribeRoom(roomId: string, cb: (s: GameState | null) => void): Unsubscribe {
  return onValue(roomRef(roomId), (snap) => {
    cb(snap.val() as GameState | null);
  });
}
