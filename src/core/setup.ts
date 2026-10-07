import type { Card, Edge, GameState } from './types';
import { cardKey } from './types';

export const BOARD_SIZE = 9;
export const CHEST_COUNT = 5;
export const COINS_PER_CHEST = 3;
export const TOTAL_COINS = CHEST_COUNT * COINS_PER_CHEST; // 15
export const ARROW_COUNT = 16;
export const TRAP_COUNT = 4;
export const TRAP_COST = 2;
export const PIECES_PER_PLAYER = 3;

const ARROW_DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/** Edges in join order: 2p north/south, 3p +west, 4p +east. */
export function edgeForOrder(order: number): Edge {
  const edges: Edge[] = ['north', 'south', 'west', 'east'];
  return edges[order] ?? 'north';
}

export function shipCellFor(edge: Edge, shipPos: number): { x: number; y: number } {
  if (edge === 'north') return { x: shipPos, y: 0 };
  if (edge === 'south') return { x: shipPos, y: BOARD_SIZE - 1 };
  if (edge === 'west') return { x: 0, y: shipPos };
  return { x: BOARD_SIZE - 1, y: shipPos };
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Interior 7x7 land cells (x,y in 1..7). Fixed deck, shuffled. */
export function generateCards(rand: () => number = Math.random): Record<string, Card> {
  type DeckEntry = Pick<Card, 'type' | 'arrowDir' | 'coinsLeft' | 'coinsOnGround' | 'trapCost'>;
  const deck: DeckEntry[] = [];

  for (let i = 0; i < CHEST_COUNT; i++) {
    deck.push({ type: 'chest', coinsLeft: COINS_PER_CHEST, coinsOnGround: 0 });
  }
  for (let i = 0; i < ARROW_COUNT; i++) {
    deck.push({ type: 'arrow', arrowDir: ARROW_DIRS[i % ARROW_DIRS.length] });
  }
  for (let i = 0; i < TRAP_COUNT; i++) {
    deck.push({ type: 'trap', trapCost: TRAP_COST });
  }
  const empties = BOARD_SIZE * BOARD_SIZE - 32 - deck.length; // 49 land - deck; 32 = border cells
  // interior is 7x7=49; compute directly for clarity:
  const interior = 7 * 7;
  const rest = interior - deck.length;
  for (let i = 0; i < rest; i++) {
    deck.push({ type: 'empty' });
  }
  void empties;

  const cards: Record<string, Card> = {};
  // Deterministic cell order, shuffled deck assignment.
  const cells: { x: number; y: number }[] = [];
  for (let y = 1; y <= 7; y++) {
    for (let x = 1; x <= 7; x++) {
      cells.push({ x, y });
    }
  }
  const mixed = shuffled(deck, rand);
  cells.forEach((cell, i) => {
    const d = mixed[i];
    cards[cardKey(cell.x, cell.y)] = { ...d, faceUp: false };
  });
  return cards;
}

/** Build a fresh running/lobby state for the given player ids (in join order). */
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
    const shipPos = 4;
    players[id] = { id, edge, shipPos, order, score: 0 };
    const ship = shipCellFor(edge, shipPos);
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
    boardSizeX: BOARD_SIZE,
    boardSizeY: BOARD_SIZE,
    status: 'lobby',
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
