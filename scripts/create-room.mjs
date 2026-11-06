#!/usr/bin/env node
// Generate one room document for manual merge into an exported Firebase JSON.
// Plain Node.js ESM: no TypeScript build step and no extra dependencies.
//
// The default config/deck constants below must stay in sync with
// src/core/setup.ts and src/core/types.ts.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOM_VERSION = 1;
const FIELD_SIZE = 5;
const PIECES_PER_PLAYER = 3;
const CHEST_COINS = 3;
const MIN_FIELD = 3;
const MAX_FIELD = 9;

const CARD_TYPES = [
  'empty',
  'arrow_0_4',
  'arrow_1_5',
  'arrow_1_3_5_7',
  'chest_3',
  'trap_2',
  'trap_3',
];
const EDGES = ['north', 'south', 'east', 'west'];
const INVALID_ROOM_ID_CHARS = /[/.#$[\]]/;

function fail(message) {
  console.error(`create-room: ${message}`);
  process.exit(1);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRoomId(id) {
  const trimmed = id.trim();
  return trimmed.length > 0 && !INVALID_ROOM_ID_CHARS.test(trimmed);
}

function defaultDeckCounts() {
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

function defaultConfig() {
  return {
    fieldSizeX: FIELD_SIZE,
    fieldSizeY: FIELD_SIZE,
    deckCounts: defaultDeckCounts(),
    edges: ['north', 'south'],
  };
}

/** Standalone mirror of validateConfig in src/core/setup.ts. */
function validateConfig(config) {
  if (!isObject(config)) return { ok: false, reason: 'config must be an object' };
  const fx = config.fieldSizeX;
  const fy = config.fieldSizeY;
  if (
    !Number.isInteger(fx) ||
    !Number.isInteger(fy) ||
    fx < MIN_FIELD ||
    fx > MAX_FIELD ||
    fy < MIN_FIELD ||
    fy > MAX_FIELD
  ) {
    return { ok: false, reason: `field size must be ${MIN_FIELD}–${MAX_FIELD}` };
  }

  if (!isObject(config.deckCounts)) {
    return { ok: false, reason: 'deckCounts must be an object' };
  }
  const expected = fx * fy;
  let assigned = 0;
  for (const type of CARD_TYPES) {
    const count = config.deckCounts[type];
    if (!Number.isInteger(count) || count < 0) {
      return { ok: false, reason: `bad count for ${type}` };
    }
    assigned += count;
  }
  if (assigned !== expected) {
    return { ok: false, reason: `${assigned}/${expected} cards assigned` };
  }

  if (!Array.isArray(config.edges)) {
    return { ok: false, reason: 'edges must be an array' };
  }
  if (config.edges.length < 2 || config.edges.length > 4) {
    return { ok: false, reason: 'select 2–4 sides' };
  }
  const seen = new Set();
  for (const edge of config.edges) {
    if (!EDGES.includes(edge)) return { ok: false, reason: `bad edge ${String(edge)}` };
    if (seen.has(edge)) return { ok: false, reason: `duplicate edge ${edge}` };
    seen.add(edge);
  }

  return { ok: true };
}

function shipCellFor(edge, shipPos, fieldSizeX, fieldSizeY) {
  if (edge === 'north') return { x: shipPos, y: -1 };
  if (edge === 'south') return { x: shipPos, y: fieldSizeY };
  if (edge === 'west') return { x: -1, y: shipPos };
  return { x: fieldSizeX, y: shipPos };
}

function shuffled(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildDeckFromCounts(counts) {
  const deck = [];
  for (const type of CARD_TYPES) {
    const count = counts[type] ?? 0;
    for (let i = 0; i < count; i++) deck.push(type);
  }
  return deck;
}

function generateCards(sizeX, sizeY, deck) {
  const cards = {};
  const cells = [];
  for (let y = 0; y < sizeY; y++) {
    for (let x = 0; x < sizeX; x++) cells.push({ x, y });
  }
  const mixed = shuffled(deck);
  cells.forEach((cell, index) => {
    cards[`${cell.x}_${cell.y}`] = {
      type: mixed[index % mixed.length],
      faceUp: false,
      coinsOnGround: 0,
    };
  });
  return cards;
}

function createLobbyState(config) {
  const validation = validateConfig(config);
  if (!validation.ok) throw new Error(validation.reason);

  const fieldSizeX = config.fieldSizeX;
  const fieldSizeY = config.fieldSizeY;
  const players = {};
  const pieces = {};

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
  return {
    fieldSizeX,
    fieldSizeY,
    status: 'lobby',
    currentTurn: '',
    totalCoins: (config.deckCounts.chest_3 ?? 0) * CHEST_COINS,
    maxPlayers: config.edges.length,
    moved: false,
    pendingArrow: null,
    players,
    pieces,
    cards: generateCards(fieldSizeX, fieldSizeY, deck),
    turnsPassed: 0,
    lastMove: null,
    winner: null,
  };
}

function createRoomDoc(config) {
  return { version: ROOM_VERSION, config, state: createLobbyState(config) };
}

function parseArgs(argv) {
  const opts = { id: undefined, config: undefined, out: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--id') {
      if (argv[i + 1] === undefined) fail('--id requires a value');
      opts.id = argv[++i];
    } else if (arg === '--config') {
      if (argv[i + 1] === undefined) fail('--config requires a path');
      opts.config = argv[++i];
    } else if (arg === '--out') {
      if (argv[i + 1] === undefined) fail('--out requires a path');
      opts.out = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/create-room.mjs [--id <roomId>] [--config <config.json>] [--out <file>]',
      );
      process.exit(0);
    } else {
      fail(`unknown option ${arg}`);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const roomId = (opts.id === undefined ? randomUUID() : opts.id).trim();
  if (!isValidRoomId(roomId)) fail(`invalid room id "${roomId}"`);

  let config = defaultConfig();
  if (opts.config !== undefined) {
    let text;
    try {
      text = readFileSync(opts.config, 'utf8');
    } catch (error) {
      fail(`cannot read config ${opts.config}: ${error.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      fail(`invalid JSON in ${opts.config}: ${error.message}`);
    }
    const validation = validateConfig(parsed);
    if (!validation.ok) fail(`invalid config: ${validation.reason}`);
    config = parsed;
  }

  let room;
  try {
    room = createRoomDoc(config);
  } catch (error) {
    fail(error.message);
  }

  const output = `${JSON.stringify({ [roomId]: room }, null, 2)}\n`;
  if (opts.out !== undefined) {
    try {
      writeFileSync(opts.out, output, 'utf8');
    } catch (error) {
      fail(`cannot write ${opts.out}: ${error.message}`);
    }
  } else {
    process.stdout.write(output);
  }
}

main();
