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
  const scores = el<HTMLElement>('scores');
  const statusEl = el<HTMLParagraphElement>('status');
  const hud = el<HTMLDivElement>('hud');
  const newBoardBtn = el<HTMLButtonElement>('newBoardBtn');
  const panels = document.getElementById('playerPanels') as HTMLElement | null;

  newBoardBtn.onclick = () => h.onNewBoard();

  let boundIds: string[] = [];

  function bindPanels(ids: string[]): void {
    if (panels && ids.join(',') !== boundIds.join(',')) {
      boundIds = [...ids];
      panels.innerHTML = '';
      for (const pid of ids) {
        const div = document.createElement('div');
        div.id = `${pid}panel`;
        const strong = document.createElement('strong');
        strong.textContent = pid.toUpperCase();
        div.appendChild(strong);
        div.appendChild(document.createTextNode(' '));
        const grab = document.createElement('button');
        grab.id = `${pid}Grab`;
        grab.textContent = 'Grab';
        grab.onclick = () => h.onGrab(pid);
        const drop = document.createElement('button');
        drop.id = `${pid}Drop`;
        drop.textContent = 'Drop';
        drop.onclick = () => h.onDrop(pid);
        const end = document.createElement('button');
        end.id = `${pid}End`;
        end.textContent = 'End';
        end.onclick = () => h.onEndTurn(pid);
        div.append(grab, drop, end);
        panels.appendChild(div);
      }
    }
    // Legacy static p1/p2 buttons (if present, e.g. old index.html).
    for (const pid of ids) {
      const g = document.getElementById(`${pid}Grab`) as HTMLButtonElement | null;
      const d = document.getElementById(`${pid}Drop`) as HTMLButtonElement | null;
      const e = document.getElementById(`${pid}End`) as HTMLButtonElement | null;
      if (g && !g.onclick) g.onclick = () => h.onGrab(pid);
      if (d && !d.onclick) d.onclick = () => h.onDrop(pid);
      if (e && !e.onclick) e.onclick = () => h.onEndTurn(pid);
    }
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
    bindPanels(ordered.map((p) => p.id));
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
  }

  return { setStatus, update };
}
