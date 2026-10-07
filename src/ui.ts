// DOM overlay for local hot-seat testing. No Phaser here.
import type { GameState } from './core/types';

export interface UIHandlers {
  onGrab: (playerId: string) => void;
  onDrop: (playerId: string) => void;
  onEndTurn: (playerId: string) => void;
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
  // const turnLabel = el<HTMLParagraphElement>('turnLabel');
  const scores = el<HTMLElement>('scores');
  const statusEl = el<HTMLParagraphElement>('status');
  const hud = el<HTMLDivElement>('hud');
  const newBoardBtn = el<HTMLButtonElement>('newBoardBtn');

  newBoardBtn.onclick = () => h.onNewBoard();
  for (const pid of ['p1', 'p2']) {
    el<HTMLButtonElement>(`${pid}Grab`).onclick = () => h.onGrab(pid);
    el<HTMLButtonElement>(`${pid}Drop`).onclick = () => h.onDrop(pid);
    el<HTMLButtonElement>(`${pid}End`).onclick = () => h.onEndTurn(pid);
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
    const ordered = Object.values(state.players).sort((a, b) => a.order - b.order);
    const collected = ordered.reduce((sum, p) => sum + p.score, 0);
    const left = Math.max(0, state.totalCoins - collected);
    scores.innerHTML = '';
    for (const p of ordered) {
      const row = document.createElement('div');
      const isCurrent = p.id === state.currentTurn && state.status !== 'finished';
      row.className = `score-row${isCurrent ? ' current' : ''}`;
      row.textContent = `● ${p.id.toUpperCase()} — ${p.score} coin${p.score === 1 ? '' : 's'}${isCurrent ? ' (current turn ◀)' : ''}`;
      scores.appendChild(row);
    }
    const total = document.createElement('div');
    total.className = 'score-total';
    total.textContent = `Total: ${collected}/${state.totalCoins} collected, ${left} left`;
    scores.appendChild(total);
    // if (state.status === 'finished') {
    //   turnLabel.textContent = `Finished! Winner: ${state.winner ?? '?'} 🎉`;
    //   turnLabel.classList.add('score-winner');
    // } else {
    //   turnLabel.classList.remove('score-winner');
    //   turnLabel.textContent = `Turn: ${state.currentTurn.toUpperCase()} — move, Grab/Drop or End${state.moved ? ' (moved — Grab/Drop or End Turn)' : ''}${state.pendingArrow ? ' — keep going along the arrow!' : ''}`;
    // }
  }

  return { setStatus, update };
}
