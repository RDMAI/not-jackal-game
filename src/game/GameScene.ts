import Phaser from 'phaser';
import { isSea, parseArrowExits, shipCellOf } from '../core/rules';
import type { Action, GameState } from '../core/types';
import { cardKey } from '../core/types';

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c039];

function arrowGlyph(type: string): string {
  if (type === 'arrow_1_5') return '↕';
  if (type === 'arrow_0_4') return '⤡';
  if (type === 'arrow_1_3_5_7') return '✛';
  return '?';
}

function arrowLabel(type: string): string {
  // Short digit label under the glyph, e.g. "1·5".
  if (!type.startsWith('arrow_')) return '';
  return type.slice('arrow_'.length).split('_').join('·');
}

export class GameScene extends Phaser.Scene {
  private state: GameState | null = null;
  private selected: { playerId: string; pieceId: string } | null = null;
  private shipSelectedPlayer: string | null = null;
  /** called by main.ts: (playerId, action) -> validate + apply */
  public onAction: (playerId: string, a: Action) => void = () => {};

  constructor() {
    super('game');
  }

  setState(s: GameState | null): void {
    this.state = s;
    // Clear stale selection if piece moved away.
    if (s && this.selected && !s.pieces[this.selected.pieceId]) {
      this.selected = null;
    }
    this.render();
  }

  getState(): GameState | null {
    return this.state;
  }

  getSelected(): { playerId: string; pieceId: string } | null {
    return this.selected;
  }

  clearSelection(): void {
    this.selected = null;
    this.shipSelectedPlayer = null;
    this.render();
  }

  private cellSize(): number {
    const s = this.state;
    if (!s) return 144;
    // Field plus surrounding sea ring.
    return Math.floor(720 / (Math.max(s.fieldSizeX, s.fieldSizeY) + 2));
  }

  private cellColor(x: number, y: number): number {
    const s = this.state;
    if (!s) return 0x222222;
    if (isSea(s, x, y)) return 0x123a6d;
    const card = s.cards[cardKey(x, y)];
    if (!card || !card.faceUp) return 0x1d3a5f; // face-down
    if (card.type === 'empty') return 0x3f7d4e;
    if (card.type.startsWith('arrow_')) return 0x8a7d1e;
    if (card.type.startsWith('chest_')) return 0xa56a1a;
    return 0x8a2a2a; // trap
  }

