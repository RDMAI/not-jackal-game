import { describe, expect, it } from 'vitest';
import {
  claimPlayer,
  createLobbyState,
  createRoomDoc,
  startLobby,
  validateStart,
} from './core/lobby';
import { isValidRoomId } from './core/roomId';
import { applyMove } from './core/rules';
import { createInitialState, defaultGameConfig } from './core/setup';
import type { GameConfig, GameState } from './core/types';

function lobby(): GameState {
  return createLobbyState(defaultGameConfig(), () => 0.5);
}

function claimedLobby(): GameState {
  const first = claimPlayer(lobby(), 'p1');
  if (!first.ok) throw new Error(first.reason);
  const second = claimPlayer(first.state, 'p2');
  if (!second.ok) throw new Error(second.reason);
  return second.state;
}

describe('createLobbyState', () => {
  it('builds a lobby with unclaimed players, ships, pieces, and cards', () => {
    const state = lobby();

    expect(state.status).toBe('lobby');
    expect(state.currentTurn).toBe('');
    expect(state.totalCoins).toBe(12);
    expect(state.maxPlayers).toBe(2);
    expect(state.turnsPassed).toBe(0);
    expect(state.moved).toBe(false);
    expect(state.pendingArrow).toBeNull();
    expect(state.lastMove).toBeNull();
    expect(state.winner).toBeNull();

    expect(Object.keys(state.players)).toEqual(['p1', 'p2']);
    expect(Object.values(state.players).every((player) => player.joined === false)).toBe(true);
    expect(state.players['p1']).toMatchObject({ edge: 'north', shipPos: 2, order: 0, score: 0 });
    expect(state.players['p2']).toMatchObject({ edge: 'south', shipPos: 2, order: 1, score: 0 });

    expect(Object.keys(state.pieces)).toHaveLength(6);
    for (const player of Object.values(state.players)) {
      for (let i = 0; i < 3; i++) {
        const piece = state.pieces[`${player.id}_${i}`];
        expect(piece).toBeDefined();
        expect(piece.onShip).toBe(true);
        expect(piece.carrying).toBe(false);
        expect(piece.trapStep).toBe(0);
        expect(piece.x).toBe(2);
        expect(piece.y).toBe(player.edge === 'north' ? -1 : 5);
      }
    }

    expect(Object.keys(state.cards)).toHaveLength(25);
    for (const card of Object.values(state.cards)) {
      expect(card.faceUp).toBe(false);
      expect(card.coinsOnGround).toBe(0);
    }
  });

  it('throws on an invalid config', () => {
    const bad: GameConfig = { ...defaultGameConfig(), fieldSizeX: 2 };
    expect(() => createLobbyState(bad, () => 0.5)).toThrow();
  });

  it('createRoomDoc carries the room version', () => {
    const room = createRoomDoc(defaultGameConfig(), () => 0.5);
    expect(room.version).toBe(1);
    expect(room.state.status).toBe('lobby');
  });
});

