// DOM overlay for local hot-seat testing. No Phaser here.
import type { GameState } from './core/types';

export interface UIHandlers {
  onGrab: (playerId: string) => void;
  onDrop: (playerId: string) => void;
  onEndTurn: (playerId: string) => void;
  onShipMove: (playerId: string, dir: -1 | 1) => void;
  onNewBoard: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element: #${id}`);
  return e as T;
}

export function isFreeTest(): boolean {
  const c = document.getElementById('freeTest') as HTMLInputElement | null;
  return c?.checked ?? false;
}

export function mountUI(h: UIHandlers) {
  const turnLabel = el<HTMLParagraphElement>('turnLabel');
  const scores = el<HTMLParagraphElement>('scores');
  const statusEl = el<HTMLParagraphElement>('status');
  const hud = el<HTMLDivElement>('hud');
  const newBoardBtn = el<HTMLButtonElement>('newBoardBtn');

  newBoardBtn.onclick = () => h.onNewBoard();
  for (const pid of ['p1', 'p2']) {
    el<HTMLButtonElement>(`${pid}Grab`).onclick = () => h.onGrab(pid);
    el<HTMLButtonElement>(`${pid}Drop`).onclick = () => h.onDrop(pid);
    el<HTMLButtonElement>(`${pid}End`).onclick = () => h.onEndTurn(pid);
    el<HTMLButtonElement>(`${pid}ShipLeft`).onclick = () => h.onShipMove(pid, -1);
    el<HTMLButtonElement>(`${pid}ShipRight`).onclick = () => h.onShipMove(pid, 1);
  }

  function setStatus(msg: string): void {
    statusEl.textContent = msg;
  }

  function update(state: GameState | null): void {
    if (!state) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = '';
    const names = Object.values(state.players)
      .sort((a, b) => a.order - b.order)
      .map((p) => `${p.id}${p.id === state.currentTurn ? '*' : ''}:${p.score}`);
    scores.textContent = `Players: ${names.join(' ')} | total coins: ${state.totalCoins}`;
    if (state.status === 'finished') {
      turnLabel.textContent = `Finished! Winner: ${state.winner ?? '?'} 🎉`;
    } else {
      turnLabel.textContent = `Turn: ${state.currentTurn}${state.moved ? ' (moved — Grab/Drop or End Turn)' : ''}`;
    }
  }

  return { setStatus, update };
}
