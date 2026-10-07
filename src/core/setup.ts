import type { Card, CardType, Edge, GameState } from './types';
import { cardKey } from './types';

export const FIELD_SIZE = 5;
export const PIECES_PER_PLAYER = 3;
export const CHEST_COINS = 3;
export const CHEST_COUNT = 4;
export const TOTAL_COINS = CHEST_COUNT * CHEST_COINS; // 12

/** Fixed 25-card test deck: 4 chests, 5 arrows, 5 traps, 11 empty. */
export function buildTestDeck(): CardType[] {
  const deck: CardType[] = [];
  for (let i = 0; i < 4; i++) deck.push('chest_3');
  for (let i = 0; i < 2; i++) deck.push('arrow_1_5');
  for (let i = 0; i < 2; i++) deck.push('arrow_0_4');
  deck.push('arrow_1_3_5_7');
  for (let i = 0; i < 3; i++) deck.push('trap_2');
  for (let i = 0; i < 2; i++) deck.push('trap_3');
  for (let i = 0; i < 11; i++) deck.push('empty');
  return deck;
}

/** Edges in join order: 2p north/south, 3p +west, 4p +east. */
export function edgeForOrder(order: number): Edge {
  const edges: Edge[] = ['north', 'south', 'west', 'east'];
  return edges[order] ?? 'north';
}

/**
 * Ship cell on the sea ring adjacent to the field.
 * Field coords are 0..fieldSize-1; ships float at -1 / fieldSize.
 */
export function shipCellFor(
  edge: Edge,
  shipPos: number,
  fieldSizeX: number = FIELD_SIZE,
  fieldSizeY: number = FIELD_SIZE,
): { x: number; y: number } {
  if (edge === 'north') return { x: shipPos, y: -1 };
  if (edge === 'south') return { x: shipPos, y: fieldSizeY };
  if (edge === 'west') return { x: -1, y: shipPos };
  return { x: fieldSizeX, y: shipPos };
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 5x5 land cells (x,y in 0..4). Fixed deck, shuffled, all face-down. */
export function generateCards(rand: () => number = Math.random): Record<string, Card> {
  const deck = buildTestDeck();
  const cards: Record<string, Card> = {};
  // Deterministic cell order, shuffled deck assignment.
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < FIELD_SIZE; y++) {
    for (let x = 0; x < FIELD_SIZE; x++) {
      cells.push({ x, y });
    }
  }
  const mixed = shuffled(deck, rand);
  cells.forEach((cell, i) => {
    cards[cardKey(cell.x, cell.y)] = {
      type: mixed[i],
      faceUp: false,
      coinsOnGround: 0,
    };
  });
  return cards;
}

/** Build a fresh running state for the given player ids (in join order). */
export function createInitialState(
  playerIds: string[],
  maxPlayers: number = playerIds.length,
  rand: () => number = Math.random,
): GameState {
  const cards = generateCards(rand);
  const players: GameState['players'] = {};
  const pieces: GameState['pieces'] = {};

  playerIds.forEach((id, order) => {
    const edge = edgeForOrder(order);
    const shipPos = 2;
    players[id] = { id, edge, shipPos, order, score: 0 };
    const ship = shipCellFor(edge, shipPos, FIELD_SIZE, FIELD_SIZE);
    for (let i = 0; i < PIECES_PER_PLAYER; i++) {
      const pid = `${id}_${i}`;
      pieces[pid] = {
        id: pid,
        playerId: id,
        x: ship.x,
        y: ship.y,
        onShip: true,
        carrying: false,
        stuck: 0,
      };
    }
  });

  return {
    fieldSizeX: FIELD_SIZE,
    fieldSizeY: FIELD_SIZE,
    status: 'running',
    currentTurn: playerIds[0] ?? '',
    totalCoins: TOTAL_COINS,
    maxPlayers,
    moved: false,
    players,
    pieces,
    cards,
    lastMove: null,
    winner: null,
  };
}