describe('claimPlayer', () => {
  it('claims only the requested slot and does not mutate the input', () => {
    const before = lobby();
    const result = claimPlayer(before, 'p1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players['p1'].joined).toBe(true);
    expect(result.state.players['p2'].joined).toBe(false);
    expect(before.players['p1'].joined).toBe(false);
  });

  it('rejects an already claimed, unknown, or non-lobby slot', () => {
    const once = claimPlayer(lobby(), 'p1');
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    expect(claimPlayer(once.state, 'p1').ok).toBe(false);
    expect(claimPlayer(once.state, 'p9').ok).toBe(false);
    expect(claimPlayer({ ...once.state, status: 'running' }, 'p2').ok).toBe(false);
    expect(claimPlayer({ ...once.state, status: 'finished' }, 'p2').ok).toBe(false);
    expect(claimPlayer({ ...once.state, players: {} }, 'p2').ok).toBe(false);
  });
});

describe('validateStart / startLobby', () => {
  it('requires p1 and every slot to be claimed', () => {
    const ready = claimedLobby();
    expect(validateStart(ready, 'p1').ok).toBe(true);
    expect(validateStart(ready, 'p2').ok).toBe(false);

    const onlyP1 = claimPlayer(lobby(), 'p1');
    if (!onlyP1.ok) throw new Error(onlyP1.reason);
    const notReady = validateStart(onlyP1.state, 'p1');
    expect(notReady.ok).toBe(false);
    expect(notReady.reason).toMatch(/not claimed/);
  });

  it('rejects a wrong status, corrupt cards, or corrupt pieces', () => {
    const ready = claimedLobby();
    expect(validateStart({ ...ready, status: 'running' }, 'p1').ok).toBe(false);

    const missingCard = Object.fromEntries(Object.entries(ready.cards).slice(1));
    expect(validateStart({ ...ready, cards: missingCard }, 'p1').ok).toBe(false);

    const pieceOffShip = {
      ...ready,
      pieces: {
        ...ready.pieces,
        p1_0: { ...ready.pieces['p1_0'], onShip: false },
      },
    };
    expect(validateStart(pieceOffShip, 'p1').ok).toBe(false);
  });

  it('starts on the first player by order and preserves cards/pieces', () => {
    const ready = claimedLobby();
    const result = startLobby(ready, 'p1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.status).toBe('running');
    expect(result.state.currentTurn).toBe('p1');
    expect(result.state.moved).toBe(false);
    expect(result.state.pendingArrow).toBeNull();
    expect(result.state.lastMove).toBeNull();
    expect(result.state.winner).toBeNull();
    expect(result.state.turnsPassed).toBe(0);
    expect(result.state.cards).toEqual(ready.cards);
    expect(result.state.pieces).toEqual(ready.pieces);

    expect(startLobby(ready, 'p2').ok).toBe(false);
  });
});

describe('turnsPassed', () => {
  it('starts at 0 and increments once per successful endTurn', () => {
    let state = createInitialState(['p1', 'p2'], 2, () => 0.5);
    expect(state.turnsPassed).toBe(0);

    state.moved = true;
    state = applyMove(state, 'p1', { kind: 'endTurn' });
    expect(state.turnsPassed).toBe(1);

    state.moved = true;
    state = applyMove(state, state.currentTurn, { kind: 'endTurn' });
    expect(state.turnsPassed).toBe(2);
  });
});

describe('checkWin ties', () => {
  it('records a unique winner or the tie sentinel', () => {
    const unique = createInitialState(['p1', 'p2'], 2, () => 0.5);
    unique.currentTurn = 'p1';
    unique.moved = true;
    unique.totalCoins = 10;
    unique.players['p1'].score = 7;
    unique.players['p2'].score = 3;
    const won = applyMove(unique, 'p1', { kind: 'endTurn' });
    expect(won.status).toBe('finished');
    expect(won.winner).toBe('p1');

    const tied = createInitialState(['p1', 'p2'], 2, () => 0.5);
    tied.currentTurn = 'p1';
    tied.moved = true;
    tied.totalCoins = 10;
    tied.players['p1'].score = 5;
    tied.players['p2'].score = 5;
    const draw = applyMove(tied, 'p1', { kind: 'endTurn' });
    expect(draw.status).toBe('finished');
    expect(draw.winner).toBe('tie');
  });
});

describe('isValidRoomId', () => {
  it('accepts trimmed ids and rejects RTDB path/key characters', () => {
    expect(isValidRoomId('abc-123')).toBe(true);
    expect(isValidRoomId('  abc-123  ')).toBe(true);
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId('   ')).toBe(false);
    for (const bad of ['a/b', 'a.b', 'a#b', 'a$b', 'a[b', 'a]b']) {
      expect(isValidRoomId(bad)).toBe(false);
    }
  });
});
