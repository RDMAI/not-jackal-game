import { describe, expect, it } from 'vitest';
import { buildTestDeck, createInitialState } from './core/setup';
import {
  applyMove,
  isSea,
  parseArrowExits,
  parseChestCoins,
  parseTrapCost,
  validateMove,
} from './core/rules';
import type { CardType, GameState } from './core/types';

function runningState(): GameState {
  return createInitialState(['p1', 'p2'], 2, () => 0.5);
}

function countDeck(deck: CardType[], t: CardType): number {
  return deck.filter((c) => c === t).length;
}

describe('setup', () => {
  it('builds a 5x5 field with the 25-card test deck and 12 coins', () => {
    const deck = buildTestDeck();
    expect(deck).toHaveLength(25);
    expect(countDeck(deck, 'chest_3')).toBe(4);
    expect(countDeck(deck, 'arrow_1_5')).toBe(2);
    expect(countDeck(deck, 'arrow_0_4')).toBe(2);
    expect(countDeck(deck, 'arrow_1_3_5_7')).toBe(1);
    expect(countDeck(deck, 'trap_2')).toBe(3);
    expect(countDeck(deck, 'trap_3')).toBe(2);
    expect(countDeck(deck, 'empty')).toBe(11);

    const s = runningState();
    expect(s.fieldSizeX).toBe(5);
    expect(s.fieldSizeY).toBe(5);
    expect(Object.keys(s.cards)).toHaveLength(25);
    expect(s.totalCoins).toBe(12);
    expect(s.status).toBe('running');
    expect(Object.keys(s.pieces)).toHaveLength(6);
    expect(s.players['p1'].edge).toBe('north');
    expect(s.players['p2'].edge).toBe('south');
    // Ships on the sea ring, all pieces aboard.
    expect(s.pieces['p1_0'].x).toBe(2);
    expect(s.pieces['p1_0'].y).toBe(-1);
    expect(s.pieces['p2_0'].x).toBe(2);
    expect(s.pieces['p2_0'].y).toBe(5);
    // All cards face-down with no coins at deal time.
    for (const c of Object.values(s.cards)) {
      expect(c.faceUp).toBe(false);
      expect(c.coinsOnGround).toBe(0);
    }
  });
});

describe('parsers', () => {
  it('parses arrows, chests, traps', () => {
    expect(parseArrowExits('arrow_1_5')).toEqual([
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]);
    expect(parseArrowExits('arrow_0_4')).toEqual([
      { x: -1, y: -1 },
      { x: 1, y: 1 },
    ]);
    expect(parseArrowExits('arrow_1_3_5_7')).toHaveLength(4);
    expect(parseChestCoins('chest_3')).toBe(3);
    expect(parseTrapCost('trap_2')).toBe(2);
    expect(parseTrapCost('trap_3')).toBe(3);
  });
});

