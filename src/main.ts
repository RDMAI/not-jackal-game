import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import './style.css';

// 0 = green, 1 = blue
type CellValue = 0 | 1;
type BoardState = CellValue[][];

interface RoomData {
  board_state?: BoardState | null;
  board_size_x?: number;
  board_size_y?: number;
  [key: string]: unknown;
}

const firebaseConfig = {
  apiKey: 'AIzaSyARAjRjKBpRP9h1hIccJ_n1iqbON-vaHgs',
  authDomain: 'family-board-games-54639.firebaseapp.com',
  projectId: 'family-board-games-54639',
  storageBucket: 'family-board-games-54639.firebasestorage.app',
  messagingSenderId: '557276950036',
  appId: '1:557276950036:web:edac4d1cafc69480970101',
  databaseURL:
    'https://family-board-games-54639-default-rtdb.europe-west1.firebasedatabase.app/',
};

const app = initializeApp(firebaseConfig);
const db: Database = getDatabase(app);

let gridState: BoardState = [];
let cells: HTMLTableCellElement[][] = [];
let currentRoomId: string | null = null;
let unsubscribe: Unsubscribe | null = null;

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: #${id}`);
  }
  return el as T;
}

const table = getElement<HTMLTableElement>('grid');
const sendBtn = getElement<HTMLButtonElement>('sendBtn');
const statusEl = getElement<HTMLParagraphElement>('status');
const changesField = getElement<HTMLTextAreaElement>('changes');
const roomError = getElement<HTMLParagraphElement>('roomError');
const roomIdInput = getElement<HTMLInputElement>('roomIdInput');
const joinBtn = getElement<HTMLButtonElement>('joinBtn');

function normalizeCell(value: unknown): CellValue {
  return value === 1 ? 1 : 0;
}

function buildBoard(rows: number, cols: number, initial?: BoardState | null): void {
  table.innerHTML = '';
  cells = [];
  gridState = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => normalizeCell(initial?.[r]?.[c])),
  );

  for (let r = 0; r < rows; r++) {
    const tr = document.createElement('tr');
    const rowCells: HTMLTableCellElement[] = [];
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      if (gridState[r][c] === 1) {
        td.classList.add('blue');
      }
      td.addEventListener('click', () => {
        gridState[r][c] = gridState[r][c] === 0 ? 1 : 0;
        td.classList.toggle('blue', gridState[r][c] === 1);
      });
      tr.appendChild(td);
      rowCells.push(td);
    }
    table.appendChild(tr);
    cells.push(rowCells);
  }
}

function renderBoard(): void {
  for (let r = 0; r < gridState.length; r++) {
    for (let c = 0; c < gridState[r].length; c++) {
      cells[r][c].classList.toggle('blue', gridState[r][c] === 1);
    }
  }
}

function setBoardVisible(visible: boolean): void {
  const display = visible ? '' : 'none';
  table.style.display = display;
  sendBtn.style.display = display;
  statusEl.style.display = display;
  changesField.style.display = display;
}

function subscribeToRoom(roomId: string): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const boardRef = ref(db, `rooms/${roomId}/board_state`);
  unsubscribe = onValue(boardRef, (snapshot) => {
    const remote = snapshot.val() as BoardState | null;
    if (!remote) return;

    const diffs: string[] = [];
    for (let r = 0; r < remote.length; r++) {
      for (let c = 0; c < (remote[r]?.length ?? 0); c++) {
        const localVal: CellValue = gridState[r]?.[c] ?? 0;
        const remoteVal: CellValue = normalizeCell(remote[r]?.[c]);
        if (localVal !== remoteVal) {
          diffs.push(`[${r},${c}]: ${localVal} -> ${remoteVal}`);
        }
      }
    }

    if (diffs.length > 0) {
      changesField.value += (changesField.value ? '\n' : '') + diffs.join('\n');
      changesField.scrollTop = changesField.scrollHeight;
    }

    // Resize if remote size differs
    if (
      remote.length !== gridState.length ||
      (remote[0]?.length ?? 0) !== (gridState[0]?.length ?? 0)
    ) {
      buildBoard(remote.length, remote[0].length, remote);
    } else {
      for (let r = 0; r < remote.length; r++) {
        for (let c = 0; c < remote[r].length; c++) {
          gridState[r][c] = normalizeCell(remote[r][c]);
        }
      }
      renderBoard();
    }
  });
}

joinBtn.addEventListener('click', async () => {
  const roomId = roomIdInput.value.trim();
  if (!roomId) {
    roomError.textContent = 'invalid id';
    setBoardVisible(false);
    return;
  }

  try {
    const roomSnap = await get(ref(db, `rooms/${roomId}`));
    const room = roomSnap.val() as RoomData | null;
    if (!roomSnap.exists() || room?.board_state == null) {
      roomError.textContent = 'invalid id';
      setBoardVisible(false);
      return;
    }

    const boardState = room.board_state as BoardState;
    const sizeY = room.board_size_y ?? boardState.length;
    const sizeX = room.board_size_x ?? boardState[0].length;

    currentRoomId = roomId;
    roomError.textContent = '';
    changesField.value = '';
    statusEl.textContent = '';
    buildBoard(sizeY, sizeX, boardState);
    setBoardVisible(true);
    subscribeToRoom(roomId);
  } catch (e) {
    console.error(e);
    roomError.textContent = 'invalid id';
    setBoardVisible(false);
  }
});

sendBtn.addEventListener('click', async () => {
  if (!currentRoomId) return;
  try {
    await set(ref(db, `rooms/${currentRoomId}/board_state`), gridState);
    statusEl.textContent = 'Board sent!';
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Failed: ${(e as Error).message}`;
  }
});
