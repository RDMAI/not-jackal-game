// DOM overlay: lobby, turn label, Grab/Drop/End-turn buttons. No Phaser here.
import type { GameState } from './core/types';

export interface UIHandlers {
  onCreate: (roomId: string, maxPlayers: number) => void;
  onJoin: (roomId: string) => void;
  onStart: () => void;
  onGrab: () => void;
  onDrop: () => void;
  onEndTurn: () => void;
  onShipMove: (dir: -1 | 1) => void;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element: #${id}`);
  return e as T;
}

export function mountUI(h: UIHandlers) {
  const roomIdInput = el<HTMLInputElement>('roomIdInput');
  const maxPlayers = el<HTMLSelectElement>('maxPlayers');
  const createBtn = el<HTMLButtonElement>('createBtn');
  const joinBtn = el<HTMLButtonElement>('joinBtn');
  const startBtn = el<HTMLButtonElement>('startBtn');
  const roomError = el<HTMLParagraphElement>('roomError');
  const turnLabel = el<HTMLParagraphElement>('turnLabel');
  const scores = el<HTMLParagraphElement>('scores');
  const statusEl = el<HTMLParagraphElement>('status');
  const hud = el<HTMLDivElement>('hud');
  const grabBtn = el<HTMLButtonElement>('grabBtn');
  const dropBtn = el<HTMLButtonElement>('dropBtn');
  const endTurnBtn = el<HTMLButtonElement>('endTurnBtn');
  const shipLeftBtn = el<HTMLButtonElement>('shipLeftBtn');
  const shipRightBtn = el<HTMLButtonElement>('shipRightBtn');

  createBtn.onclick = () => h.onCreate(roomIdInput.value.trim(), Number(maxPlayers.value));
  joinBtn.onclick = () => h.onJoin(roomIdInput.value.trim());
  startBtn.onclick = () => h.onStart();
  grabBtn.onclick = () => h.onGrab();
  dropBtn.onclick = () => h.onDrop();
  endTurnBtn.onclick = () => h.onEndTurn();
  shipLeftBtn.onclick = () => h.onShipMove(-1);
  shipRightBtn.onclick = () => h.onShipMove(1);

  function setError(msg: string): void {
    roomError.textContent = msg;
  }

  function setStatus(msg: string): void {
    statusEl.textContent = msg;
  }

  function update(state: GameState | null, myId: string): void {
    if (!state) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = '';
    const names = Object.values(state.players)
      .sort((a, b) => a.order - b.order)
      .map((p) => `${p.id.slice(0, 6)}(${p.edge}):${p.score}${p.id === state.currentTurn ? '*' : ''}`);
    scores.textContent = `Players: ${names.join(' ')}  | total coins: ${state.totalCoins}`;
    if (state.status === 'lobby') {
      turnLabel.textContent = `Lobby (${Object.keys(state.players).length}/${state.maxPlayers}). Press Start when 2+ joined.`;
      startBtn.style.display = '';
    } else if (state.status === 'finished') {
      turnLabel.textContent = `Finished! Winner: ${state.winner ?? '?'} 🎉`;
      startBtn.style.display = 'none';
    } else {
      const mine = state.currentTurn === myId;
      turnLabel.textContent = mine
        ? `Your turn${state.moved ? ' (moved — Grab/Drop or End Turn)' : ' (move a piece or ship)'}`
        : `Waiting for ${state.currentTurn.slice(0, 6)}…`;
      startBtn.style.display = 'none';
    }
  }

  return { setError, setStatus, update };
}
