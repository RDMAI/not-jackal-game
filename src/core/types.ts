// Shared types. No Phaser / Firebase imports here so rules stay pure
// and can move to a server later.

export type Vec = { x: number; y: number };

export type Edge = 'north' | 'south' | 'east' | 'west';

export type CardType = 'empty' | 'arrow' | 'chest' | 'trap';

export interface Card {
  type: CardType;
  faceUp: boolean;
  arrowDir?: Vec;
  coinsLeft?: number;
  coinsOnGround?: number;
  trapCost?: number;
}

export interface Piece {
  id: string;
  playerId: string;
  x: number;
  y: number;
  onShip: boolean;
  carrying: boolean;
  stuck: number;
}

export interface Player {
  id: string;
  edge: Edge;
  /** index along its edge: x for north/south, y for east/west (1..7) */
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
  boardSizeX: number;
  boardSizeY: number;
  status: GameStatus;
  currentTurn: string;
  totalCoins: number;
  maxPlayers: number;
  /** true once current player used their movePiece/moveShip this turn */
  moved: boolean;
  players: Record<string, Player>;
  pieces: Record<string, Piece>;
  /** key `${x}_${y}`, only non-sea cells */
  cards: Record<string, Card>;
  lastMove?: LastMove | null;
  winner?: string | null;
}

export type Action =
  | { kind: 'movePiece'; pieceId: string; to: Vec }
  | { kind: 'moveShip'; dir: -1 | 1 }
  | { kind: 'grab'; pieceId: string }
  | { kind: 'drop'; pieceId: string }
  | { kind: 'endTurn' };

export function cardKey(x: number, y: number): string {
  return `${x}_${y}`;
}
