// Wiring only: local hot-seat and online room modes. All rules live in core/.
import Phaser from 'phaser';
import type { Unsubscribe } from 'firebase/database';
import { isValidRoomId } from './core/roomId';
import { applyMove, validateMove } from './core/rules';
import { createStateFromConfig, defaultGameConfig, validateConfig } from './core/setup';
import type { Action, CardType, Edge, GameConfig, GameState, RoomDoc } from './core/types';
import { CARD_TYPES } from './core/types';
import { makeGameConfig } from './game/config';
import { GameScene } from './game/GameScene';
import {
  claimPlayer as claimRoomPlayer,
  clearSavedPlayerId,
  getSavedPlayerId,
  savePlayerId,
  startGame as startRoomGame,
  submitAction,
  subscribeRoom,
  type RoomLoadResult,
  type WriteResult,
} from './net/room';
import './style.css';
import { isFreeTest, mountUI } from './ui';

type Mode = 'local' | 'online';

let mode: Mode = 'local';
let config: GameConfig = defaultGameConfig();
let state = createStateFromConfig(config, Math.random);

// Turn-start snapshot for full-turn revert (Firebase-ready: plain JSON clone).
// Refreshed only on turn boundaries / new game, never after mid-turn actions.
let turnStartSnapshot: GameState | null = null;
let turnDirty = false;

function cloneState(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

function takeSnapshot(): void {
  turnStartSnapshot = cloneState(state);
  turnDirty = false;
}

/** True if any card flipped face-down -> face-up since the snapshot. */
export function hasDiscoveredSince(snap: GameState | null, cur: GameState): boolean {
  if (!snap) return false;
  for (const key of Object.keys(cur.cards)) {
    const before = snap.cards[key];
    const after = cur.cards[key];
    if (after?.faceUp && !before?.faceUp) return true;
  }
  return false;
}

function canRevert(playerId: string): boolean {
  if (!turnStartSnapshot) return false;
  if (state.status !== 'running') return false;
  if (state.currentTurn !== playerId) return false;
  if (!turnDirty) return false;
  if (hasDiscoveredSince(turnStartSnapshot, state)) return false;
  return true;
}

function revertEnabledFor(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const pid of Object.keys(state.players)) {
    out[pid] = canRevert(pid);
  }
  return out;
}

let game: Phaser.Game | null = null;
let ui: ReturnType<typeof mountUI> | null = null;

let currentRoomId: string | null = null;
let currentRoom: RoomDoc | null = null;
let myPlayerId: string | null = null;
let unsubscribeRoom: Unsubscribe | null = null;
let subscriptionGeneration = 0;
let roomLoadedOnce = false;
let autoClaimInFlight = false;
let autoClaimBlocked = false;
let pendingClaimPlayerId: string | null = null;
let actionPending = false;

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element: #${id}`);
  return e as T;
}

