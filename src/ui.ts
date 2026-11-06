// DOM overlay for the menu, lobby, and game. No Phaser here.
import type { GameState, RoomDoc } from './core/types';

export interface UIHandlers {
  onGrab: (playerId: string) => void;
  onDrop: (playerId: string) => void;
  onEndTurn: (playerId: string) => void;
  onRevert: (playerId: string) => void;
  onNewBoard: () => void;
  onFindRoom: (roomId: string) => void;
  onClaimPlayer: (playerId: string) => void;
  onStartGame: () => void;
  onLeaveOnline: () => void;
  onRetryClaim: () => void;
}

export interface GameViewOptions {
  mode: 'local' | 'online';
  myPlayerId?: string | null;
  revertEnabled?: Record<string, boolean>;
}

export type MessageKind = 'info' | 'error';

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
  const freeTestLabel = document.getElementById('freeTestLabel') as HTMLElement | null;
  const panels = document.getElementById('playerPanels') as HTMLElement | null;
  const turnLabel = el<HTMLParagraphElement>('turnLabel');
  const winnerBanner = el<HTMLDivElement>('winnerBanner');

  const joinStatusEl = el<HTMLParagraphElement>('joinStatus');
  const playerSelection = el<HTMLDivElement>('playerSelection');
  const playerSelect = el<HTMLSelectElement>('playerSelect');
  const claimPlayerBtn = el<HTMLButtonElement>('claimPlayerBtn');
  const retryClaimBtn = el<HTMLButtonElement>('retryClaimBtn');
  const findRoomBtn = el<HTMLButtonElement>('findRoomBtn');
  const roomIdInput = el<HTMLInputElement>('roomIdInput');

  const lobbyRoomId = el<HTMLElement>('lobbyRoomId');
  const lobbyYou = el<HTMLElement>('lobbyYou');
  const lobbyPlayers = el<HTMLDivElement>('lobbyPlayers');
  const lobbyStatus = el<HTMLParagraphElement>('lobbyStatus');
  const lobbyStartBtn = el<HTMLButtonElement>('lobbyStartBtn');
  const lobbyLeaveBtn = el<HTMLButtonElement>('lobbyLeaveBtn');

  let boundKey: string | null = null;
  let selectedPlayerId: string | null = null;
  let selectionRoom: RoomDoc | null = null;
  let busy = false;

  newBoardBtn.onclick = () => h.onNewBoard();
  findRoomBtn.onclick = () => h.onFindRoom(roomIdInput.value);
  roomIdInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') h.onFindRoom(roomIdInput.value);
  });
  retryClaimBtn.onclick = () => h.onRetryClaim();
  lobbyStartBtn.onclick = () => h.onStartGame();
  lobbyLeaveBtn.onclick = () => h.onLeaveOnline();

  playerSelect.onchange = () => {
    selectedPlayerId = playerSelect.value || null;
    syncClaimButton();
  };
  claimPlayerBtn.onclick = () => {
    if (!claimPlayerBtn.disabled && selectedPlayerId) h.onClaimPlayer(selectedPlayerId);
  };

  function syncClaimButton(): void {
    const room = selectionRoom;
    const selected = selectedPlayerId ? room?.state.players[selectedPlayerId] : undefined;
    const canClaim =
      !busy &&
      !!room &&
      room.state.status === 'lobby' &&
      !!selected &&
      !selected.joined;
    claimPlayerBtn.disabled = !canClaim;
    playerSelect.disabled = busy || !room || room.state.status !== 'lobby';
  }

  function setStatus(msg: string): void {
    statusEl.textContent = msg;
  }

  function showJoinStatus(msg: string, kind: MessageKind = 'info'): void {
    joinStatusEl.textContent = msg;
    joinStatusEl.classList.toggle('room-error', kind === 'error');
  }

  function setFindBusy(value: boolean): void {
    busy = value;
    findRoomBtn.disabled = value;
    roomIdInput.disabled = value;
    syncClaimButton();
  }

  function showRetryClaim(show: boolean): void {
    retryClaimBtn.hidden = !show;
  }

  function hidePlayerSelection(): void {
    playerSelection.hidden = true;
    selectionRoom = null;
    selectedPlayerId = null;
    playerSelect.innerHTML = '';
  }

  function showPlayerSelection(room: RoomDoc): void {
    selectionRoom = room;
    playerSelection.hidden = false;

    const ordered = Object.values(room.state.players).sort((a, b) => a.order - b.order);
    playerSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent =
      room.state.status === 'lobby' ? 'Select a player…' : 'Game already started';
    playerSelect.appendChild(placeholder);

    for (const player of ordered) {
      const option = document.createElement('option');
      option.value = player.id;
      option.textContent = `${player.id.toUpperCase()} — ${player.joined ? 'claimed' : 'open'}`;
      option.disabled = player.joined || room.state.status !== 'lobby';
      playerSelect.appendChild(option);
    }

    const current = selectedPlayerId ? room.state.players[selectedPlayerId] : undefined;
    if (
      room.state.status === 'lobby' &&
      current &&
      !current.joined &&
      selectedPlayerId
    ) {
      playerSelect.value = selectedPlayerId;
    } else {
      selectedPlayerId = null;
      playerSelect.value = '';
    }
    syncClaimButton();
  }

  function showLobby(room: RoomDoc, roomId: string, myPlayerId: string | null): void {
    lobbyRoomId.textContent = roomId;
    lobbyYou.textContent = myPlayerId
      ? `You are ${myPlayerId.toUpperCase()}.`
      : 'You have not claimed a slot.';

    const ordered = Object.values(room.state.players).sort((a, b) => a.order - b.order);
    lobbyPlayers.innerHTML = '';
    for (const player of ordered) {
      const row = document.createElement('div');
      row.className = `lobby-player ${player.joined ? 'joined' : 'open'}`;
      const name = document.createElement('strong');
      name.textContent = `${player.id.toUpperCase()} (${player.edge})`;
      const state = document.createElement('span');
      state.textContent = player.joined ? 'claimed' : 'open';
      if (myPlayerId === player.id) {
        const you = document.createElement('span');
        you.className = 'you-tag';
        you.textContent = ' you';
        name.appendChild(you);
      }
      row.append(name, state);
      lobbyPlayers.appendChild(row);
    }

    const allJoined = ordered.every((player) => player.joined);
    const isP1 = myPlayerId === 'p1';
    lobbyStartBtn.hidden = false;
    lobbyStartBtn.disabled = !(room.state.status === 'lobby' && isP1 && allJoined);

    if (room.state.status !== 'lobby') {
      lobbyStatus.textContent = 'Game already started.';
    } else if (!allJoined) {
      const joined = ordered.filter((player) => player.joined).length;
      lobbyStatus.textContent = `Waiting for players (${joined}/${ordered.length})…`;
    } else if (!isP1) {
      lobbyStatus.textContent = 'Waiting for P1 to start…';
    } else {
      lobbyStatus.textContent = 'All players joined. Ready to start.';
    }
  }

  function setLobbyStatus(msg: string): void {
    lobbyStatus.textContent = msg;
  }

  function resetOnline(): void {
    busy = false;
    findRoomBtn.disabled = false;
    roomIdInput.disabled = false;
    hidePlayerSelection();
    showRetryClaim(false);
    showJoinStatus('');
    lobbyPlayers.innerHTML = '';
    lobbyStatus.textContent = '';
  }

  function bindPanels(ids: string[], online: boolean): void {
    const key = `${online ? 'online' : 'local'}:${ids.join(',')}`;
    if (!panels || key === boundKey) return;
    boundKey = key;
    panels.innerHTML = '';

    for (const pid of ids) {
      const div = document.createElement('div');
      div.id = `${pid}panel`;
      div.className = 'player-panel';
      const strong = document.createElement('strong');
      strong.textContent = online ? `${pid.toUpperCase()} (you)` : pid.toUpperCase();
      div.appendChild(strong);

      const col = document.createElement('div');
      col.className = 'player-buttons';

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

      col.append(grab, drop, end);

      if (!online) {
        const revert = document.createElement('button');
        revert.id = `${pid}Revert`;
        revert.textContent = 'Revert';
        revert.title = 'Undo this turn (disabled after discovering a card)';
        revert.onclick = () => h.onRevert(pid);
        col.appendChild(revert);
      }

      const autoLabel = document.createElement('label');
      autoLabel.className = 'auto-grab';
      const auto = document.createElement('input');
      auto.type = 'checkbox';
      auto.id = `${pid}AutoGrab`;
      auto.checked = true;
      autoLabel.append(auto, document.createTextNode(' Auto grab'));
      col.appendChild(autoLabel);

      div.appendChild(col);
      panels.appendChild(div);
    }
  }

  function update(state: GameState | null, opts: GameViewOptions = { mode: 'local' }): void {
    const online = opts.mode === 'online';
    const myPlayerId = opts.myPlayerId ?? null;
    newBoardBtn.hidden = online;
    if (freeTestLabel) freeTestLabel.hidden = online;

    if (!state) {
      hud.style.display = 'none';
      winnerBanner.hidden = true;
      turnLabel.textContent = '';
      scores.innerHTML = '';
      boundKey = null;
      if (panels) panels.innerHTML = '';
      return;
    }

    hud.style.display = '';
    const ordered = Object.values(state.players).sort((a, b) => a.order - b.order);

    const panelIds = online
      ? state.status === 'running' && myPlayerId && state.players[myPlayerId]
        ? [myPlayerId]
        : []
      : ordered.map((player) => player.id);
    bindPanels(panelIds, online);

    const collected = ordered.reduce((sum, player) => sum + player.score, 0);
    const left = Math.max(0, state.totalCoins - collected);
    scores.innerHTML = '';
    for (const player of ordered) {
      const row = document.createElement('div');
      const isCurrent = player.id === state.currentTurn && state.status !== 'finished';
      const isWinner = state.status === 'finished' && state.winner === player.id;
      row.className = `score-row${isCurrent ? ' current' : ''}${isWinner ? ' score-winner' : ''}`;
      row.textContent = `● ${player.id.toUpperCase()} — ${player.score} coin${
        player.score === 1 ? '' : 's'
      }${isCurrent ? ' (current turn ◀)' : ''}${isWinner ? ' (winner)' : ''}`;
      scores.appendChild(row);
    }
    const total = document.createElement('div');
    total.className = 'score-total';
    total.textContent = `Total: ${collected}/${state.totalCoins} collected, ${left} left`;
    scores.appendChild(total);

    if (state.status === 'finished') {
      winnerBanner.hidden = false;
      if (state.winner === 'tie') {
        winnerBanner.textContent = 'Tie game!';
        winnerBanner.className = 'winner-banner tie';
      } else if (state.winner && state.players[state.winner]) {
        winnerBanner.textContent = `${state.winner.toUpperCase()} wins!`;
        winnerBanner.className = 'winner-banner win';
      } else {
        winnerBanner.textContent = 'Game finished';
        winnerBanner.className = 'winner-banner';
      }
    } else {
      winnerBanner.hidden = true;
    }

    if (state.status === 'finished') {
      turnLabel.textContent = 'Game finished';
    } else if (online) {
      if (myPlayerId && state.currentTurn === myPlayerId) {
        turnLabel.textContent = 'Your turn';
      } else if (state.currentTurn) {
        turnLabel.textContent = `Waiting for ${state.currentTurn.toUpperCase()}…`;
      } else {
        turnLabel.textContent = 'Waiting…';
      }
    } else {
      turnLabel.textContent = state.currentTurn
        ? `${state.currentTurn.toUpperCase()}'s turn`
        : 'Waiting…';
    }

    if (opts.revertEnabled) {
      for (const player of ordered) {
        const button = document.getElementById(`${player.id}Revert`) as HTMLButtonElement | null;
        if (button) button.disabled = !opts.revertEnabled[player.id];
      }
    }
  }

  return {
    setStatus,
    update,
    showJoinStatus,
    showPlayerSelection,
    hidePlayerSelection,
    showRetryClaim,
    setFindBusy,
    resetOnline,
    showLobby,
    setLobbyStatus,
  };
}
