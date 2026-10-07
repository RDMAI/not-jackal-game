// Wiring only: local hot-seat state + Phaser + UI. All rules live in core/.
import Phaser from 'phaser';
import { createInitialState } from './core/setup';
import { applyMove, coinsOnCard, validateMove } from './core/rules';
import type { Action } from './core/types';
import { makeGameConfig } from './game/config';
import { GameScene } from './game/GameScene';
import './style.css';
import { isFreeTest, mountUI } from './ui';

let state = createInitialState(['p1', 'p2'], 2);

const game = new Phaser.Game(makeGameConfig());

function scene(): GameScene {
  return game.scene.getScene('game') as GameScene;
}

function refresh(): void {
  ui.update(state);
  scene().setState(state);
}

function doAction(playerId: string, action: Action): void {
  if (isFreeTest() && (playerId === 'p1' || playerId === 'p2')) {
    state.currentTurn = playerId;
  }
  const v = validateMove(state, playerId, action);
  if (!v.ok) {
    ui.setStatus(`Invalid: ${v.reason}`);
    return;
  }
  state = applyMove(state, playerId, action);
  // Keep the piece selected while an arrow chain is pending so the
  // player can click the continuation dest same turn.
  if (!state.pendingArrow) {
    scene().clearSelection();
  }
  ui.setStatus('OK');
  refresh();
}

function findGrabbable(playerId: string): string | null {
  for (const p of Object.values(state.pieces)) {
    if (p.playerId !== playerId || p.onShip || p.carrying || p.stuck > 0) continue;
    if (coinsOnCard(state, p.x, p.y) > 0) return p.id;
  }
  return null;
}

function findCarrying(playerId: string): string | null {
  for (const p of Object.values(state.pieces)) {
    if (p.playerId === playerId && p.carrying) return p.id;
  }
  return null;
}

const ui = mountUI({
  onGrab: (pid) => {
    const sel = scene().getSelected();
    const id = sel && sel.playerId === pid ? sel.pieceId : findGrabbable(pid);
    if (!id) return ui.setStatus('Select a piece on coins first (click it)');
    doAction(pid, { kind: 'grab', pieceId: id });
  },
  onDrop: (pid) => {
    const sel = scene().getSelected();
    const id = sel && sel.playerId === pid ? sel.pieceId : findCarrying(pid);
    if (!id) return ui.setStatus('Select a carrying piece first');
    doAction(pid, { kind: 'drop', pieceId: id });
  },
  onEndTurn: (pid) => doAction(pid, { kind: 'endTurn' }),
  onNewBoard: () => {
    state = createInitialState(['p1', 'p2'], 2, Math.random);
    scene().clearSelection();
    ui.setStatus('New board dealt');
    refresh();
  },
});

// Attach scene callback once booted too.
game.events.on('ready', () => {
  scene().onAction = (pid, a) => doAction(pid, a);
  refresh();
});
