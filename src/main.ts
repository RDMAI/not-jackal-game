// Wiring only: Firebase + Phaser + UI. All rules live in core/rules.ts.
import Phaser from 'phaser';
import { validateMove } from './core/rules';
import type { Action, GameState } from './core/types';
import { makeGameConfig } from './game/config';
import { GameScene } from './game/GameScene';
import { createRoom, getMyId, joinRoom, startGame, submitAction, subscribeRoom } from './net/room';
import './style.css';
import { mountUI } from './ui';

const myId = getMyId();
let roomId: string | null = null;
let latest: GameState | null = null;

const game = new Phaser.Game(makeGameConfig());

function scene(): GameScene {
  const s = game.scene.getScene('game') as GameScene;
  return s;
}

async function doAction(action: Action): Promise<void> {
  if (!roomId || !latest) {
    ui.setStatus('Join a room first');
    return;
  }
  const v = validateMove(latest, myId, action);
  if (!v.ok) {
    ui.setStatus(`Invalid: ${v.reason}`);
    return;
  }
  ui.setStatus('Sending…');
  const r = await submitAction(roomId, myId, action);
  ui.setStatus(r.ok ? 'OK' : `Rejected: ${r.reason}`);
  if (r.ok) scene().clearSelection();
}

const ui = mountUI({
  onCreate: async (id, maxPlayers) => {
    if (!id) return ui.setError('invalid id');
    ui.setError('');
    try {
      await createRoom(id, maxPlayers, myId);
      roomId = id;
      subscribe(id);
      ui.setStatus(`Room ${id} created as ${myId.slice(0, 6)}`);
    } catch (e) {
      ui.setError((e as Error).message);
    }
  },
  onJoin: async (id) => {
    if (!id) return ui.setError('invalid id');
    ui.setError('');
    const r = await joinRoom(id, myId);
    if (!r.ok) {
      ui.setError(r.reason ?? 'cannot join');
      return;
    }
    roomId = id;
    subscribe(roomId);
    ui.setStatus(`Joined ${id} as ${myId.slice(0, 6)}`);
  },
  onStart: async () => {
    if (!roomId) return;
    const r = await startGame(roomId);
    ui.setStatus(r.ok ? 'Game started!' : `Cannot start: ${r.reason}`);
  },
  onGrab: () => {
    const sel = scene().getSelectedPiece();
    // Default to first own piece standing on a coin if none selected.
    const pid = sel ?? findGrabbable();
    if (!pid) return ui.setStatus('Select a piece on coins first (click it)');
    void doAction({ kind: 'grab', pieceId: pid });
  },
  onDrop: () => {
    const sel = scene().getSelectedPiece();
    const pid = sel ?? findCarrying();
    if (!pid) return ui.setStatus('Select a carrying piece first');
    void doAction({ kind: 'drop', pieceId: pid });
  },
  onEndTurn: () => void doAction({ kind: 'endTurn' }),
  onShipMove: (dir) => void doAction({ kind: 'moveShip', dir }),
});

function findGrabbable(): string | null {
  if (!latest) return null;
  for (const p of Object.values(latest.pieces)) {
    if (p.playerId !== myId || p.onShip || p.carrying) continue;
    const card = latest.cards[`${p.x}_${p.y}`];
    if (card && card.type === 'chest' && (card.coinsLeft ?? 0) + (card.coinsOnGround ?? 0) > 0) {
      return p.id;
    }
  }
  return null;
}

function findCarrying(): string | null {
  if (!latest) return null;
  for (const p of Object.values(latest.pieces)) {
    if (p.playerId === myId && p.carrying) return p.id;
  }
  return null;
}

function subscribe(id: string): void {
  subscribeRoom(id, (s) => {
    latest = s;
    ui.update(s, myId);
    const sc = scene();
    sc.setMyId(myId);
    sc.setState(s);
  });
  // Scene may not be ready on first subscribe; poll until active.
  const timer = setInterval(() => {
    const sc = game.scene.getScene('game') as GameScene | undefined;
    if (sc && sc.scene.isActive()) {
      sc.onAction = (a) => void doAction(a);
      sc.setMyId(myId);
      if (latest) sc.setState(latest);
      clearInterval(timer);
    }
  }, 200);
}

// Attach scene callback once booted too.
game.events.on('ready', () => {
  scene().onAction = (a) => void doAction(a);
});
