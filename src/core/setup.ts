import type { Card, CardType, Edge, GameConfig, GameState } from './types';
import { CARD_TYPES, cardKey } from './types';

export const FIELD_SIZE = 5;
export const PIECES_PER_PLAYER = 3;
export const CHEST_COINS = 3;
export const CHEST_COUNT = 4;
export const TOTAL_COINS = CHEST_COUNT * CHEST_COINS; // 12
export const MIN_FIELD = 3;
export const MAX_FIELD = 9;

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

/** Default per-type counts matching the 5x5 test deck. */
export function defaultDeckCounts(): Record<CardType, number> {
  return {
    empty: 11,
    arrow_0_4: 2,
    arrow_1_5: 2,
    arrow_1_3_5_7: 1,
    chest_3: 4,
    trap_2: 3,
    trap_3: 2,
  };
}

/** Expand per-type counts into a flat deck array. */
export function buildDeckFromCounts(counts: Record<CardType, number>): CardType[] {
  const deck: CardType[] = [];
  for (const t of CARD_TYPES) {
    const n = counts[t] ?? 0;
    for (let i = 0; i < n; i++) deck.push(t);
  }
  return deck;
}

export function defaultGameConfig(): GameConfig {
  return {
    fieldSizeX: FIELD_SIZE,
    fieldSizeY: FIELD_SIZE,
    deckCounts: defaultDeckCounts(),
    edges: ['north', 'south'],
  };
}

export function validateConfig(c: GameConfig): import('./types').ConfigValidation {
  const fx = c.fieldSizeX;
  const fy = c.fieldSizeY;
  if (!Number.isInteger(fx) || !Number.isInteger(fy) || fx < MIN_FIELD || fx > MAX_FIELD || fy < MIN_FIELD || fy > MAX_FIELD) {
    return { ok: false, reason: `field size must be ${MIN_FIELD}–${MAX_FIELD} (got ${String(fx)}x${String(fy)})` };
  }
  const expected = fx * fy;
  let assigned = 0;
  for (const t of CARD_TYPES) {
    const n = c.deckCounts[t];
    if (!Number.isInteger(n) || (n as number) < 0) {
      return { ok: false, reason: `bad count for ${t}`, assigned, expected };
    }
    assigned += n as number;
  }
  if (assigned !== expected) {
    return { ok: false, reason: `${assigned}/${expected} cards assigned`, assigned, expected };
  }
  const edges = c.edges ?? [];
  if (edges.length < 2) {
    return { ok: false, reason: 'select at least 2 sides', assigned, expected };
  }
  const seen = new Set<string>();
  for (const e of edges) {
    if (e !== 'north' && e !== 'south' && e !== 'east' && e !== 'west') {
      return { ok: false, reason: `bad edge ${String(e)}`, assigned, expected };
    }
    if (seen.has(e)) {
      return { ok: false, reason: `duplicate edge ${e}`, assigned, expected };
    }
    seen.add(e);
  }
  return { ok: true, assigned, expected };
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

/** Land cells (x,y in 0..sizeX-1, 0..sizeY-1). Deck shuffled, all face-down. */
export function generateCards(
  rand: () => number = Math.random,
  sizeX: number = FIELD_SIZE,
  sizeY: number = FIELD_SIZE,
  deck?: CardType[],
): Record<string, Card> {
  const fullDeck = deck ?? buildTestDeck();
  const cards: Record<string, Card> = {};
  // Deterministic cell order, shuffled deck assignment.
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) {
      cells.push({ x, y });
    }
  }
  const mixed = shuffled(fullDeck, rand);
  cells.forEach((cell, i) => {
    cards[cardKey(cell.x, cell.y)] = {
      type: mixed[i % mixed.length],
      faceUp: false,
      coinsOnGround: 0,
    };
  });
  return cards;
}

export interface CreateOpts {
  fieldSizeX?: number;
  fieldSizeY?: number;
  deck?: CardType[];
  deckCounts?: Record<CardType, number>;
  edges?: Edge[];
}

/** Build a fresh running state for the given player ids (in join order). */
export function createInitialState(
  playerIds: string[],
  maxPlayers: number = playerIds.length,
  rand: () => number = Math.random,
  opts: CreateOpts = {},
): GameState {
  const fieldSizeX = opts.fieldSizeX ?? FIELD_SIZE;
  const fieldSizeY = opts.fieldSizeY ?? FIELD_SIZE;
  const deck = opts.deck ?? (opts.deckCounts ? buildDeckFromCounts(opts.deckCounts) : buildTestDeck());
  const cards = generateCards(rand, fieldSizeX, fieldSizeY, deck);
  const players: GameState['players'] = {};
  const pieces: GameState['pieces'] = {};

  const totalCoins = deck.filter((t) => t.startsWith('chest_')).length * CHEST_COINS;

  playerIds.forEach((id, order) => {
    const edge = (opts.edges && opts.edges[order]) ?? edgeForOrder(order);
    const along = edge === 'north' || edge === 'south' ? fieldSizeX : fieldSizeY;
    const shipPos = Math.floor(along / 2);
    players[id] = { id, edge, shipPos, order, score: 0 };
    const ship = shipCellFor(edge, shipPos, fieldSizeX, fieldSizeY);
    for (let i = 0; i < PIECES_PER_PLAYER; i++) {
      const pid = `${id}_${i}`;
      pieces[pid] = {
        id: pid,
        playerId: id,
        x: ship.x,
        y: ship.y,
        onShip: true,
        carrying: false,
        trapStep: 0,
      };
    }
  });

  return {
    fieldSizeX,
    fieldSizeY,
    status: 'running',
    currentTurn: playerIds[0] ?? '',
    totalCoins,
    maxPlayers,
    moved: false,
    pendingArrow: null,
    players,
    pieces,
    cards,
    lastMove: null,
    winner: null,
  };
}

/** Build state directly from a validated GameConfig. Player ids p1..pn. */
export function createStateFromConfig(config: GameConfig, rand: () => number = Math.random): GameState {
  const ids = config.edges.map((_, i) => `p${i + 1}`);
  return createInitialState(ids, ids.length, rand, {
    fieldSizeX: config.fieldSizeX,
    fieldSizeY: config.fieldSizeY,
    deckCounts: config.deckCounts,
    edges: config.edges,
  });
}
