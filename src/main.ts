// Wiring only: local hot-seat state + Phaser + UI. All rules live in core/.
import Phaser from 'phaser';
import { createStateFromConfig, defaultGameConfig, validateConfig } from './core/setup';
import { applyMove, coinsOnCard, parseTrapCost, validateMove } from './core/rules';
import type { Action, CardType, Edge, GameConfig } from './core/types';
import { CARD_TYPES, cardKey } from './core/types';
import { makeGameConfig } from './game/config';
import { GameScene } from './game/GameScene';
import './style.css';
import { isFreeTest, mountUI } from './ui';

let config: GameConfig = defaultGameConfig();
let state = createStateFromConfig(config, Math.random);

let game: Phaser.Game | null = null;
let ui: ReturnType<typeof mountUI> | null = null;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element: #${id}`);
  return e as T;
}

function scene(): GameScene | null {
  if (!game) return null;
  return game.scene.getScene('game') as GameScene;
}

function showView(name: 'menu' | 'settings' | 'game'): void {
  el('menuView').hidden = name !== 'menu';
  el('settingsView').hidden = name !== 'settings';
  el('gameView').hidden = name !== 'game';
}

function ensureGame(): void {
  if (game) return;
  game = new Phaser.Game(makeGameConfig());
  game.events.on('ready', () => {
    const s = scene();
    if (s) {
      s.onAction = (pid, a) => doAction(pid, a);
      s.setState(state);
    }
    ui?.update(state);
  });
  ui = mountUI({
    onGrab: (pid) => {
      const sel = scene()?.getSelected();
      const id = sel && sel.playerId === pid ? sel.pieceId : findGrabbable(pid);
      if (!id) return ui?.setStatus('Select a piece on coins first (click it)');
      doAction(pid, { kind: 'grab', pieceId: id });
    },
    onDrop: (pid) => {
      const sel = scene()?.getSelected();
      const id = sel && sel.playerId === pid ? sel.pieceId : findCarrying(pid);
      if (!id) return ui?.setStatus('Select a carrying piece first');
      doAction(pid, { kind: 'drop', pieceId: id });
    },
    onEndTurn: (pid) => doAction(pid, { kind: 'endTurn' }),
    onNewBoard: () => {
      state = createStateFromConfig(config, Math.random);
      scene()?.clearSelection();
      ui?.setStatus('New board dealt');
      refresh();
    },
  });
  ui.update(state);
}

function refresh(): void {
  ui?.update(state);
  scene()?.setState(state);
}

function doAction(playerId: string, action: Action): void {
  if (isFreeTest() && state.players[playerId]) {
    state.currentTurn = playerId;
  }
  const v = validateMove(state, playerId, action);
  if (!v.ok) {
    ui?.setStatus(`Invalid: ${v.reason}`);
    return;
  }
  state = applyMove(state, playerId, action);
  // Keep the piece selected while an arrow chain is pending so the
  // player can click the continuation dest same turn. Also keep it on
  // grab (including selection auto-grab) so the player can move next.
  if (!state.pendingArrow && action.kind !== 'grab') {
    scene()?.clearSelection();
  }
  ui?.setStatus('OK');
  refresh();
}

function findGrabbable(playerId: string): string | null {
  for (const p of Object.values(state.pieces)) {
    if (p.playerId !== playerId || p.onShip || p.carrying) continue;
    const card = state.cards[cardKey(p.x, p.y)];
    if (card && card.faceUp && card.type.startsWith('trap_')) {
      const n = parseTrapCost(card.type);
      if ((p.trapStep ?? 0) !== n) continue;
    }
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

// ---- settings form ----

function readConfigFromForm(): GameConfig {
  const num = (id: string, fallback: number): number => {
    const e = document.getElementById(id) as HTMLInputElement | null;
    const n = e ? Number(e.value) : fallback;
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  };
  let fx = num('cfgSizeX', 5);
  let fy = num('cfgSizeY', 5);
  fx = Math.min(9, Math.max(3, fx));
  fy = Math.min(9, Math.max(3, fy));
  const deckCounts = {} as Record<CardType, number>;
  for (const t of CARD_TYPES) {
    deckCounts[t] = Math.max(0, num(`cfg_${t}`, 0));
  }
  const edges: Edge[] = [];
  if ((document.getElementById('edge_north') as HTMLInputElement | null)?.checked) edges.push('north');
  if ((document.getElementById('edge_south') as HTMLInputElement | null)?.checked) edges.push('south');
  if ((document.getElementById('edge_west') as HTMLInputElement | null)?.checked) edges.push('west');
  if ((document.getElementById('edge_east') as HTMLInputElement | null)?.checked) edges.push('east');
  return { fieldSizeX: fx, fieldSizeY: fy, deckCounts, edges };
}

function refreshSettingsValidation(): void {
  const c = readConfigFromForm();
  const v = validateConfig(c);
  const err = el('cfgError');
  const cont = el<HTMLButtonElement>('settingsContinueBtn');
  const fixed = el('cfgFixed');
  const chest = c.deckCounts['chest_3'] ?? 0;
  fixed.textContent =
    `3 pieces/player, ship in the middle per edge, total coins ${chest * 3}.`;
  if (v.ok) {
    err.textContent = `${v.assigned}/${v.expected} cards assigned — ready.`;
    cont.disabled = false;
  } else {
    err.textContent = v.reason ?? 'invalid config';
    cont.disabled = true;
  }
}

function bindMenu(): void {
  el('joinBtn').onclick = () => {
    el('joinPane').hidden = false;
    el('testPane').hidden = true;
  };
  el('testBtn').onclick = () => {
    el('testPane').hidden = false;
    el('joinPane').hidden = true;
  };
  el('joinGoBtn').onclick = () => {
    el('joinPane').hidden = false;
  };
  el('createLocalBtn').onclick = () => {
    showView('settings');
    refreshSettingsValidation();
  };
  el('settingsBackBtn').onclick = () => showView('menu');
  el('settingsContinueBtn').onclick = () => {
    config = readConfigFromForm();
    const v = validateConfig(config);
    if (!v.ok) {
      refreshSettingsValidation();
      return;
    }
    state = createStateFromConfig(config, Math.random);
    ensureGame();
    showView('game');
    scene()?.clearSelection();
    ui?.setStatus('Local game started');
    refresh();
  };
  el('quitToMenuBtn').onclick = () => showView('menu');

  for (const id of ['cfgSizeX', 'cfgSizeY', ...CARD_TYPES.map((t) => `cfg_${t}`)]) {
    const input = document.getElementById(id);
    input?.addEventListener('input', refreshSettingsValidation);
  }
  for (const id of ['edge_north', 'edge_south', 'edge_west', 'edge_east']) {
    document.getElementById(id)?.addEventListener('change', refreshSettingsValidation);
  }
}

bindMenu();
showView('menu');
