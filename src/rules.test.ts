import { describe, expect, it } from 'vitest';
import {
  buildDeckFromCounts,
  buildTestDeck,
  createInitialState,
  createStateFromConfig,
  defaultGameConfig,
  generateCards,
  validateConfig,
} from './core/setup';
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

  it('trap_3 multistep: enter at 1, advance consumes turn, exit at N', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'trap_3', faceUp: false, coinsOnGround: 0 };
    s.cards['3_2'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    s.cards['2_3'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(s2.pieces['p1_0'].trapStep).toBe(1);
    expect(s2.cards['2_2'].faceUp).toBe(true);
    // movePiece away from k=1 fails; advance needs a fresh turn.
    expect(
      validateMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 3, y: 2 } }).ok,
    ).toBe(false);
    expect(validateMove(s2, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' }).ok).toBe(false);
    const s2b = applyMove(applyMove(s2, 'p1', { kind: 'endTurn' }), 'p2', { kind: 'endTurn' });
    expect(validateMove(s2b, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' }).ok).toBe(true);
    const s3 = applyMove(s2b, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' });
    expect(s3.pieces['p1_0'].trapStep).toBe(2);
    expect(s3.moved).toBe(true);
    // Second advance same turn rejected.
    expect(validateMove(s3, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' }).ok).toBe(false);
    // Advance while carrying rejected.
    const carrying = { ...s2b, pieces: { ...s2b.pieces, p1_0: { ...s2b.pieces['p1_0'], carrying: true } } };
    expect(validateMove(carrying, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' }).ok).toBe(false);
    // Move away from k=2 still fails (fresh turn, so failure is trap-gating).
    const s3b = applyMove(applyMove(s3, 'p1', { kind: 'endTurn' }), 'p2', { kind: 'endTurn' });
    const away = validateMove(s3b, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 3 } });
    expect(away.ok).toBe(false);
    expect(away.reason).toBe('must advance trap');
  });

  it('idle endTurn does not advance trapped piece (regression)', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 2;
    s.pieces['p1_0'].y = 2;
    s.pieces['p1_0'].trapStep = 1;
    s.cards['2_2'] = { type: 'trap_3', faceUp: true, coinsOnGround: 0 };
    s.pieces['p1_1'].onShip = false;
    s.pieces['p1_1'].x = 0;
    s.pieces['p1_1'].y = 0;
    s.cards['0_1'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    // Move another piece, then endTurn; trapped piece stays at step 1.
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_1', to: { x: 0, y: 1 } });
    expect(s2.pieces['p1_0'].trapStep).toBe(1);
    const s3 = applyMove(s2, 'p1', { kind: 'endTurn' });
    const s4 = applyMove(s3, 'p2', { kind: 'endTurn' });
    expect(s4.pieces['p1_0'].trapStep).toBe(1);
  });

  it('trap coins: grab gated to last step, entry drops coin to pile', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.pieces['p1_0'].carrying = true;
    s.cards['2_2'] = { type: 'trap_3', faceUp: false, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(s2.pieces['p1_0'].trapStep).toBe(1);
    expect(s2.pieces['p1_0'].carrying).toBe(false);
    expect(s2.cards['2_2'].coinsOnGround).toBe(1);
    // Grab at k<N rejected.
    expect(validateMove(s2, 'p1', { kind: 'grab', pieceId: 'p1_0' }).ok).toBe(false);
    // Advance to last step, then grab ok.
    let cur = applyMove(s2, 'p1', { kind: 'endTurn' });
    cur = applyMove(cur, 'p2', { kind: 'endTurn' });
    cur = applyMove(cur, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' });
    cur = applyMove(cur, 'p1', { kind: 'endTurn' });
    cur = applyMove(cur, 'p2', { kind: 'endTurn' });
    cur = applyMove(cur, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' });
    expect(cur.pieces['p1_0'].trapStep).toBe(3);
    expect(validateMove(cur, 'p1', { kind: 'grab', pieceId: 'p1_0' }).ok).toBe(true);
    // Exit resets trapStep.
    cur.cards['3_2'] = { type: 'empty', faceUp: true, coinsOnGround: 0 };
    const exited = applyMove(cur, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 3, y: 2 } });
    expect(exited.pieces['p1_0'].trapStep).toBe(0);
  });

  it('knockout on same trap step sends enemy home with trapStep 0', () => {
    const s = runningState();
    s.pieces['p2_0'].onShip = false;
    s.pieces['p2_0'].x = 2;
    s.pieces['p2_0'].y = 2;
    s.pieces['p2_0'].trapStep = 1;
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'trap_3', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(s2.pieces['p2_0'].onShip).toBe(true);
    expect(s2.pieces['p2_0'].trapStep).toBe(0);
    expect(s2.pieces['p1_0'].trapStep).toBe(1);
  });

  it('enemy on a different trap step is NOT knocked out; pieces coexist', () => {
    const s = runningState();
    s.pieces['p2_0'].onShip = false;
    s.pieces['p2_0'].x = 2;
    s.pieces['p2_0'].y = 2;
    s.pieces['p2_0'].trapStep = 2;
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'trap_3', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    // Attacker enters at step 1, victim stays at step 2.
    expect(s2.pieces['p1_0'].trapStep).toBe(1);
    expect(s2.pieces['p2_0'].onShip).toBe(false);
    expect(s2.pieces['p2_0'].x).toBe(2);
    expect(s2.pieces['p2_0'].y).toBe(2);
    expect(s2.pieces['p2_0'].trapStep).toBe(2);
  });

  it('advanceTrap onto an enemy step knocks out that step only', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 2;
    s.pieces['p1_0'].y = 2;
    s.pieces['p1_0'].trapStep = 1;
    s.pieces['p2_0'].onShip = false;
    s.pieces['p2_0'].x = 2;
    s.pieces['p2_0'].y = 2;
    s.pieces['p2_0'].trapStep = 2;
    s.cards['2_2'] = { type: 'trap_3', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'advanceTrap', pieceId: 'p1_0' });
    expect(s2.pieces['p1_0'].trapStep).toBe(2);
    expect(s2.pieces['p2_0'].onShip).toBe(true);
    expect(s2.pieces['p2_0'].trapStep).toBe(0);
  });

  it('landing on trap via arrow chain clears pendingArrow and starts trap', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 1;
    s.pieces['p1_0'].y = 2;
    s.cards['2_2'] = { type: 'trap_3', faceUp: false, coinsOnGround: 0 };
    // Simulate pending arrow continuation onto the trap.
    s.pendingArrow = { pieceId: 'p1_0' };
    s.cards['1_2'] = { type: 'arrow_1_5', faceUp: true, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 2, y: 2 } });
    expect(s2.pieces['p1_0'].trapStep).toBe(1);
    expect(s2.pendingArrow).toBeNull();
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

describe('config', () => {
  it('default config validates and round-trips deck counts', () => {
    const c = defaultGameConfig();
    const v = validateConfig(c);
    expect(v.ok).toBe(true);
    expect(v.assigned).toBe(25);
    expect(v.expected).toBe(25);
    expect(buildDeckFromCounts(c.deckCounts)).toHaveLength(25);
  });

  it('rejects wrong sum and fewer than 2 edges', () => {
    const c = defaultGameConfig();
    const badSum = { ...c, fieldSizeX: 6, fieldSizeY: 6 };
    const v = validateConfig(badSum);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/cards assigned/);
    const badEdges = { ...c, edges: ['north' as const] };
    expect(validateConfig(badEdges).ok).toBe(false);
  });

  it('createStateFromConfig honors size, counts, edges', () => {
    const c = defaultGameConfig();
    c.fieldSizeX = 3;
    c.fieldSizeY = 4;
    c.deckCounts = {
      empty: 5,
      arrow_0_4: 1,
      arrow_1_5: 1,
      arrow_1_3_5_7: 1,
      chest_3: 2,
      trap_2: 1,
      trap_3: 1,
    };
    c.edges = ['north', 'south', 'west'];
    expect(validateConfig(c).ok).toBe(true);
    const s = createStateFromConfig(c, () => 0.5);
    expect(s.fieldSizeX).toBe(3);
    expect(s.fieldSizeY).toBe(4);
    expect(Object.keys(s.cards)).toHaveLength(12);
    expect(Object.keys(s.players)).toHaveLength(3);
    expect(s.totalCoins).toBe(6);
    expect(generateCards(() => 0.5, 3, 4, buildDeckFromCounts(c.deckCounts))).toBeDefined();
  });
});