  /** Cells the selected piece may legally step to (neighbour + arrow exits). */
  private allowedTargets(): Set<string> {
    const out = new Set<string>();
    const s = this.state;
    if (!s || !this.selected) return out;
    const p = s.pieces[this.selected.pieceId];
    if (!p) return out;
    const cur = s.cards[cardKey(p.x, p.y)];
    let deltas: { x: number; y: number }[] | null = null;
    if (cur && cur.faceUp && cur.type.startsWith('arrow_') && !p.onShip) {
      deltas = parseArrowExits(cur.type);
    } else {
      deltas = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          deltas.push({ x: dx, y: dy });
        }
      }
    }
    for (const d of deltas) out.add(`${p.x + d.x}_${p.y + d.y}`);
    return out;
  }

  private render(): void {
    if (!this.scene.isActive()) return;
    this.children.removeAll(true);
    const s = this.state;
    if (!s) {
      this.add.text(20, 20, 'Starting…', { color: '#ffffff' });
      return;
    }
    const CELL = this.cellSize();
    const origin = CELL; // x=-1 maps to pixel 0

    for (let y = -1; y <= s.fieldSizeY; y++) {
      for (let x = -1; x <= s.fieldSizeX; x++) {
        const cx = origin + x * CELL + CELL / 2;
        const cy = origin + y * CELL + CELL / 2;
        const rect = this.add.rectangle(cx, cy, CELL - 2, CELL - 2, this.cellColor(x, y));
        rect.setStrokeStyle(1, 0x000000);
        rect.setInteractive({ useHandCursor: true });
        rect.on('pointerdown', () => this.handleCellClick(x, y));

        // Highlight allowed move targets green.
        const allowed = this.allowedTargets();
        if (this.selected && allowed.has(`${x}_${y}`)) {
          rect.setStrokeStyle(3, 0x00ff00);
        }
        // Highlight ship move targets.
        if (this.shipSelectedPlayer) {
          const me = s.players[this.shipSelectedPlayer];
          if (me) {
            const a = me.shipPos - 1;
            const b = me.shipPos + 1;
            const targets =
              me.edge === 'north' || me.edge === 'south'
                ? [
                    { x: a, y: me.edge === 'north' ? -1 : s.fieldSizeY },
                    { x: b, y: me.edge === 'north' ? -1 : s.fieldSizeY },
                  ]
                : [
                    { x: me.edge === 'west' ? -1 : s.fieldSizeX, y: a },
                    { x: me.edge === 'west' ? -1 : s.fieldSizeX, y: b },
                  ];
            for (const t of targets) {
              if (t.x === x && t.y === y) rect.setStrokeStyle(3, 0x00ff00);
            }
          }
        }

        // Cell glyph.
        let glyph = '';
        let sub = '';
        if (isSea(s, x, y)) {
          for (const pid of Object.keys(s.players)) {
            const sc = shipCellOf(s, pid);
            if (sc && sc.x === x && sc.y === y) glyph = 'S';
          }
          if (!glyph) glyph = '~';
        } else {
          const card = s.cards[cardKey(x, y)];
          if (!card) glyph = '';
          else if (!card.faceUp) glyph = '?';
          else if (card.type.startsWith('arrow_')) {
            glyph = arrowGlyph(card.type);
            sub = arrowLabel(card.type);
          } else if (card.type.startsWith('chest_')) {
            const n = card.coinsOnGround ?? 0;
            glyph = n > 0 ? `🪙${n}` : '▢';
          } else if (card.type.startsWith('trap_')) {
            glyph = card.type === 'trap_3' ? '💀3' : '💀2';
          } else glyph = '';
        }
        if (glyph) {
          this.add.text(cx, cy - 14, glyph, { color: '#ffffff', fontSize: '20px' }).setOrigin(0.5);
        }
        if (sub) {
          this.add.text(cx, cy + 12, sub, { color: '#dddddd', fontSize: '12px' }).setOrigin(0.5);
        }
      }
    }

    // Pieces as circles.
    for (const piece of Object.values(s.pieces)) {
      const owner = s.players[piece.playerId];
      const color = PLAYER_COLORS[(owner?.order ?? 0) % PLAYER_COLORS.length];
      const cx = origin + piece.x * CELL + CELL / 2;
      const cy = origin + piece.y * CELL + CELL / 2;
      const siblings = Object.values(s.pieces).filter((q) => q.x === piece.x && q.y === piece.y);
      const idx = siblings.findIndex((q) => q.id === piece.id);
      const ox = (idx - (siblings.length - 1) / 2) * 18;
      const selected = this.selected?.pieceId === piece.id;
      const circle = this.add.circle(cx + ox, cy + 12, 12, color);
      circle.setStrokeStyle(selected ? 3 : 1, selected ? 0x00ff00 : 0x000000);
      circle.setInteractive({ useHandCursor: true });
      circle.on('pointerdown', () => this.handlePieceClick(piece.id));
      const label = piece.carrying ? '●' : piece.stuck > 0 ? `✕${piece.stuck}` : '○';
      this.add.text(cx + ox, cy + 12, label, { color: '#ffffff', fontSize: '14px' }).setOrigin(0.5);
    }
  }

  private handlePieceClick(pieceId: string): void {
    const s = this.state;
    if (!s) return;
    const piece = s.pieces[pieceId];
    if (!piece) return;
    // All pieces clickable (hot-seat); clicking again deselects.
    this.selected =
      this.selected?.pieceId === pieceId ? null : { playerId: piece.playerId, pieceId };
    this.shipSelectedPlayer = null;
    this.render();
  }

  private handleCellClick(x: number, y: number): void {
    const s = this.state;
    if (!s) return;

    // 1. If a piece is selected and dest clicked -> try movePiece as current turn.
    if (this.selected) {
      const sel = s.pieces[this.selected.pieceId];
      if (sel && (sel.x !== x || sel.y !== y)) {
        const pid = this.selected.pieceId;
        this.selected = null;
        this.render();
        this.onAction(s.currentTurn, { kind: 'movePiece', pieceId: pid, to: { x, y } });
        return;
      }
    }

    // 2. If ship move armed and a target clicked -> moveShip as current turn.
    if (this.shipSelectedPlayer) {
      const me = s.players[this.shipSelectedPlayer];
      const sc = me ? shipCellOf(s, this.shipSelectedPlayer) : null;
      if (me && sc) {
        const dir = me.edge === 'north' || me.edge === 'south' ? x - me.shipPos : y - me.shipPos;
        if ((dir === 1 || dir === -1) && Math.abs(x - sc.x) + Math.abs(y - sc.y) <= 2) {
          const who = this.shipSelectedPlayer;
          this.shipSelectedPlayer = null;
          this.render();
          this.onAction(who, { kind: 'moveShip', dir: dir as -1 | 1 });
          return;
        }
      }
      this.shipSelectedPlayer = null;
      this.render();
      return;
    }

    // 3. Clicking a piece stack selects the top piece there.
    const stack = Object.values(s.pieces).find((p) => p.x === x && p.y === y);
    if (stack) {
      this.selected = { playerId: stack.playerId, pieceId: stack.id };
      this.shipSelectedPlayer = null;
      this.render();
      return;
    }

    // 4. Clicking the current-turn ship cell arms ship move.
    const sc = shipCellOf(s, s.currentTurn);
    if (sc && sc.x === x && sc.y === y) {
      this.shipSelectedPlayer = s.currentTurn;
      this.selected = null;
      this.render();
    }
  }
}
