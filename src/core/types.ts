// Shared types. No Phaser / Firebase imports here so rules stay pure
// and can move to a server later.

export type Vec = { x: number; y: number };

export type Edge = 'north' | 'south' | 'east' | 'west';

export type CardType =
  | 'empty'
  | 'arrow_0_4'
  | 'arrow_1_5'
  | 'arrow_1_3_5_7'
  | 'chest_3'
  | 'trap_2'
  | 'trap_3';

export interface Card {
  type: CardType;
  faceUp: boolean;
  coinsOnGround: number;
}

export interface Piece {
  id: string;
  playerId: string;
  x: number;
  y: number;
  onShip: boolean;
  carrying: boolean;
  /** 0 = free, 1..N = position on current trap card */
  trapStep: number;
}

export interface Player {
  id: string;
  edge: Edge;
  /** index along its edge: x for north/south, y for east/west (0..fieldSize-1) */
  shipPos: number;
  order: number;
  score: number;
}

export type GameStatus = 'lobby' | 'running' | 'finished';

export interface LastMove {
  by: string;
  action: string;
  at: number;
}

export interface GameState {
  fieldSizeX: number;
  fieldSizeY: number;
  status: GameStatus;
  currentTurn: string;
  totalCoins: number;
  maxPlayers: number;
  /** true once current player used their movePiece/moveShip this turn */
  moved: boolean;
  /** set when a piece lands on an arrow: must continue along exits same turn */
  pendingArrow: { pieceId: string } | null;
  players: Record<string, Player>;
  pieces: Record<string, Piece>;
  /** key `${x}_${y}`, field cells only (0..fieldSize-1) */
  cards: Record<string, Card>;
  lastMove?: LastMove | null;
  winner?: string | null;
}

export type Action =
  | { kind: 'movePiece'; pieceId: string; to: Vec }
  | { kind: 'moveShip'; dir: -1 | 1 }
  | { kind: 'grab'; pieceId: string }
  | { kind: 'drop'; pieceId: string }
  | { kind: 'advanceTrap'; pieceId: string }
  | { kind: 'endTurn' };

export const CARD_TYPES: CardType[] = [
  'empty',
  'arrow_0_4',
  'arrow_1_5',
  'arrow_1_3_5_7',
  'chest_3',
  'trap_2',
  'trap_3',
];

export interface GameConfig {
  fieldSizeX: number;
  fieldSizeY: number;
  deckCounts: Record<CardType, number>;
  edges: Edge[];
}

export interface ConfigValidation {
  ok: boolean;
  reason?: string;
  assigned?: number;
  expected?: number;
}

export function cardKey(x: number, y: number): string {
  return `${x}_${y}`;
}
