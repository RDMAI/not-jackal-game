import { child, get, onValue, ref, runTransaction, type Unsubscribe } from 'firebase/database';
import { claimPlayer as claimPlayerState, startLobby } from '../core/lobby';
import { applyMove, validateMove } from '../core/rules';
import { isValidRoomId } from '../core/roomId';
import type { Action, GameState, RoomDoc } from '../core/types';
import { getDb } from './firebase';
import { normalizeRoomDoc } from './normalize';

export type RoomLoadErrorKind = 'not-found' | 'unsupported' | 'network';

export type RoomLoadResult =
  | { ok: true; room: RoomDoc }
  | { ok: false; kind: RoomLoadErrorKind; reason: string };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: string; kind?: 'conflict' | 'network' };

type StateUpdateResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function roomRef(roomId: string) {
  const id = roomId.trim();
  if (!isValidRoomId(id)) throw new Error('invalid room id');
  return ref(getDb(), `rooms/${id}`);
}

export async function fetchRoom(roomId: string): Promise<RoomLoadResult> {
  try {
    const snapshot = await get(roomRef(roomId));
    if (!snapshot.exists()) {
      return { ok: false, kind: 'not-found', reason: 'room not found' };
    }
    const normalized = normalizeRoomDoc(snapshot.val());
    if (!normalized.ok) {
      return { ok: false, kind: 'unsupported', reason: normalized.reason };
    }
    return { ok: true, room: normalized.room };
  } catch (error) {
    return { ok: false, kind: 'network', reason: errorMessage(error) };
  }
}

export function subscribeRoom(
  roomId: string,
  cb: (result: RoomLoadResult) => void,
): Unsubscribe {
  return onValue(
    roomRef(roomId),
    (snapshot) => {
      if (!snapshot.exists()) {
        cb({ ok: false, kind: 'not-found', reason: 'room not found' });
        return;
      }
      const normalized = normalizeRoomDoc(snapshot.val());
      if (!normalized.ok) {
        cb({ ok: false, kind: 'unsupported', reason: normalized.reason });
        return;
      }
      cb({ ok: true, room: normalized.room });
    },
    (error) => {
      cb({ ok: false, kind: 'network', reason: errorMessage(error) });
    },
  );
}

/**
 * Run a transaction on `rooms/{roomId}/state`. The pure updater may reject
 * with a specific reason; the reason is preserved instead of collapsed.
 */
async function writeState(
  roomId: string,
  update: (state: GameState) => StateUpdateResult,
): Promise<WriteResult> {
  let rejection = '';
  try {
    const result = await runTransaction(
      child(roomRef(roomId), 'state'),
      (current: unknown) => {
        if (current === null || current === undefined) {
          rejection = 'room not found';
          return;
        }
        if (typeof current !== 'object' || Array.isArray(current)) {
          rejection = 'room state is corrupt';
          return;
        }
        const next = update(current as GameState);
        if (!next.ok) {
          rejection = next.reason;
          return;
        }
        return next.state;
      },
    );

    if (!result.committed) {
      return {
        ok: false,
        reason: rejection || 'transaction rejected',
        kind: 'conflict',
      };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorMessage(error), kind: 'network' };
  }
}

export function claimPlayer(roomId: string, playerId: string): Promise<WriteResult> {
  return writeState(roomId, (state) => claimPlayerState(state, playerId));
}

export function startGame(roomId: string, byPlayerId: string): Promise<WriteResult> {
  return writeState(roomId, (state) => startLobby(state, byPlayerId));
}

export function submitAction(
  roomId: string,
  playerId: string,
  action: Action,
): Promise<WriteResult> {
  return writeState(roomId, (state) => {
    const validation = validateMove(state, playerId, action);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason ?? 'invalid move' };
    }
    return { ok: true, state: applyMove(state, playerId, action) };
  });
}

const STORAGE_PREFIX = 'not-jackal:room:';

function storageKey(roomId: string): string {
  return STORAGE_PREFIX + roomId.trim();
}

export function getSavedPlayerId(roomId: string): string | null {
  try {
    return localStorage.getItem(storageKey(roomId));
  } catch {
    return null;
  }
}

export function savePlayerId(roomId: string, playerId: string): void {
  try {
    localStorage.setItem(storageKey(roomId), playerId);
  } catch {
    // Best effort: storage may be unavailable (private mode / restricted iframe).
  }
}

export function clearSavedPlayerId(roomId: string): void {
  try {
    localStorage.removeItem(storageKey(roomId));
  } catch {
    // Best effort.
  }
}
