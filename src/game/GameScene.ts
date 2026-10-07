import Phaser from 'phaser';
import { isSea, shipCellOf } from '../core/rules';
import type { Action, GameState } from '../core/types';
import { cardKey } from '../core/types';

const CELL = 80;
const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c039];

function arrowEmoji(dx: number, dy: number): string {
  if (dx === 0 && dy === -1) return '↑';
  if (dx === 1 && dy === -1) return '↗';
  if (dx === 1 && dy === 0) return '→';
  if (dx === 1 && dy === 1) return '↘';
  if (dx === 0 && dy === 1) return '↓';
  if (dx === -1 && dy === 1) return '↙';
  if (dx === -1 && dy === 0) return '←';
  return '↖';
}

export class GameScene extends Phaser.Scene {
  private state: GameState | null = null;
  private myId = '';
  private selectedPiece: string | null = null;
  private shipSelected = false;
  /** called by main.ts to validate + submit */
  public onAction: (a: Action) => void = () => {};

  constructor() {
    super('game');
  }

  setMyId(id: string): void {
    this.myId = id;
    this.render();
  }

  setState(s: GameState | null): void {
    this.state = s;
    // Clear stale selection if piece moved away.
    if (s && this.selectedPiece && !s.pieces[this.selectedPiece]) {
      this.selectedPiece = null;
    }
    this.render();
  }

  getState(): GameState | null {
    return this.state;
  }

  getSelectedPiece(): string | null {
    return this.selectedPiece;
  }

  clearSelection(): void {
    this.selectedPiece = null;
    this.shipSelected = false;
    this.render();
  }

  private cellColor(x: number, y: number): number {
    const s = this.state;
    if (!s) return 0x222222;
    if (isSea(s, x, y)) return 0x123a6d;
    const card = s.cards[cardKey(x, y)];
    if (!card || !card.faceUp) return 0x1d3a5f; // face-down
    if (card.type === 'empty') return 0x3f7d4e;
    if (card.type === 'arrow') return 0x8a7d1e;
    if (card.type === 'chest') return 0xa56a1a;
    return 0x8a2a2a; // trap
  }

  private render(): void {
    if (!this.scene.isActive()) return;
    this.children.removeAll(true);
    const s = this.state;
    if (!s) {
      this.add.text(20, 20, 'Join a room…', { color: '#ffffff' });
      return;
    }

    for (let y = 0; y < s.boardSizeY; y++) {
      for (let x = 0; x < s.boardSizeX; x++) {
        const cx = x * CELL + CELL / 2;
        const cy = y * CELL + CELL / 2;
        const rect = this.add.rectangle(cx, cy, CELL - 2, CELL - 2, this.cellColor(x, y));
        rect.setStrokeStyle(1, 0x000000);
        rect.setInteractive({ useHandCursor: true });
        rect.setData('x', x);
        rect.setData('y', y);
        rect.on('pointerdown', () => this.handleCellClick(x, y));

        // Highlight selected neighbours green.
        if (this.selectedPiece) {
          const p = s.pieces[this.selectedPiece];
          if (p && Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1 && !(p.x === x && p.y === y)) {
            rect.setStrokeStyle(3, 0x00ff00);
          }
        }
        // Highlight ship move targets.
        if (this.shipSelected) {
          const me = s.players[this.myId];
          if (me) {
            const targets =
              me.edge === 'north' || me.edge === 'south'
                ? [
                    { x: me.shipPos - 1, y: me.edge === 'north' ? 0 : s.boardSizeY - 1 },
                    { x: me.shipPos + 1, y: me.edge === 'north' ? 0 : s.boardSizeY - 1 },
                  ]
                : [
                    { x: me.edge === 'west' ? 0 : s.boardSizeX - 1, y: me.shipPos - 1 },
                    { x: me.edge === 'west' ? 0 : s.boardSizeX - 1, y: me.shipPos + 1 },
                  ];
            for (const t of targets) {
              if (t.x === x && t.y === y) rect.setStrokeStyle(3, 0x00ff00);
            }
          }
        }

        // Cell glyph.
        let glyph = '';
        if (isSea(s, x, y)) {
          // Mark ship cells.
          for (const pid of Object.keys(s.players)) {
            const sc = shipCellOf(s, pid);
            if (sc && sc.x === x && sc.y === y) glyph = 'S';
          }
          if (!glyph) glyph = '~';
        } else {
          const card = s.cards[cardKey(x, y)];
          if (!card) glyph = '';
          else if (!card.faceUp) glyph = '?';
          else if (card.type === 'arrow' && card.arrowDir) glyph = arrowEmoji(card.arrowDir.x, card.arrowDir.y);
          else if (card.type === 'chest') {
            const n = (card.coinsLeft ?? 0) + (card.coinsOnGround ?? 0);
            glyph = n > 0 ? `🪙${n}` : '▢';
          } else if (card.type === 'trap') glyph = '💀';
          else glyph = '';
        }
        if (glyph) {
          this.add.text(cx, cy - 14, glyph, { color: '#ffffff', fontSize: '20px' }).setOrigin(0.5);
        }
      }
    }

    // Pieces as circles.
    for (const piece of Object.values(s.pieces)) {
      const owner = s.players[piece.playerId];
      const color = PLAYER_COLORS[(owner?.order ?? 0) % PLAYER_COLORS.length];
      const cx = piece.x * CELL + CELL / 2;
      const cy = piece.y * CELL + CELL / 2;
      // Stack offsets so multiple pieces on one cell are visible.
      const siblings = Object.values(s.pieces).filter((q) => q.x === piece.x && q.y === piece.y);
      const idx = siblings.findIndex((q) => q.id === piece.id);
      const ox = (idx - (siblings.length - 1) / 2) * 18;
      const circle = this.add.circle(cx + ox, cy + 12, 12, color);
      circle.setStrokeStyle(piece.id === this.selectedPiece ? 3 : 1, piece.id === this.selectedPiece ? 0x00ff00 : 0x000000);
      if (piece.playerId === this.myId) {
        circle.setInteractive({ useHandCursor: true });
        circle.on('pointerdown', () => this.handlePieceClick(piece.id));
      }
      const label = piece.carrying ? '●' : piece.stuck > 0 ? `✕${piece.stuck}` : '○';
      this.add.text(cx + ox, cy + 12, label, { color: '#ffffff', fontSize: '14px' }).setOrigin(0.5);
    }
  }

