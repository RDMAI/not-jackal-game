import { validateConfig } from '../core/setup';
import type {
  Card,
  GameConfig,
  GameState,
  GameStatus,
  LastMove,
  Piece,
  Player,
  RoomDoc,
} from '../core/types';
import { ROOM_VERSION } from '../core/types';

export type NormalizeResult =
  | { ok: true; room: RoomDoc }
  | { ok: false; reason: string };

function fail(reason: string): NormalizeResult {
  return { ok: false, reason };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Validate an RTDB room document and apply only the defaults Firebase itself
 * forces on us (omitted nulls, plus fields that older rooms may lack).
 * Pure: no Firebase import, no mutation of `raw`.
 */
export function normalizeRoomDoc(raw: unknown): NormalizeResult {
  if (!isObject(raw)) return fail('room document must be an object');
  if (raw.version !== ROOM_VERSION) {
    return fail(`unsupported room version ${String(raw.version)}`);
  }

  if (!isObject(raw.config)) return fail('missing config');
  const configRaw = raw.config;
  if (!isObject(configRaw.deckCounts) || !Array.isArray(configRaw.edges)) {
    return fail('invalid config');
  }
  const configValidation = validateConfig(configRaw as unknown as GameConfig);
  if (!configValidation.ok) {
    return fail(`invalid config: ${configValidation.reason ?? 'unknown'}`);
  }
  const config = clone(configRaw) as unknown as GameConfig;

  if (!isObject(raw.state)) return fail('missing state');
  const stateRaw = raw.state;

  if (
    stateRaw.fieldSizeX !== config.fieldSizeX ||
    stateRaw.fieldSizeY !== config.fieldSizeY
  ) {
    return fail('state field size does not match config');
  }

  const status = stateRaw.status;
  if (status !== 'lobby' && status !== 'running' && status !== 'finished') {
    return fail('bad status');
  }
  const gameStatus: GameStatus = status;

  const playersRaw = stateRaw.players;
  if (!isObject(playersRaw) || Object.keys(playersRaw).length === 0) {
    return fail('missing or empty players');
  }
  const players: Record<string, Player> = {};
  for (const [id, value] of Object.entries(playersRaw)) {
    if (!isObject(value)) return fail(`bad player ${id}`);
    const joinedRaw = value.joined;
    if (joinedRaw !== undefined && typeof joinedRaw !== 'boolean') {
      return fail(`bad joined flag for ${id}`);
    }
    const joined = joinedRaw === undefined ? gameStatus !== 'lobby' : joinedRaw;
    players[id] = { ...(clone(value) as unknown as Player), joined };
  }

  const piecesRaw = stateRaw.pieces;
  if (!isObject(piecesRaw) || Object.keys(piecesRaw).length === 0) {
    return fail('missing or empty pieces');
  }
  const pieces: Record<string, Piece> = {};
  for (const [id, value] of Object.entries(piecesRaw)) {
    if (!isObject(value)) return fail(`bad piece ${id}`);
    pieces[id] = clone(value) as unknown as Piece;
  }

  const cardsRaw = stateRaw.cards;
  if (!isObject(cardsRaw) || Object.keys(cardsRaw).length === 0) {
    return fail('missing or empty cards');
  }
  const cards: Record<string, Card> = {};
  for (const [id, value] of Object.entries(cardsRaw)) {
    if (!isObject(value)) return fail(`bad card ${id}`);
    const coinsRaw = value.coinsOnGround;
    if (coinsRaw !== undefined && !isFiniteNumber(coinsRaw)) {
      return fail(`bad coinsOnGround at ${id}`);
    }
    cards[id] = {
      ...(clone(value) as unknown as Card),
      coinsOnGround: coinsRaw === undefined ? 0 : coinsRaw,
    };
  }

  const totalCoins = stateRaw.totalCoins;
  if (!isFiniteNumber(totalCoins)) return fail('bad totalCoins');
  const maxPlayers = stateRaw.maxPlayers;
  if (!isFiniteNumber(maxPlayers)) return fail('bad maxPlayers');
  const moved = stateRaw.moved;
  if (typeof moved !== 'boolean') return fail('bad moved');
  const currentTurn = stateRaw.currentTurn;
  if (typeof currentTurn !== 'string') return fail('bad currentTurn');

  const turnsPassedRaw = stateRaw.turnsPassed;
  if (turnsPassedRaw !== undefined && !isFiniteNumber(turnsPassedRaw)) {
    return fail('bad turnsPassed');
  }
  const turnsPassed = turnsPassedRaw === undefined ? 0 : turnsPassedRaw;

  const pendingRaw = stateRaw.pendingArrow;
  if (pendingRaw !== undefined && pendingRaw !== null && !isObject(pendingRaw)) {
    return fail('bad pendingArrow');
  }
  const pendingArrow =
    pendingRaw === undefined || pendingRaw === null
      ? null
      : (clone(pendingRaw) as GameState['pendingArrow']);

  const lastMoveRaw = stateRaw.lastMove;
  if (lastMoveRaw !== undefined && lastMoveRaw !== null && !isObject(lastMoveRaw)) {
    return fail('bad lastMove');
  }
  const lastMove =
    lastMoveRaw === undefined || lastMoveRaw === null
      ? null
      : (clone(lastMoveRaw) as unknown as LastMove);

  const winnerRaw = stateRaw.winner;
  let winner: string | null;
  if (winnerRaw === undefined || winnerRaw === null) {
    winner = null;
  } else if (winnerRaw === 'tie') {
    winner = 'tie';
  } else if (
    typeof winnerRaw === 'string' &&
    Object.prototype.hasOwnProperty.call(players, winnerRaw)
  ) {
    winner = winnerRaw;
  } else {
    return fail('bad winner');
  }

  const state: GameState = {
    fieldSizeX: config.fieldSizeX,
    fieldSizeY: config.fieldSizeY,
    status: gameStatus,
    currentTurn,
    totalCoins,
    maxPlayers,
    moved,
    pendingArrow,
    players,
    pieces,
    cards,
    turnsPassed,
    lastMove,
    winner,
  };

  return { ok: true, room: { version: ROOM_VERSION, config, state } };
}
