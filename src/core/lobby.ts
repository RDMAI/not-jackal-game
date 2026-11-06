import type { Card, Edge, GameConfig, GameState } from './types';
import { CARD_TYPES, ROOM_VERSION, cardKey } from './types';
import type { RoomDoc } from './types';
import {
  CHEST_COINS,
  MAX_FIELD,
  MIN_FIELD,
  PIECES_PER_PLAYER,
  buildDeckFromCounts,
  generateCards,
  shipCellFor,
  validateConfig,
} from './setup';
import type { Validation } from './rules';

export type LobbyResult<T> =
  | { ok: true; state: T }
  | { ok: false; reason: string };

const EDGES: Edge[] = ['north', 'south', 'east', 'west'];

function fail<T>(reason: string): LobbyResult<T> {
  return { ok: false, reason };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidEdge(edge: unknown): edge is Edge {
  return typeof edge === 'string' && (EDGES as string[]).includes(edge);
}

/** `x_y` card key -> cell, only when it is the canonical key for that cell. */
function parseCellKey(key: string, fieldSizeX: number, fieldSizeY: number): { x: number; y: number } | null {
  const match = /^(\d+)_(\d+)$/.exec(key);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= fieldSizeX || y >= fieldSizeY) return null;
  if (cardKey(x, y) !== key) return null;
  return { x, y };
}

/** Build a fresh lobby state. Player ids are p1..pN in config.edges order. */
export function createLobbyState(config: GameConfig, rand: () => number = Math.random): GameState {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(validation.reason ?? 'invalid config');
  }

  const fieldSizeX = config.fieldSizeX;
  const fieldSizeY = config.fieldSizeY;
  const players: GameState['players'] = {};
  const pieces: GameState['pieces'] = {};

  config.edges.forEach((edge, order) => {
    const id = `p${order + 1}`;
    const along = edge === 'north' || edge === 'south' ? fieldSizeX : fieldSizeY;
    const shipPos = Math.floor(along / 2);
    players[id] = { id, edge, shipPos, order, score: 0, joined: false };

    const ship = shipCellFor(edge, shipPos, fieldSizeX, fieldSizeY);
    for (let i = 0; i < PIECES_PER_PLAYER; i++) {
      const pieceId = `${id}_${i}`;
      pieces[pieceId] = {
        id: pieceId,
        playerId: id,
        x: ship.x,
        y: ship.y,
        onShip: true,
        carrying: false,
        trapStep: 0,
      };
    }
  });

  const deck = buildDeckFromCounts(config.deckCounts);
  const cards = generateCards(rand, fieldSizeX, fieldSizeY, deck);
  const totalCoins = (config.deckCounts.chest_3 ?? 0) * CHEST_COINS;

  return {
    fieldSizeX,
    fieldSizeY,
    status: 'lobby',
    currentTurn: '',
    totalCoins,
    maxPlayers: config.edges.length,
    moved: false,
    pendingArrow: null,
    players,
    pieces,
    cards,
    turnsPassed: 0,
    lastMove: null,
    winner: null,
  };
}

export function createRoomDoc(config: GameConfig, rand: () => number = Math.random): RoomDoc {
  return { version: ROOM_VERSION, config, state: createLobbyState(config, rand) };
}

/** Claim one open player slot. Returns a copy; never mutates the input state. */
export function claimPlayer(state: GameState, playerId: string): LobbyResult<GameState> {
  if (state.status !== 'lobby') return fail('room is not in the lobby');
  if (!state.players || Object.keys(state.players).length === 0) {
    return fail('room has no players');
  }
  const player = state.players[playerId];
  if (!player) return fail(`unknown player ${playerId}`);
  if (player.joined) return fail(`${playerId} is already claimed`);

  return {
    ok: true,
    state: {
      ...state,
      players: {
        ...state.players,
        [playerId]: { ...player, joined: true },
      },
    },
  };
}