function scene(): GameScene | null {
  if (!game) return null;
  return game.scene.getScene('game') as GameScene;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showView(name: 'menu' | 'settings' | 'lobby' | 'game'): void {
  el('menuView').hidden = name !== 'menu';
  el('settingsView').hidden = name !== 'settings';
  el('lobbyView').hidden = name !== 'lobby';
  el('gameView').hidden = name !== 'game';
}

function applySceneContext(): void {
  const s = scene();
  if (!s) return;
  s.setOnlinePlayerId(mode === 'online' ? myPlayerId : null);
  s.setState(state);
}

function ensureGame(): void {
  if (game) return;
  game = new Phaser.Game(makeGameConfig());
  game.events.on('ready', () => {
    const s = scene();
    if (s) {
      s.onAction = (pid, a) => {
        void doAction(pid, a);
      };
    }
    applySceneContext();
    if (mode === 'online') {
      if (currentRoom) renderRoom(currentRoom);
    } else {
      refresh();
    }
  });
}

function refresh(): void {
  if (mode === 'online') {
    if (currentRoom) renderRoom(currentRoom);
    return;
  }
  ui?.update(state, { mode: 'local', myPlayerId: null, revertEnabled: revertEnabledFor() });
  scene()?.setState(state);
}

function renderRoom(room: RoomDoc): void {
  currentRoom = room;
  state = room.state;

  if (room.state.status === 'lobby') {
    ui?.showLobby(room, currentRoomId ?? '', myPlayerId);
    showView('lobby');
    return;
  }

  ensureGame();
  const s = scene();
  if (s) {
    s.setOnlinePlayerId(myPlayerId);
    s.setState(room.state);
  }
  ui?.update(room.state, { mode: 'online', myPlayerId, revertEnabled: {} });
  showView('game');
}

/** Locally mark a successfully claimed slot so the lobby can render before RTDB echoes. */
function optimisticClaimedRoom(playerId: string): RoomDoc | null {
  if (!currentRoom) return null;
  const player = currentRoom.state.players[playerId];
  if (!player) return null;
  return {
    ...currentRoom,
    state: {
      ...currentRoom.state,
      players: {
        ...currentRoom.state.players,
        [playerId]: { ...player, joined: true },
      },
    },
  };
}

function cleanupSubscription(): void {
  subscriptionGeneration++;
  if (unsubscribeRoom) {
    try {
      unsubscribeRoom();
    } catch {
      // Ignore unsubscribe failures; the generation guard already ignores callbacks.
    }
    unsubscribeRoom = null;
  }
}

function endOnlineSession(): void {
  cleanupSubscription();
  mode = 'local';
  currentRoom = null;
  currentRoomId = null;
  myPlayerId = null;
  roomLoadedOnce = false;
  autoClaimInFlight = false;
  autoClaimBlocked = false;
  pendingClaimPlayerId = null;
  actionPending = false;
  ui?.resetOnline();
}

function leaveOnline(): void {
  endOnlineSession();
  ui?.showJoinStatus('Left the room. Your saved slot mapping was kept.');
  showView('menu');
  el<HTMLDivElement>('joinPane').hidden = false;
}

function abortOnlineToMenu(message: string): void {
  endOnlineSession();
  ui?.setStatus(message);
  ui?.showJoinStatus(message, 'error');
  showView('menu');
  el<HTMLDivElement>('joinPane').hidden = false;
}

function showGameAlreadyStarted(): void {
  abortOnlineToMenu('Game already started. Ask for a new room.');
}

function findRoom(input: string): void {
  const roomId = input.trim();
  if (!isValidRoomId(roomId)) {
    ui?.showJoinStatus('Invalid room ID. Use a non-empty id without / . # $ [ ].', 'error');
    ui?.hidePlayerSelection();
    return;
  }

  cleanupSubscription();
  mode = 'online';
  currentRoomId = roomId;
  currentRoom = null;
  myPlayerId = null;
  roomLoadedOnce = false;
  autoClaimInFlight = false;
  autoClaimBlocked = false;
  pendingClaimPlayerId = null;
  actionPending = false;
  ui?.resetOnline();
  ui?.showJoinStatus('Finding room…');
  showView('menu');
  el<HTMLDivElement>('joinPane').hidden = false;

  try {
    subscribeToRoom(roomId);
  } catch (error) {
    ui?.showJoinStatus(`Network error: ${messageOf(error)}`, 'error');
  }
}

function subscribeToRoom(roomId: string): void {
  const generation = ++subscriptionGeneration;
  unsubscribeRoom = subscribeRoom(roomId, (result) => {
    if (generation !== subscriptionGeneration) return;
    handleRoomResult(roomId, result);
  });
}

function handleRoomResult(roomId: string, result: RoomLoadResult): void {
  if (roomId !== currentRoomId) return;

  if (!result.ok) {
    if (result.kind === 'unsupported') {
      if (roomLoadedOnce) {
        abortOnlineToMenu(`Unsupported or corrupt room: ${result.reason}`);
      } else {
        ui?.showJoinStatus(`Unsupported or corrupt room: ${result.reason}`, 'error');
        ui?.hidePlayerSelection();
        cleanupSubscription();
      }
      return;
    }
    if (result.kind === 'not-found') {
      if (roomLoadedOnce) {
        abortOnlineToMenu('The room was deleted. Your saved slot was kept.');
      } else {
        ui?.showJoinStatus('Room not found.', 'error');
        ui?.hidePlayerSelection();
        cleanupSubscription();
      }
      return;
    }
    if (roomLoadedOnce) {
      abortOnlineToMenu(`Lost connection to the room: ${result.reason}`);
    } else {
      ui?.showJoinStatus(`Network error: ${result.reason}. Press Find room to retry.`, 'error');
    }
    return;
  }

  roomLoadedOnce = true;
  currentRoom = result.room;
  state = result.room.state;
  reconcileRoom(roomId, result.room);
}

function reconcileRoom(roomId: string, room: RoomDoc): void {
  let saved = getSavedPlayerId(roomId);
  if (saved && !room.state.players[saved]) {
    clearSavedPlayerId(roomId);
    saved = null;
  }

  if (saved) {
    const player = room.state.players[saved];
    if (player.joined) {
      pendingClaimPlayerId = null;
      myPlayerId = saved;
      autoClaimBlocked = false;
      ui?.showRetryClaim(false);
      renderRoom(room);
      return;
    }

    if (room.state.status === 'lobby') {
      myPlayerId = null;
      showView('menu');
      el<HTMLDivElement>('joinPane').hidden = false;

      if (pendingClaimPlayerId === saved) {
        ui?.hidePlayerSelection();
        ui?.showJoinStatus(`Claimed ${saved.toUpperCase()}. Waiting for the room to update…`);
        return;
      }
      if (autoClaimBlocked) {
        ui?.hidePlayerSelection();
        ui?.showJoinStatus(
          `Network error claiming your saved slot ${saved.toUpperCase()}. Press Retry claim.`,
          'error',
        );
        ui?.showRetryClaim(true);
        return;
      }

      ui?.hidePlayerSelection();
      void autoClaimSavedSlot(saved);
      return;
    }

    if (pendingClaimPlayerId === saved) {
      myPlayerId = saved;
      ui?.hidePlayerSelection();
      ui?.showJoinStatus(`Claimed ${saved.toUpperCase()}. Waiting for the room to update…`);
      return;
    }

    clearSavedPlayerId(roomId);
    saved = null;
    myPlayerId = null;
  }

  myPlayerId = null;
  if (room.state.status === 'lobby') {
    ui?.showRetryClaim(false);
    ui?.showJoinStatus('Choose an open player slot.');
    ui?.showPlayerSelection(room);
    showView('menu');
    el<HTMLDivElement>('joinPane').hidden = false;
    return;
  }

  showGameAlreadyStarted();
}

async function autoClaimSavedSlot(playerId: string): Promise<void> {
  if (!currentRoomId || autoClaimInFlight) return;
  const roomId = currentRoomId;
  const epoch = subscriptionGeneration;
  autoClaimInFlight = true;
  ui?.showRetryClaim(false);
  ui?.showJoinStatus(`Claiming your saved slot ${playerId.toUpperCase()}…`);

  let result: WriteResult;
  try {
    result = await claimRoomPlayer(roomId, playerId);
  } catch (error) {
    result = { ok: false, reason: messageOf(error), kind: 'network' };
  } finally {
    autoClaimInFlight = false;
  }

  // Remember a successful claim even if the user has moved on since.
  if (result.ok) savePlayerId(roomId, playerId);
  if (mode !== 'online' || currentRoomId !== roomId || epoch !== subscriptionGeneration) return;

  if (result.ok) {
    pendingClaimPlayerId = playerId;
    myPlayerId = playerId;
    const optimistic = optimisticClaimedRoom(playerId);
    if (optimistic) {
      renderRoom(optimistic);
      ui?.showJoinStatus(`Claimed ${playerId.toUpperCase()}.`);
    } else {
      ui?.hidePlayerSelection();
      ui?.showJoinStatus(`Claimed ${playerId.toUpperCase()}. Waiting for the room to update…`);
    }
    return;
  }

  if (result.kind === 'network') {
    autoClaimBlocked = true;
    ui?.showJoinStatus(`Network error claiming your saved slot: ${result.reason}`, 'error');
    ui?.showRetryClaim(true);
    return;
  }

  clearSavedPlayerId(roomId);
  pendingClaimPlayerId = null;
  myPlayerId = null;
  autoClaimBlocked = false;
  ui?.showRetryClaim(false);
  ui?.showJoinStatus(`Saved slot is no longer available: ${result.reason}`, 'error');
  if (currentRoom && currentRoom.state.status === 'lobby') {
    ui?.showPlayerSelection(currentRoom);
    showView('menu');
    el<HTMLDivElement>('joinPane').hidden = false;
  } else {
    showGameAlreadyStarted();
  }
}

function retryAutoClaim(): void {
  if (mode !== 'online' || !currentRoomId) return;
  const saved = getSavedPlayerId(currentRoomId);
  if (!saved) {
    ui?.showRetryClaim(false);
    ui?.showJoinStatus('No saved slot to retry.', 'error');
    return;
  }
  autoClaimBlocked = false;
  ui?.showRetryClaim(false);
  void autoClaimSavedSlot(saved);
}

async function claimOnlinePlayer(playerId: string): Promise<void> {
  if (mode !== 'online' || !currentRoomId) return;
  if (!playerId) {
    ui?.showJoinStatus('Select a player slot first.', 'error');
    return;
  }

  const roomId = currentRoomId;
  const epoch = subscriptionGeneration;
  ui?.setFindBusy(true);
  let result: WriteResult;
  try {
    result = await claimRoomPlayer(roomId, playerId);
  } catch (error) {
    result = { ok: false, reason: messageOf(error), kind: 'network' };
  } finally {
    if (epoch === subscriptionGeneration) ui?.setFindBusy(false);
  }

  // Remember a successful claim even if the user has moved on since.
  if (result.ok) savePlayerId(roomId, playerId);
  if (mode !== 'online' || currentRoomId !== roomId || epoch !== subscriptionGeneration) return;

  if (!result.ok) {
    ui?.showJoinStatus(`Could not claim ${playerId.toUpperCase()}: ${result.reason}`, 'error');
    if (result.kind === 'conflict' && currentRoom?.state.status === 'lobby') {
      ui?.showPlayerSelection(currentRoom);
    }
    return;
  }

  pendingClaimPlayerId = playerId;
  myPlayerId = playerId;
  const optimistic = optimisticClaimedRoom(playerId);
  if (optimistic) {
    renderRoom(optimistic);
    ui?.showJoinStatus(`Claimed ${playerId.toUpperCase()}.`);
  } else {
    ui?.hidePlayerSelection();
    ui?.showJoinStatus(`Claimed ${playerId.toUpperCase()}. Waiting for the room to update…`);
  }
}

async function startOnlineGame(): Promise<void> {
  if (mode !== 'online' || !currentRoomId || !myPlayerId) return;
  const roomId = currentRoomId;
  const playerId = myPlayerId;
  const epoch = subscriptionGeneration;
  const result = await startRoomGame(roomId, playerId);
  if (mode !== 'online' || currentRoomId !== roomId || epoch !== subscriptionGeneration) return;
  if (!result.ok) {
    ui?.setLobbyStatus(`Cannot start: ${result.reason}`);
  } else {
    ui?.setLobbyStatus('Starting…');
  }
}

async function doAction(playerId: string, action: Action): Promise<void> {
  if (mode === 'online') {
    if (!currentRoomId || !myPlayerId) {
      ui?.setStatus('Not connected to a room');
      return;
    }
    if (state.status !== 'running') {
      ui?.setStatus('Game is not running');
      return;
    }
    if (actionPending) return;
    const roomId = currentRoomId;
    const actingPlayerId = myPlayerId;
    const epoch = subscriptionGeneration;
    actionPending = true;
    const result = await submitAction(roomId, actingPlayerId, action);
    if (mode !== 'online' || currentRoomId !== roomId || epoch !== subscriptionGeneration) return;
    actionPending = false;
    if (!result.ok) {
      ui?.setStatus(`Invalid: ${result.reason}`);
      return;
    }
    ui?.setStatus('OK');
    return;
  }

  if (isFreeTest() && state.players[playerId]) {
    state.currentTurn = playerId;
  }
  const v = validateMove(state, playerId, action);
  if (!v.ok) {
    ui?.setStatus(`Invalid: ${v.reason}`);
    refresh();
    return;
  }
  state = applyMove(state, playerId, action);
  if (action.kind === 'endTurn') {
    takeSnapshot();
  } else {
    turnDirty = true;
  }
  // Keep the piece selected on grab/drop (explicit buttons never deselect)
  // and while an arrow chain is pending so the player can click the
  // continuation dest same turn.
  if (!state.pendingArrow && action.kind !== 'grab' && action.kind !== 'drop') {
    scene()?.clearSelection();
  }
  ui?.setStatus('OK');
  refresh();
}

function doRevert(playerId: string): void {
  if (mode !== 'local') return;
  if (isFreeTest() && state.players[playerId]) {
    state.currentTurn = playerId;
  }
  if (!turnStartSnapshot) {
    ui?.setStatus('Nothing to revert');
    refresh();
    return;
  }
  if (state.status !== 'running') {
    ui?.setStatus('Cannot revert: game finished');
    refresh();
    return;
  }
  if (state.currentTurn !== playerId) {
    ui?.setStatus('Cannot revert: not your turn');
    refresh();
    return;
  }
  if (!turnDirty) {
    ui?.setStatus('Nothing to revert');
    refresh();
    return;
  }
  if (hasDiscoveredSince(turnStartSnapshot, state)) {
    ui?.setStatus('Cannot revert after discovering a card');
    refresh();
    return;
  }
  state = cloneState(turnStartSnapshot);
  turnDirty = false;
  scene()?.clearSelection();
  ui?.setStatus('Turn reverted');
  refresh();
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

function startLocalGame(): void {
  endOnlineSession();

  config = readConfigFromForm();
  const v = validateConfig(config);
  if (!v.ok) {
    refreshSettingsValidation();
    return;
  }

  state = createStateFromConfig(config, Math.random);
  takeSnapshot();
  ensureGame();
  scene()?.setOnlinePlayerId(null);
  scene()?.clearSelection();
  showView('game');
  ui?.setStatus('Local game started');
  refresh();
}

function newLocalBoard(): void {
  if (mode !== 'local') return;
  state = createStateFromConfig(config, Math.random);
  takeSnapshot();
  scene()?.clearSelection();
  ui?.setStatus('New board dealt');
  refresh();
}

function bindMenu(): void {
  el('joinBtn').onclick = () => {
    el<HTMLDivElement>('joinPane').hidden = false;
    el<HTMLDivElement>('testPane').hidden = true;
  };
  el('testBtn').onclick = () => {
    el<HTMLDivElement>('testPane').hidden = false;
    el<HTMLDivElement>('joinPane').hidden = true;
  };
  el('createLocalBtn').onclick = () => {
    if (mode === 'online') endOnlineSession();
    showView('settings');
    refreshSettingsValidation();
  };
  el('settingsBackBtn').onclick = () => showView('menu');
  el('settingsContinueBtn').onclick = () => startLocalGame();
  el('quitToMenuBtn').onclick = () => {
    if (mode === 'online') {
      leaveOnline();
    } else {
      showView('menu');
    }
  };

  for (const id of ['cfgSizeX', 'cfgSizeY', ...CARD_TYPES.map((t) => `cfg_${t}`)]) {
    const input = document.getElementById(id);
    input?.addEventListener('input', refreshSettingsValidation);
  }
  for (const id of ['edge_north', 'edge_south', 'edge_west', 'edge_east']) {
    document.getElementById(id)?.addEventListener('change', refreshSettingsValidation);
  }
}

ui = mountUI({
  onGrab: (pid) => {
    const sel = scene()?.getSelected();
    const playerId = mode === 'online' ? myPlayerId : pid;
    if (!playerId) return;
    const id = sel && sel.playerId === playerId ? sel.pieceId : null;
    if (!id) return ui?.setStatus('Select a piece first (click it)');
    void doAction(playerId, { kind: 'grab', pieceId: id });
  },
  onDrop: (pid) => {
    const sel = scene()?.getSelected();
    const playerId = mode === 'online' ? myPlayerId : pid;
    if (!playerId) return;
    const id = sel && sel.playerId === playerId ? sel.pieceId : null;
    if (!id) return ui?.setStatus('Select a piece first (click it)');
    void doAction(playerId, { kind: 'drop', pieceId: id });
  },
  onEndTurn: (pid) => {
    const playerId = mode === 'online' ? myPlayerId : pid;
    if (!playerId) return;
    void doAction(playerId, { kind: 'endTurn' });
  },
  onRevert: (pid) => {
    if (mode === 'local') doRevert(pid);
  },
  onNewBoard: () => newLocalBoard(),
  onFindRoom: (roomId) => findRoom(roomId),
  onClaimPlayer: (playerId) => {
    void claimOnlinePlayer(playerId);
  },
  onStartGame: () => {
    void startOnlineGame();
  },
  onLeaveOnline: () => leaveOnline(),
  onRetryClaim: () => retryAutoClaim(),
});

takeSnapshot();
bindMenu();
ui.update(null, { mode: 'local' });
showView('menu');