  private handlePieceClick(pieceId: string): void {
    const s = this.state;
    if (!s) return;
    const piece = s.pieces[pieceId];
    if (!piece || piece.playerId !== this.myId) return;
    // Clicking own ship-board piece selects it; clicking again deselects.
    this.selectedPiece = this.selectedPiece === pieceId ? null : pieceId;
    this.shipSelected = false;
    this.render();
  }

  private handleCellClick(x: number, y: number): void {
    const s = this.state;
    if (!s) return;

    // 1. If a piece is selected and dest clicked -> try movePiece.
    if (this.selectedPiece) {
      const piece = s.pieces[this.selectedPiece];
      if (piece && (piece.x !== x || piece.y !== y)) {
        const pid = this.selectedPiece;
        this.selectedPiece = null;
        this.render();
        this.onAction({ kind: 'movePiece', pieceId: pid, to: { x, y } });
        return;
      }
    }

    // 2. If ship target clicked while ship selected -> moveShip.
    if (this.shipSelected) {
      const me = s.players[this.myId];
      if (me) {
        const sc = shipCellOf(s, this.myId);
        if (sc) {
          const dir =
            me.edge === 'north' || me.edge === 'south'
              ? x - me.shipPos
              : y - me.shipPos;
          if ((dir === 1 || dir === -1) && Math.abs(x - sc.x) + Math.abs(y - sc.y) <= 2) {
            this.shipSelected = false;
            this.render();
            this.onAction({ kind: 'moveShip', dir: dir as -1 | 1 });
            return;
          }
        }
        this.shipSelected = false;
        this.render();
        return;
      }
    }

    // 3. Clicking own piece stack on this cell selects one of mine.
    const mine = Object.values(s.pieces).find(
      (p) => p.playerId === this.myId && p.x === x && p.y === y,
    );
    if (mine) {
      this.selectedPiece = mine.id;
      this.shipSelected = false;
      this.render();
      return;
    }

    // 4. Clicking own ship cell arms ship move.
    const sc = shipCellOf(s, this.myId);
    if (sc && sc.x === x && sc.y === y) {
      this.shipSelected = true;
      this.selectedPiece = null;
      this.render();
    }
  }
}
