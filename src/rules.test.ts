import { describe, expect, it } from 'vitest';
import { createInitialState } from './core/setup';
import { applyMove, isSea, validateMove } from './core/rules';
import type { GameState } from './core/types';

function runningState(): GameState {
  const s = createInitialState(['p1', 'p2'], 2, () => 0.5);
  s.status = 'running';
  return s;
}

describe('setup', () => {
  it('creates 9x9 with 15 coins and 3 pieces per player', () => {
    const s = runningState();
    expect(s.boardSizeX).toBe(9);
    expect(s.totalCoins).toBe(15);
    expect(Object.keys(s.pieces)).toHaveLength(6);
    expect(s.players['p1'].edge).toBe('north');
    expect(s.players['p2'].edge).toBe('south');
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
    // Teleport a piece onto land for the test.
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 4;
    s.pieces['p1_0'].y = 1;
    s.cards['4_2'] = { type: 'empty', faceUp: true };
    const v = validateMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 4, y: 2 } });
    expect(v.ok).toBe(true);
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 4, y: 2 } });
    expect(s2.moved).toBe(true);
    const v2 = validateMove(s2, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 4, y: 3 } });
    expect(v2.ok).toBe(false);
    const s3 = applyMove(s2, 'p1', { kind: 'endTurn' });
    expect(s3.currentTurn).toBe('p2');
    expect(s3.moved).toBe(false);
  });

  it('ship moves along edge and carries pieces', () => {
    const s = runningState();
    const v = validateMove(s, 'p1', { kind: 'moveShip', dir: 1 });
    expect(v.ok).toBe(true);
    const s2 = applyMove(s, 'p1', { kind: 'moveShip', dir: 1 });
    expect(s2.players['p1'].shipPos).toBe(5);
    expect(s2.pieces['p1_0'].x).toBe(5);
    expect(s2.pieces['p1_0'].y).toBe(0);
  });

  it('grab and drop coin on chest', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 4;
    s.pieces['p1_0'].y = 4;
    s.cards['4_4'] = { type: 'chest', faceUp: true, coinsLeft: 3, coinsOnGround: 0 };
    expect(validateMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' }).ok).toBe(true);
    const s2 = applyMove(s, 'p1', { kind: 'grab', pieceId: 'p1_0' });
    expect(s2.pieces['p1_0'].carrying).toBe(true);
    expect(s2.cards['4_4'].coinsLeft).toBe(2);
  });

  it('knockout sends enemy home and drops coin', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 3;
    s.pieces['p1_0'].y = 4;
    s.pieces['p2_0'].onShip = false;
    s.pieces['p2_0'].x = 4;
    s.pieces['p2_0'].y = 4;
    s.pieces['p2_0'].carrying = true;
    s.cards['4_4'] = { type: 'chest', faceUp: true, coinsLeft: 1, coinsOnGround: 0 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 4, y: 4 } });
    expect(s2.pieces['p2_0'].onShip).toBe(true);
    expect(s2.pieces['p2_0'].carrying).toBe(false);
    expect(s2.cards['4_4'].coinsOnGround).toBe(1);
  });

  it('arrow chains one step', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 3;
    s.pieces['p1_0'].y = 4;
    s.cards['4_4'] = { type: 'arrow', faceUp: true, arrowDir: { x: 1, y: 0 } };
    s.cards['5_4'] = { type: 'empty', faceUp: false };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 4, y: 4 } });
    expect(s2.pieces['p1_0'].x).toBe(5);
    expect(s2.pieces['p1_0'].y).toBe(4);
    expect(s2.cards['5_4'].faceUp).toBe(true);
  });

  it('trap sticks piece and endTurn ticks down', () => {
    const s = runningState();
    s.pieces['p1_0'].onShip = false;
    s.pieces['p1_0'].x = 3;
    s.pieces['p1_0'].y = 4;
    s.cards['4_4'] = { type: 'trap', faceUp: true, trapCost: 2 };
    const s2 = applyMove(s, 'p1', { kind: 'movePiece', pieceId: 'p1_0', to: { x: 4, y: 4 } });
    expect(s2.pieces['p1_0'].stuck).toBe(2);
    const s3 = applyMove(s2, 'p1', { kind: 'endTurn' });
    // p1 stuck ticks, p2 turn, pass back to p1
    const s4 = applyMove(s3, 'p2', { kind: 'endTurn' });
    expect(s4.currentTurn).toBe('p1');
    const s5 = applyMove(s4, 'p1', { kind: 'endTurn' });
    expect(s5.pieces['p1_0'].stuck).toBe(0);
  });

  it('sea is blocked except own ship', () => {
    const s = runningState();
    expect(isSea(s, 0, 1)).toBe(true); // water, no ship
    expect(isSea(s, 4, 0)).toBe(false); // p1 ship
  });
});