/** Comprehensive pre-start validation. Intentionally stricter than the loader. */
export function validateStart(state: GameState, byPlayerId: string): Validation {
  if (state.status !== 'lobby') return { ok: false, reason: 'room is not in the lobby' };
  if (byPlayerId !== 'p1') return { ok: false, reason: 'only p1 can start the game' };
  if (state.currentTurn !== '') return { ok: false, reason: 'currentTurn must be empty in the lobby' };
  if (state.moved !== false) return { ok: false, reason: 'moved must be false in the lobby' };
  if (state.pendingArrow != null) return { ok: false, reason: 'pendingArrow must be empty in the lobby' };
  if (state.lastMove != null) return { ok: false, reason: 'lastMove must be empty in the lobby' };
  if (state.winner != null) return { ok: false, reason: 'winner must be empty in the lobby' };
  if (state.turnsPassed !== 0) return { ok: false, reason: 'turnsPassed must be 0 in the lobby' };

  const fx = state.fieldSizeX;
  const fy = state.fieldSizeY;
  if (
    !Number.isInteger(fx) ||
    !Number.isInteger(fy) ||
    fx < MIN_FIELD ||
    fx > MAX_FIELD ||
    fy < MIN_FIELD ||
    fy > MAX_FIELD
  ) {
    return { ok: false, reason: 'invalid field size' };
  }

  if (!state.players || Object.keys(state.players).length === 0) {
    return { ok: false, reason: 'room has no players' };
  }
  const playerEntries = Object.entries(state.players);
  const playerCount = playerEntries.length;
  if (state.maxPlayers !== playerCount) {
    return { ok: false, reason: 'maxPlayers does not match the player count' };
  }

  const orders = new Set<number>();
  for (const [key, player] of playerEntries) {
    if (!isObject(player)) return { ok: false, reason: `bad player ${key}` };
    if (player.id !== key) return { ok: false, reason: `player key/id mismatch for ${key}` };
    const edge = player.edge;
    if (!isValidEdge(edge)) return { ok: false, reason: `bad edge for ${key}` };
    const order = player.order;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order >= playerCount) {
      return { ok: false, reason: `bad order for ${key}` };
    }
    if (orders.has(order)) return { ok: false, reason: `duplicate order ${order}` };
    orders.add(order);

    const along = edge === 'north' || edge === 'south' ? fx : fy;
    const shipPos = player.shipPos;
    if (
      typeof shipPos !== 'number' ||
      !Number.isInteger(shipPos) ||
      shipPos < 0 ||
      shipPos >= along
    ) {
      return { ok: false, reason: `bad ship position for ${key}` };
    }
    const score = player.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      return { ok: false, reason: `bad score for ${key}` };
    }
    if (player.joined !== true) return { ok: false, reason: `${key} has not claimed a slot` };
  }
  if (orders.size !== playerCount) return { ok: false, reason: 'player order is not complete' };

  if (!state.cards || Object.keys(state.cards).length !== fx * fy) {
    return { ok: false, reason: 'card count does not match the field' };
  }
  for (const [key, card] of Object.entries(state.cards)) {
    if (!isObject(card)) return { ok: false, reason: `bad card ${key}` };
    if (!parseCellKey(key, fx, fy)) return { ok: false, reason: `card key ${key} is not a field cell` };
    if (!CARD_TYPES.includes(card.type as Card['type'])) {
      return { ok: false, reason: `bad card type at ${key}` };
    }
    const faceUp = card.faceUp;
    if (typeof faceUp !== 'boolean') return { ok: false, reason: `bad faceUp at ${key}` };
    const coinsOnGround = card.coinsOnGround;
    if (
      typeof coinsOnGround !== 'number' ||
      !Number.isFinite(coinsOnGround) ||
      coinsOnGround < 0
    ) {
      return { ok: false, reason: `bad coinsOnGround at ${key}` };
    }
  }

  if (!state.pieces || Object.keys(state.pieces).length !== PIECES_PER_PLAYER * playerCount) {
    return { ok: false, reason: 'piece count does not match the player count' };
  }
  for (const [key, piece] of Object.entries(state.pieces)) {
    if (!isObject(piece)) return { ok: false, reason: `bad piece ${key}` };
    if (piece.id !== key) return { ok: false, reason: `piece key/id mismatch for ${key}` };
    const owner = piece.playerId;
    if (typeof owner !== 'string' || !state.players[owner]) {
      return { ok: false, reason: `piece ${key} has an unknown owner` };
    }
    if (piece.onShip !== true) return { ok: false, reason: `piece ${key} is not on its ship` };
    if (piece.carrying !== false) return { ok: false, reason: `piece ${key} is carrying a coin` };
    if (piece.trapStep !== 0) return { ok: false, reason: `piece ${key} is on a trap` };
  }
  for (const player of Object.values(state.players)) {
    const ship = shipCellFor(player.edge, player.shipPos, fx, fy);
    for (let i = 0; i < PIECES_PER_PLAYER; i++) {
      const pieceId = `${player.id}_${i}`;
      const piece = state.pieces[pieceId];
      if (!piece) return { ok: false, reason: `missing piece ${pieceId}` };
      if (piece.playerId !== player.id) return { ok: false, reason: `piece ${pieceId} has the wrong owner` };
      if (piece.x !== ship.x || piece.y !== ship.y) {
        return { ok: false, reason: `piece ${pieceId} is not at its ship` };
      }
    }
  }

  if (!Number.isInteger(state.totalCoins) || state.totalCoins < 0) {
    return { ok: false, reason: 'bad totalCoins' };
  }

  return { ok: true };
}

/** Validate and move a lobby into running. Cards and pieces are preserved. */
export function startLobby(state: GameState, byPlayerId: string): LobbyResult<GameState> {
  const validation = validateStart(state, byPlayerId);
  if (!validation.ok) return fail(validation.reason ?? 'cannot start the game');

  const first = Object.values(state.players).sort((a, b) => a.order - b.order)[0];
  if (!first) return fail('room has no players');

  return {
    ok: true,
    state: {
      ...state,
      status: 'running',
      currentTurn: first.id,
      moved: false,
      pendingArrow: null,
      lastMove: null,
      winner: null,
      turnsPassed: 0,
    },
  };
}
