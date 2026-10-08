import Phaser from 'phaser';
import { isSea, parseArrowExits, parseTrapCost, shipCellOf } from '../core/rules';
import { shipCellFor } from '../core/setup';
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
    if (!card || !card.faceUp) return 0x14532d; // face-down: dark green
    if (card.type === 'empty') return 0x3f7d4e;
    if (card.type.startsWith('arrow_')) return 0x8a7d1e;
    if (card.type.startsWith('chest_')) return 0xa56a1a;
    return 0x8a2a2a; // trap
  }

  /** X offsets for N trap step circles centered in the cell. */
  private trapCircleXs(cx: number, cell: number, n: number): number[] {
    const r = cell * 0.12;
    const spacing = r * 2 + 6;
    const start = cx - ((n - 1) * spacing) / 2;
    return Array.from({ length: n }, (_, i) => start + i * spacing);
  }

  /** Cells the selected piece may legally step to. */
  private allowedTargets(): Set<string> {
    const out = new Set<string>();
    const s = this.state;
    if (!s || !this.selected) return out;
    const p = s.pieces[this.selected.pieceId];
    if (!p) return out;
    // Chained arrow: only the pending piece's arrow exits.
    if (s.pendingArrow) {
      if (p.id !== s.pendingArrow.pieceId) return out;
      const cur = s.cards[cardKey(p.x, p.y)];
      if (!cur || !cur.faceUp || !cur.type.startsWith('arrow_')) return out;
      for (const d of parseArrowExits(cur.type)) out.add(`${p.x + d.x}_${p.y + d.y}`);
      return out;
    }
    // Trapped mid-path: only advance in place (own cell highlighted).
    const trapStep = p.trapStep ?? 0;
    if (trapStep > 0 && !p.onShip) {
      const curCard = s.cards[cardKey(p.x, p.y)];
      if (curCard && curCard.faceUp && curCard.type.startsWith('trap_')) {
        const n = parseTrapCost(curCard.type);
        if (trapStep < n) {
          out.add(`${p.x}_${p.y}`);
          return out;
        }
        // Last step: fall through to 8 neighbours below.
      }
    }
    // Piece on ship: up-to-2 strictly adjacent sea cells along its edge.
    if (p.onShip) {
      const owner = s.players[p.playerId];
      if (!owner) return out;
      const max = owner.edge === 'north' || owner.edge === 'south' ? s.fieldSizeX : s.fieldSizeY;
      for (const dir of [-1, 1] as const) {
        const nextPos = owner.shipPos + dir;
        if (nextPos < 0 || nextPos >= max) continue;
        const t = shipCellFor(owner.edge, nextPos, s.fieldSizeX, s.fieldSizeY);
        // Exclude enemy-ship collisions.
        let blocked = false;
        for (const otherId of Object.keys(s.players)) {
          if (otherId === p.playerId) continue;
          const sc = shipCellOf(s, otherId);
          if (sc && sc.x === t.x && sc.y === t.y) {
            blocked = true;
            break;
          }
        }
        if (!blocked) out.add(`${t.x}_${t.y}`);
      }
      // Also allow disembark highlights: neighbouring land cells.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          out.add(`${p.x + dx}_${p.y + dy}`);
        }
      }
      return out;
    }
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

        // Cell glyph. Sea blanks (ships show S), face-down blanks.
        const arrowFont = `${Math.floor(CELL * 0.6)}px`;
        let glyph = '';
        let glyphFont = '20px';
        let sub = '';
        let coinOverlay = '';
        if (isSea(s, x, y)) {
          for (const pid of Object.keys(s.players)) {
            const sc = shipCellOf(s, pid);
            if (sc && sc.x === x && sc.y === y) glyph = 'S';
          }
        } else {
          const card = s.cards[cardKey(x, y)];
          if (!card) glyph = '';
          else if (!card.faceUp) glyph = '';
          else if (card.type.startsWith('arrow_')) {
            glyph = arrowGlyph(card.type);
            glyphFont = arrowFont;
            sub = arrowLabel(card.type);
          } else if (card.type.startsWith('chest_')) {
            glyph = '🪎';
            glyphFont = `${Math.floor(CELL * 0.45)}px`;
          } else if (card.type.startsWith('trap_')) {
            glyph = ''; // circles drawn below instead of 💀 glyph
          } else glyph = '';
          if (card?.faceUp && (card.coinsOnGround ?? 0) > 0 && !card.type.startsWith('trap_')) {
            coinOverlay = `🪙${card.coinsOnGround}`;
          }
        }
        if (glyph) {
          const yOff = coinOverlay ? -18 : -6;
          this.add.text(cx, cy + yOff, glyph, { color: '#ffffff', fontSize: glyphFont }).setOrigin(0.5);
        }
        // Open trap: row of N circles; next-step circle stroked green.
        // Coin pile anchored at the last circle.
        if (!isSea(s, x, y)) {
          const card = s.cards[cardKey(x, y)];
          if (card?.faceUp && card.type.startsWith('trap_')) {
            const n = parseTrapCost(card.type);
            const r = CELL * 0.12;
            const xs = this.trapCircleXs(cx, CELL, n);
            let nextStep = 0;
            const selPiece = this.selected ? s.pieces[this.selected.pieceId] : null;
            if (selPiece && selPiece.x === x && selPiece.y === y && (selPiece.trapStep ?? 0) > 0 && (selPiece.trapStep ?? 0) < n) {
              nextStep = (selPiece.trapStep ?? 0) + 1;
            }
            xs.forEach((px, i) => {
              const step = i + 1;
              const c = this.add.circle(px, cy - 8, r);
              c.setStrokeStyle(step === nextStep ? 3 : 1, step === nextStep ? 0x00ff00 : 0xffffff);
              c.setFillStyle(0x8a2a2a, 0.0);
            });
            if ((card.coinsOnGround ?? 0) > 0) {
              const lastX = xs[xs.length - 1];
              this.add
                .text(lastX, cy - 8 + r + 12, `🪙${card.coinsOnGround}`, {
                  color: '#ffe27a',
                  fontSize: '16px',
                })
                .setOrigin(0.5);
            }
          }
        }
        if (coinOverlay) {
          this.add.text(cx, cy + CELL / 2 - 20, coinOverlay, { color: '#ffe27a', fontSize: '18px' }).setOrigin(0.5);
        }
        if (sub) {
          this.add.text(cx, cy + CELL / 2 - 38, sub, { color: '#dddddd', fontSize: '12px' }).setOrigin(0.5);
        }
      }
    }

    // Pieces as circles.
    for (const piece of Object.values(s.pieces)) {
      const owner = s.players[piece.playerId];
      const color = PLAYER_COLORS[(owner?.order ?? 0) % PLAYER_COLORS.length];
      const cx = origin + piece.x * CELL + CELL / 2;
      const cy = origin + piece.y * CELL + CELL / 2;
      const trapStep = piece.trapStep ?? 0;
      const trapCard = !piece.onShip ? s.cards[cardKey(piece.x, piece.y)] : null;
      const onOpenTrap =
        trapStep > 0 && trapCard?.faceUp && trapCard.type.startsWith('trap_');
      let px = cx;
      let py = cy + 12;
      if (onOpenTrap && trapCard) {
        const n = parseTrapCost(trapCard.type);
        const xs = this.trapCircleXs(cx, CELL, n);
        const clamped = Math.min(Math.max(trapStep, 1), n);
        px = xs[clamped - 1];
        py = cy - 8;
        // Two own pieces on the same step: first on circle, second below.
        const sameStep = Object.values(s.pieces).filter(
          (q) => q.x === piece.x && q.y === piece.y && (q.trapStep ?? 0) === trapStep,
        );
        const idx = sameStep.findIndex((q) => q.id === piece.id);
        if (idx > 0) py += idx * 16;
        // Horizontal nudge only if somehow >2 share a step.
        if (sameStep.length > 2) {
          px += (idx - (sameStep.length - 1) / 2) * 8;
        }
      } else {
        const siblings = Object.values(s.pieces).filter((q) => q.x === piece.x && q.y === piece.y);
        const idx = siblings.findIndex((q) => q.id === piece.id);
        px = cx + (idx - (siblings.length - 1) / 2) * 18;
      }
      const selected = this.selected?.pieceId === piece.id;
      const circle = this.add.circle(px, py, 12, color);
      circle.setStrokeStyle(selected ? 3 : 1, selected ? 0x00ff00 : 0x000000);
      circle.setInteractive({ useHandCursor: true });
      circle.on('pointerdown', () => this.handlePieceClick(piece.id));
      let label = '○';
      if (piece.carrying) label = '●';
      else if (onOpenTrap && trapCard) label = `${trapStep}/${parseTrapCost(trapCard.type)}`;
      this.add.text(px, py, label, { color: '#ffffff', fontSize: '14px' }).setOrigin(0.5);
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
    this.render();
  }

  private handleCellClick(x: number, y: number): void {
    const s = this.state;
    if (!s) return;

    // 1. If a piece is selected and dest clicked -> movePiece, or
    //    piece-on-ship + strictly adjacent sea cell -> moveShip, or
    //    own cell with trapped piece -> advanceTrap.
    if (this.selected) {
      const sel = s.pieces[this.selected.pieceId];
      if (sel) {
        if (sel.x === x && sel.y === y) {
          const trapStep = sel.trapStep ?? 0;
          if (trapStep > 0 && !sel.onShip) {
            const card = s.cards[cardKey(x, y)];
            if (card?.faceUp && card.type.startsWith('trap_') && trapStep < parseTrapCost(card.type)) {
              const pid = this.selected.pieceId;
              this.selected = null;
              this.render();
              this.onAction(s.currentTurn, { kind: 'advanceTrap', pieceId: pid });
              return;
            }
          }
          // Same-cell click without trap advance: fall through to select.
        } else {
        const pid = this.selected.pieceId;
        if (sel.onShip) {
          const owner = s.players[sel.playerId];
          if (owner) {
            const dir =
              owner.edge === 'north' || owner.edge === 'south'
                ? x - owner.shipPos
                : y - owner.shipPos;
            if (dir === 1 || dir === -1) {
              const expected = shipCellFor(owner.edge, owner.shipPos + dir, s.fieldSizeX, s.fieldSizeY);
              if (expected.x === x && expected.y === y) {
                this.selected = null;
                this.render();
                this.onAction(s.currentTurn, { kind: 'moveShip', dir: dir as -1 | 1 });
                return;
              }
            }
          }
        }
        this.selected = null;
        this.render();
        this.onAction(s.currentTurn, { kind: 'movePiece', pieceId: pid, to: { x, y } });
        return;
        }
      }
    }

    // 2. Clicking a piece stack selects the top piece there.
    const stack = Object.values(s.pieces).find((p) => p.x === x && p.y === y);
    if (stack) {
      this.selected = { playerId: stack.playerId, pieceId: stack.id };
      this.render();
      return;
    }
  }
}