describe('rules', () => {
  it('rejects moving out of turn', () => {
    const s = runningState();
    const r = validateMove(s, 'p2', { kind: 'endTurn' });
    expect(r.ok).toBe(false);
  });

  it('allows one piece move then blocks second until endTurn', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 2;
    s.pieces['p1_0'].y = 0;
    s.cards['2_1'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const v = validateMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 1 } });
    expect(v.ok).toBe(true);
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 1 } });
    expect(s2.moved).toBe(true);
    const v2 = validateMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(v2.ok).toBe(false);
    const s3 = applyMove(s2, 'p1', { kind: 'endTurn' });
    expect(s3.currentTurn).toBe('p2');
    expect(s3.moved).toBe(false);
  });

  it('opens a chest on landing: coinsOnGround 0->3, type stays chest_3', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 1;
    s.cards['2_1'] = { type: 'chest_3', faceUp: false, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 1 } });
    expect(s2.cards['2_1'].faceUp).toBe(true);
    expect(s2.cards['2_1'].type).toBe('chest_3');
    expect(s2.cards['2_1'].coinsOnGround).toBe(3);
  });

  it('grab takes from coinsOnGround 3->2 and sets carrying', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 2;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'chest_3', faceUp: true, coinsOnGround: 3 };
    expect(validateMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' }).ok).toBe(true);
    const s2 = applyMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' });
    expect(s2.pieces['p1_0'].carrying).toBe(true);
    expect(s2.cards['2_2'].coinsOnGround).toBe(2);
  });

  it('move + endTurn auto-drops the coin onto the destination card', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 2;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'chest_3', faceUp: true, coinsOnGround: 1 };
    s.cards['2_3'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' });
    expect(s2.pieces['p1_0'].carrying).toBe(true);
    const s3 = applyMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 3 } });
    expect(s3.pieces['p1_0'].carrying).toBe(true);
    const s4 = applyMove(s3, 'p1', { kind: 'endTurn' });
    expect(s4.pieces['p1_0'].carrying).toBe(false);
    expect(s4.cards['2_3'].coinsOnGround).toBe(1);
    expect(s4.currentTurn).toBe('p2');
  });

  it('endTurn on own ship scores the coin and removes it', () => {
    const s = runningState();
    const ship = { x: 2, y: -1 };
    s.pieces['p1_0'].x = ship.x;
    s.pieces['p1_0'].y = ship.y;
    s.pieces['p1_0'].onShip = true;
    s.pieces['p1_0'].carrying = true;
    const s2 = applyMove(s, 'p1', { kind: 'endTurn' });
    expect(s2.pieces['p1_0'].carrying).toBe(false);
    expect(s2.players['p1'].score).toBe(1);
  });

  it('grab + endTurn without moving is a no-op', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 2;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'chest_3', faceUp: true, coinsOnGround: 3 };
    const s2 = applyMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' });
    const s3 = applyMove(s2, 'p1', { kind: 'endTurn' });
    expect(s3.pieces['p1_0'].carrying).toBe(false);
    expect(s3.cards['2_2'].coinsOnGround).toBe(3);
  });

  it('cannot grab from ships', () => {
    const s = runningState();
    // p1_0 starts on its ship carrying nothing.
    expect(s.pieces['p1_0'].onShip).toBe(true);
    const v = validateMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' });
    expect(v.ok).toBe(false);
  });

  it('knockout sends enemy home and drops coin to coinsOnGround', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.pieces['p2_0'].onShip = false;
    s.pieces['p2_0'].x = 2;
    s.pieces['p2_0'].y = 2;
    s.pieces['p2_0'].carrying = true;
    s.cards['2_2'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(s2.pieces['p2_0'].onShip).toBe(true);
    expect(s2.pieces['p2_0'].carrying).toBe(false);
    expect(s2.cards['2_2'].coinsOnGround).toBe(1);
  });

  it('arrow landing chains: pendingArrow set, continue same turn along exits', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'arrow_1_5', faceUp: false, coinsOnGround: 0 };
    s.cards['2_3'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    s.cards['3_2'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    // Landing stays put and flips face-up, chains.
    expect(s2.pieces['p1_0'].x).toBe(2);
    expect(s2.pieces['p1_0'].y).toBe(2);
    expect(s2.cards['2_2'].faceUp).toBe(true);
    expect(s2.moved).toBe(true);
    expect(s2.pendingArrow).toEqual({ pieceId: 'p1_0' });
    // Non-exit blocked same turn.
    const bad = validateMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 3, y: 2 } });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('must follow arrow exits');
    // Other pieces blocked while chain pending.
    s.pieces['p1_1'].onShip = false;
    const s2b: GameState = { ...s2, pieces: { ...s2.pieces, p1_1: { ...s2.pieces['p1_1'], onShip: false, x: 0, y: 0 } } };
    s2b.cards['0_1'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const other = validateMove(s2b, 'p1', { kind: 'movePiece', pieceId: 'p1_1', to: { x: 0, y: 1 } });
    expect(other.ok).toBe(false);
    // Exit allowed same turn.
    const good = validateMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 3 } });
    expect(good.ok).toBe(true);
    const s3 = applyMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 3 } });
    // Landing on non-arrow clears pending.
    expect(s3.pendingArrow).toBeNull();
    // Chain onto second arrow keeps pending.
    const t = runningState();
    t.pieces['p1_0'].onShip = false;
    t.pieces['p1_0'].x = 1;
    t.pieces['p1_0'].y = 2;
    t.cards['2_2'] = { type: 'arrow_1_5', faceUp: false, coinsOnGround: 0 };
    t.cards['2_3'] = { type: 'arrow_1_5', faceUp: false, coinsOnGround: 0 };
    const t2 = applyMove(t, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(t2.pendingArrow).toEqual({ pieceId: 'p1_0' });
    const t3 = applyMove(t2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 3 } });
    expect(t3.cards['2_3'].faceUp).toBe(true);
    expect(t3.pendingArrow).toEqual({ pieceId: 'p1_0' });
    // endTurn clears.
    const t4 = applyMove(t3, 'p1', { kind: 'endTurn' });
    expect(t4.pendingArrow).toBeNull();
    expect(t4.moved).toBe(false);
  });

  it('trap_3 sticks the piece for 3 turns and endTurn ticks down', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'trap_3', faceUp: false, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(s2.pieces['p1_0'].stuck).toBe(3);
    expect(s2.cards['2_2'].faceUp).toBe(true);
    const s3 = applyMove(s2, 'p1', { kind: 'endTurn' });
    const s4 = applyMove(s3, 'p2', { kind: 'endTurn' });
    expect(s4.pieces['p1_0'].stuck).toBe(2);
    const s5 = applyMove(s4, 'p1', { kind: 'endTurn' });
    const s6 = applyMove(s5, 'p2', { kind: 'endTurn' });
    expect(s6.pieces['p1_0'].stuck).toBe(1);
    const s7 = applyMove(s6, 'p1', { kind: 'endTurn' });
    const s8 = applyMove(s7, 'p2', { kind: 'endTurn' });
    expect(s8.pieces['p1_0'].stuck).toBe(0);
  });

  it('ship moves along the sea-ring edge and carries pieces', () => {
    const s = runningState();
    const v = validateMove(s, 'p1', { kind: 'moveShip', dir: 1 });
    expect(v.ok).toBe(true);
    const s2 = applyMove(s, 'p1', { kind: 'moveShip', dir: 1 });
    expect(s2.players['p1'].shipPos).toBe(3);
    expect(s2.pieces['p1_0'].x).toBe(3);
    expect(s2.pieces['p1_0'].y).toBe(-1);
  });

  it('sea is the ring outside the field except ship cells', () => {
    const s = runningState();
    expect(isSea(s, 2, 2)).toBe(false); // field land
    expect(isSea(s, -1, 0)).toBe(true); // water, no ship
    expect(isSea(s, 2, -1)).toBe(false); // p1 ship
    expect(isSea(s, 2, 5)).toBe(false); // p2 ship
  });
});
