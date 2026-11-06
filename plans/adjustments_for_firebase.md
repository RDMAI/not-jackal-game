# Plan: Firebase room integration and lobby flow

Status: implemented on 2026-11-06. Core, Firebase net layer, UI/lobby flow, room script, and tests are complete. Live Firebase and two-browser verification remain manual.

## Decisions applied

### Original decisions

- Reuse the old Firebase project configuration from commit `3bf00b6` (`family-board-games-54639`).
- Split the room document into `config` and `state`; keep `version` at the room root.
- Keep player ids `p1`, `p2`, etc.
- `Player.joined` means **slot claimed**, not online presence.
- Store the local player mapping per room:
  `localStorage["not-jackal:room:<roomId>"] = "p1" | "p2" | ...`
- Joining a slot and starting the game are Firebase transactions.
- Rooms are created manually by merging the room script's `{ "<roomId>": roomDoc }` output into an exported Firebase JSON and re-importing it. No client-side room creation flow.
- The room generation script is plain JavaScript (`scripts/create-room.mjs`), not TypeScript.
- `p1` starts the game. Start is disabled for everyone else.
- Start requires all player slots to have `joined: true`.
- There is no player-1 admin UI for releasing slots; stale slots are cleared manually in Firebase.
- Mid-game new joins are not supported. Reconnect works through the saved local mapping.
- Ties are represented as `winner: "tie"`.
- Keep the existing local hot-seat mode working.
- No anti-cheat, presence tracking, rematch flow, or security rules in this iteration.

### Interview decisions

- **Claims are lobby-only.** `claimPlayer` rejects rooms whose status is `running` or `finished`.
- **Dedicated lobby view.** Add a `lobbyView`; the flow is menu → find/claim → lobby → game view.
- **Online leave.** Quitting to the menu or leaving the lobby unsubscribes and keeps the saved mapping. Starting a local game while online also unsubscribes and keeps the mapping.
- **Strict room loading.** Require `version === 1` and a valid `config`/`state`. Missing or empty `players`, `pieces`, or `cards` is corrupt. Only RTDB-omitted nullable fields plus `turnsPassed`, `joined`, and card `coinsOnGround` are defaulted.
- **Typed load results.** Distinguish `not-found`, `unsupported`, and `network` errors with distinct UI messages.
- **Lobby API.** `claimPlayer`, `validateStart`, and `startLobby` return result objects. `createLobbyState` throws on an invalid config.
- **Comprehensive `validateStart`.** Check turn/status fields, player/edge/order/ship validity, card cells and types, pieces per player, ownership, ship positions, and `maxPlayers`.
- **Live player selection.** Subscribe on “Find room”, before claiming, so joined slots and start state update in real time and claim races are visible.
- **Stale mapping.** If the mapped player no longer exists, clear the mapping and fall back. If the slot is unjoined in a lobby, auto-claim it. If the slot is unjoined in a running/finished room, clear the mapping and fall back.
- **Auto-claim failure.** On a logical conflict (slot already joined, unknown player, room no longer lobby), clear the mapping and show player selection. On a network error, keep the mapping and offer retry.
- **Online input.** `GameScene` only accepts interaction from the local player, only on that player's turn, and not when the game is finished.
- **Online panels.** Show the local player's action panel only; the scoreboard still lists every player.
- **Winner/tie banner.** Render it in both local and online game views.
- **Turn label.** Show `Your turn` / `Waiting for P2…` / `Game finished` online, and an equivalent current-player message locally.
- **`turnsPassed`.** Persist and increment it, but do not display it this iteration.
- **Error messages.** Show specific transaction/validation reasons.
- **Room loss.** If a subscribed room is deleted or a read/subscription fails, show the error, unsubscribe, return to the menu, and keep the mapping.
- **Room script output.** Emit a single map entry `{ "<roomId>": roomDoc }` for manual merge into an exported Firebase JSON. `--id` is the map key; a random UUID is generated when omitted.
- **Script validation.** Mirror `validateConfig`: field size 3–9, integer non-negative counts, counts sum to the number of cells, 2–4 unique valid edges, and duplicate-edge rejection.
- **Room id validation.** Trim; reject empty ids and ids containing `/`, `.`, `#`, `$`, `[`, or `]`. Use the same rule in the client and script.
- **Tie condition.** A tie is only possible when all coins have been collected (the current `checkWin` condition).
- **Script test.** Add a smoke test that runs the script and validates the generated room.
- **Normalizer test.** Extract `normalizeRoomDoc` as a pure function and unit-test it.
- **Multiple tabs.** Accepted limitation: tabs in the same browser share the mapping and act as the same player. No tab guard in this iteration.

## Current state inspected

- `src/core/types.ts`: `Player`, `GameState`, `Action`, `GameConfig`.
- `src/core/setup.ts`: `createInitialState`, `createStateFromConfig`, `generateCards`, `shipCellFor`, `validateConfig`.
- `src/core/rules.ts`: `validateMove`, `applyMove`, `checkWin`.
- `src/main.ts`: local hot-seat wiring; `showView` only knows `menu | settings | game`; `ui` and Phaser are created together inside `ensureGame`.
- `src/ui.ts`: local player panels, score rendering, status. It does not write `#turnLabel`.
- `src/game/GameScene.ts`: Phaser rendering and click handling. It passes `currentTurn` to `onAction` and has no online interaction restriction.
- `index.html`: menu, settings, game layout.
- `src/rules.test.ts`: existing setup/rules tests.
- `package.json`: `firebase` already installed; no Firebase code currently present.
- There is no `src/net/` directory anymore.
- `docs/rtdb_schema.json` is only the old schema reference and is ignored by git.

## Target room document

```json
{
  "rooms": {
    "<roomId>": {
      "version": 1,
      "config": {
        "fieldSizeX": 5,
        "fieldSizeY": 5,
        "deckCounts": {
          "empty": 11,
          "arrow_0_4": 2,
          "arrow_1_5": 2,
          "arrow_1_3_5_7": 1,
          "chest_3": 4,
          "trap_2": 3,
          "trap_3": 2
        },
        "edges": ["north", "south"]
      },
      "state": {
        "fieldSizeX": 5,
        "fieldSizeY": 5,
        "status": "lobby",
        "currentTurn": "",
        "totalCoins": 12,
        "maxPlayers": 2,
        "moved": false,
        "pendingArrow": null,
        "turnsPassed": 0,
        "winner": null,
        "lastMove": null,
        "players": {
          "p1": { "id": "p1", "edge": "north", "shipPos": 2, "order": 0, "score": 0, "joined": false },
          "p2": { "id": "p2", "edge": "south", "shipPos": 2, "order": 1, "score": 0, "joined": false }
        },
        "pieces": {
          "p1_0": { "id": "p1_0", "playerId": "p1", "x": 2, "y": -1, "onShip": true, "carrying": false, "trapStep": 0 }
        },
        "cards": {
          "0_0": { "type": "chest_3", "faceUp": false, "coinsOnGround": 0 }
        }
      }
    }
  }
}
```

`players`, `pieces`, and `cards` are abbreviated above. A real 5x5 lobby contains 2 players, 6 pieces, and 25 cards.

Important Firebase behavior:

- RTDB does not store `null`. Missing `pendingArrow`, `lastMove`, and `winner` must be defaulted by the client.
- A generated room always has non-empty `players`, `pieces`, and `cards`. Under strict loading, a room with missing or empty collections is treated as corrupt rather than defaulted to `{}`.
- RTDB may omit missing `joined`, `turnsPassed`, and card `coinsOnGround` fields from older or hand-edited rooms. Those, plus the nullable fields above, are the only normalization defaults.
- The room script emits a map keyed by room id, not the root `rooms` wrapper:
  `{ "<roomId>": { "version": 1, "config": { ... }, "state": { ... } } }`.

## Data model changes

### `src/core/types.ts`

- Add to `Player`:
  ```ts
  joined: boolean;
  ```
- Add to `GameState`:
  ```ts
  turnsPassed: number;
  ```
- Add a room document type:
  ```ts
  export interface RoomDoc {
    version: number;
    config: GameConfig;
    state: GameState;
  }
  ```
- Document that `winner: "tie"` is a valid sentinel in addition to a player id.
- Add a shared room version constant, e.g. `ROOM_VERSION = 1`, or keep it in `src/core/lobby.ts` and import it from the normalizer. Do not duplicate the literal in multiple client modules.

### `src/core/roomId.ts` (new)

Add a pure helper used by both the UI and the net layer:

```ts
export function isValidRoomId(id: string): boolean;
```

Rules:

- Trim the input before validating.
- Reject empty ids.
- Reject ids containing `/`, `.`, `#`, `$`, `[`, or `]`.
- Preserve case; do not lowercase.
- The script duplicates the same rule because it cannot import TypeScript.

### `src/core/lobby.ts` (new)

Add pure, testable functions with no Firebase imports.

Result types:

```ts
export type LobbyResult<T> =
  | { ok: true; state: T }
  | { ok: false; reason: string };
```

Functions:

- `createLobbyState(config, rand)`:
  - calls `validateConfig` and **throws** on an invalid config;
  - player ids `p1..pN` from `config.edges` order;
  - every player has `joined: false`, `score: 0`, the edge from the config, `order` index, and `shipPos = Math.floor(along / 2)`;
  - 3 pieces per player, all `onShip: true`, positioned with `shipCellFor`;
  - cards generated from `deckCounts`, all face-down with `coinsOnGround: 0`;
  - `status: "lobby"`, `currentTurn: ""`, `moved: false`, `pendingArrow: null`, `lastMove: null`, `winner: null`, `turnsPassed: 0`;
  - `totalCoins` derived from `chest_3` count × 3;
  - `maxPlayers = config.edges.length`.
- `createRoomDoc(config, rand)`:
  - returns `{ version: ROOM_VERSION, config, state: createLobbyState(config, rand) }`.
- `claimPlayer(state, playerId): LobbyResult<GameState>`:
  - rejects unless `state.status === 'lobby'`;
  - rejects unknown player or already joined player;
  - rejects missing/empty player collections;
  - returns a copy with `players[playerId].joined = true`.
- `validateStart(state, byPlayerId): Validation`:
  - `status === 'lobby'`;
  - `byPlayerId === 'p1'`;
  - `currentTurn === ''`, `moved === false`, `pendingArrow === null`, `lastMove === null`, `winner === null`, `turnsPassed === 0`;
  - `players` is non-empty and every player has `joined: true`;
  - player keys match `player.id`; every `edge` is valid; every `order` is a unique integer covering `0..n-1`; every `shipPos` is an integer within the edge length; every `score` is a number `>= 0`;
  - `maxPlayers === Object.keys(players).length`;
  - `fieldSizeX` and `fieldSizeY` are integers in `3..9`;
  - `cards` count equals `fieldSizeX * fieldSizeY`; every key is a valid `x_y` field cell; every card type is in `CARD_TYPES`; `faceUp` is boolean and `coinsOnGround` is a number `>= 0`;
  - `pieces` count equals `3 * players count`; each player has exactly 3 pieces named `${playerId}_0..2`; every `playerId` exists; every piece is `onShip: true`, `carrying: false`, `trapStep: 0`, and at that player's `shipCellFor` position;
  - `totalCoins` is an integer `>= 0`.
- `startLobby(state, byPlayerId): LobbyResult<GameState>`:
  - calls `validateStart`;
  - on failure returns `{ ok: false, reason }`;
  - returns a copy with:
    - `status: "running"`;
    - `currentTurn` = first player by `order`;
    - `moved: false`;
    - `pendingArrow: null`;
    - `lastMove: null`;
    - `winner: null`;
    - `turnsPassed: 0`;
  - does not regenerate or clear cards/pieces.

### `src/core/setup.ts`

- Add `joined: true` to players created by `createInitialState` / `createStateFromConfig` so local hot-seat keeps working.
- Add `turnsPassed: 0` to all created states.
- Reuse existing `shipCellFor`, `generateCards`, `buildDeckFromCounts`, and `validateConfig`.
- Do not change the local game’s default running-state behavior.

### `src/core/rules.ts`

- On a successful `endTurn`, increment `turnsPassed`.
- Update `checkWin` for ties:
  ```ts
  const maxScore = Math.max(...Object.values(next.players).map((p) => p.score));
  const winners = Object.values(next.players).filter((p) => p.score === maxScore);
  next.winner = winners.length > 1 ? "tie" : winners[0].id;
  ```
- Keep the current game-end condition: the game finishes only when all coins have been collected (`scored >= totalCoins`). A tie is therefore only possible at that point.
- Keep `validateMove` rejecting `lobby` and `finished` states.
- Keep `joined` out of gameplay rules. It is lobby metadata only.

## Phase 2: Firebase net layer

### `src/net/firebase.ts` (new)

- Restore the old Firebase project config from commit `3bf00b6`.
- Lazy-initialize `initializeApp` / `getDatabase`.
- Avoid duplicate-app errors under HMR by reusing an existing app (`getApps()` / `getApp()`) or caching the module-level app.
- Export `getDb()`.
- No admin credentials or server-side code.

### `src/net/normalize.ts` (new)

Keep this pure and free of Firebase imports so it can be unit-tested.

```ts
export type NormalizeResult =
  | { ok: true; room: RoomDoc }
  | { ok: false; reason: string };

export function normalizeRoomDoc(raw: unknown): NormalizeResult;
```

Rules:

- `raw` must be a non-array object.
- `version` must be exactly `1`.
- `config` must be present and pass `validateConfig`.
- `state` must be present and have:
  - matching `fieldSizeX`/`fieldSizeY`;
  - `status` in `lobby | running | finished`;
  - non-empty object collections for `players`, `pieces`, and `cards`;
  - numeric `totalCoins`, `maxPlayers`, and `turnsPassed`;
  - boolean `moved`;
  - string `currentTurn`;
  - `pendingArrow` as `null` or an object;
  - `lastMove` as `null` or an object;
  - `winner` as `null`, `"tie"`, or a player id string.
- Default only these RTDB-omitted values:
  - missing `pendingArrow`, `lastMove`, `winner` → `null`;
  - missing `turnsPassed` → `0`;
  - missing `joined` → `true` for `running`/`finished`, `false` for `lobby`;
  - missing card `coinsOnGround` → `0`.
- Do **not** default missing or empty `players`, `pieces`, or `cards`; return `{ ok: false, reason }`.
- Return a normalized deep copy; do not mutate `raw`.

### `src/net/room.ts` (new)

Use `firebase/database` (`get`, `onValue`, `ref`, `runTransaction`, type `Unsubscribe`).

Types:

```ts
export type RoomLoadErrorKind = 'not-found' | 'unsupported' | 'network';

export type RoomLoadResult =
  | { ok: true; room: RoomDoc }
  | { ok: false; kind: RoomLoadErrorKind; reason: string };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: string; kind?: 'conflict' | 'network' };
```

Functions:

- `roomRef(roomId)` → `ref(getDb(), "rooms/" + roomId)`.
  - Assert/validate the room id before building the path.
- `fetchRoom(roomId): Promise<RoomLoadResult>`:
  - missing snapshot → `{ ok: false, kind: 'not-found', ... }`;
  - normalization failure → `{ ok: false, kind: 'unsupported', ... }`;
  - thrown Firebase/network error → `{ ok: false, kind: 'network', ... }`.
- `subscribeRoom(roomId, cb: (result: RoomLoadResult) => void): Unsubscribe`:
  - `onValue` next callback maps through `normalizeRoomDoc`;
  - `null` snapshot → `not-found`;
  - `onValue` error callback → `network`.
- `claimPlayer(roomId, playerId): Promise<WriteResult>`:
  - transaction on `rooms/{roomId}/state`;
  - abort if room is missing, status is not `lobby`, player is missing, or player is already joined;
  - use `claimPlayer` from `src/core/lobby.ts`;
  - return state with `players[playerId].joined = true` on success;
  - capture the pure rejection reason before returning `undefined` from the transaction updater;
  - logical rejection → `kind: 'conflict'`; thrown Firebase/network error → `kind: 'network'`.
- `startGame(roomId, byPlayerId): Promise<WriteResult>`:
  - transaction on `rooms/{roomId}/state`;
  - use `startLobby` from `src/core/lobby.ts`;
  - abort with a specific reason when validation fails;
  - logical rejection → `kind: 'conflict'`; thrown Firebase/network error → `kind: 'network'`.
- `submitAction(roomId, playerId, action): Promise<WriteResult>`:
  - transaction on `rooms/{roomId}/state`;
  - `validateMove` then `applyMove`;
  - abort with the validation reason when invalid;
  - logical rejection → `kind: 'conflict'`; thrown Firebase/network error → `kind: 'network'`.
- Local mapping helpers:
  - `getSavedPlayerId(roomId): string | null`;
  - `savePlayerId(roomId, playerId): void`;
  - `clearSavedPlayerId(roomId): void`;
  - keys use `not-jackal:room:<roomId>`;
  - storage access should be best-effort and must not crash the app if `localStorage` is unavailable.

Notes:

- All writes are transactions on the full `state` node. The state is small and this keeps player claiming, starting, and actions atomic.
- `config` is immutable after room creation and is not part of action transactions.
- No client-side room creation function is needed.
- For transaction rejections, use a closure variable inside the update function to preserve the specific validation reason, then translate `committed === false` into a `conflict` result. Do not collapse every failure into a generic message.

## Phase 3: UI and application flow

### `index.html`

- Keep the existing menu, local settings, and game views.
- Add a dedicated lobby view:
  - room id;
  - player list with joined/not-joined state;
  - Start button, enabled only when the local player is `p1` and all slots are joined;
  - Leave button;
  - clear status/hint text while waiting.
- Rework the Join pane:
  - room id input;
  - “Find room” button;
  - typed error/status line;
  - live player selection panel with a `<select>` for `p1..pN`;
  - options for players with `joined: true` are disabled;
  - confirm button, disabled when nothing valid is selected or when the room is no longer in `lobby`.
- Add a winner/tie banner to the game view.
- In online mode, hide local-only controls: `New board`, `Free test`, and `Revert`.
- Add a retry affordance for a network failure while auto-claiming a saved slot.

### `src/main.ts`

- Introduce mode: `"local" | "online"`.
- Mount `ui.ts` once during boot, before any Phaser game exists, so the Join pane and lobby can render without creating the board.
- Change `showView` to support `menu | settings | lobby | game`.
- Make `ensureGame()` create/activate Phaser only; do not mount the DOM overlay there.
- Preserve the existing local mode flow.
- Online join flow:
  1. Trim and validate the room id with `isValidRoomId`.
  2. Unsubscribe any previous room subscription.
  3. Set `mode = 'online'`.
  4. `subscribeRoom(roomId, cb)` immediately; the subscription is the source of truth for the selection panel, lobby, and game.
  5. On `not-found`, show “room not found” and unsubscribe.
  6. On `unsupported`, show “unsupported or corrupt room” and unsubscribe.
  7. On `network`, show the error and allow retry.
  8. If a saved mapping exists:
     - player missing → clear the mapping and continue as if there was no mapping;
     - player exists and `joined` → reconnect (lobby/game/finished);
     - player exists, `joined: false`, and status `lobby` → auto-claim; on conflict clear the mapping and show selection, on network keep the mapping and offer retry;
     - player exists, `joined: false`, and status `running`/`finished` → clear the mapping and fall back.
  9. If no mapping and status `lobby` → show live player selection.
  10. If no mapping and status `running`/`finished` → show “game already started”.
  11. On successful claim, save the mapping and stay subscribed; do not subscribe a second time.
- Subscription handling:
  - store the latest `RoomDoc` and `myPlayerId`;
  - `lobby` → show `lobbyView`, do not create/activate the Phaser board;
  - `running` → ensure Phaser is initialized, switch to `gameView`, and render the board;
  - `finished` → render the frozen board and show winner/tie;
  - if a previously present room becomes `not-found` or `network`, show the error, unsubscribe, return to the menu, and keep the mapping.
- If the room starts while the user is still on the player selection panel, replace the selection with “game already started” and disable confirm.
- `doAction`:
  - local mode → current local validate/apply behavior;
  - online mode → always use `myPlayerId`, never the player id supplied by UI or `GameScene`;
  - online mode → call `submitAction` and wait for the subscription update;
  - show specific transaction rejection reasons.
- Start button → `startGame(roomId, myPlayerId)`.
- Leaving:
  - `Leave`/`Quit to menu` in online mode → unsubscribe, return to `menu` or `settings`, keep the mapping;
  - starting a local game while online → unsubscribe first, then continue with the local flow;
  - local mode quit → just show the menu.
- Releasing a player slot is not in the UI. Use the Firebase console manually.
- Keep `onNewBoard`/`onRevert` local-only.
- Do not create or activate Phaser while the room is in `lobby`.

### `src/ui.ts`

- Extend `UIHandlers` with:
  - `onFindRoom: (roomId: string) => void`;
  - `onClaimPlayer: (playerId: string) => void`;
  - `onStartGame: () => void`;
  - `onLeaveOnline: () => void`;
  - `onRetryClaim: () => void` (only needed for the network auto-claim path).
- Add rendering paths:
  - join/find error state;
  - live player selection with disabled joined options;
  - lobby player list with joined state;
  - Start button enabled only for `p1` when all joined;
  - status/hints, including “waiting for players”, “waiting for p1 to start”, and “game already started”.
- `mountUI` must be callable before Phaser exists; handlers that need the scene should guard against `scene() === null`.
- In online mode, render action controls only for `myPlayerId`. The scoreboard still lists every player.
- In local mode, keep all existing hot-seat panels and controls.
- Write `#turnLabel`:
  - local: current player's turn / game finished;
  - online: `Your turn` / `Waiting for P2…` / `Game finished`.
- Handle `winner === "tie"` without looking up `players["tie"]`.
- Render the winner/tie banner in both local and online modes.
- Hide `Revert` in online panels.

### `src/game/GameScene.ts`

- Add a local-player/online context setter, e.g. `setOnlinePlayerId(playerId: string | null)`.
  - `null` means local hot-seat and keeps the current behavior.
  - A non-null id means online mode.
- In online mode, ignore interaction when:
  - the game is not `running`;
  - it is not the local player's turn;
  - the clicked piece belongs to another player.
- Keep `onAction` as-is; `main.ts` still ignores the supplied player id online and uses `myPlayerId`.
- Do not activate the scene while status is `lobby`.
- Keep the existing rendering and selection logic; no core rewrite.

### `src/style.css`

- Add styles for:
  - player selection;
  - lobby player list;
  - disabled Start/Confirm buttons;
  - winner/tie banner;
  - typed room errors;
  - online-only HUD states.

## Phase 4: JavaScript room creation script

### `scripts/create-room.mjs` (new)

Plain Node.js ESM, no TypeScript build dependency and no new npm dependency.

Behavior:

- Accepts:
  - `--id <guid>`: optional; generate a random UUID (`crypto.randomUUID()`) when omitted; used as the map key;
  - `--config <path>`: optional JSON `GameConfig`; otherwise use the default 5x5 config;
  - `--out <path>`: optional output file; otherwise print to stdout.
- Builds a complete room document and emits a map keyed by room id:
  ```json
  {
    "<roomId>": {
      "version": 1,
      "config": { "...": "..." },
      "state": { "...": "..." }
    }
  }
  ```
- Validates the room id with the same rule as `src/core/roomId.ts`:
  - trimmed, non-empty, and no `/`, `.`, `#`, `$`, `[`, or `]`.
- Implements standalone JS equivalents of:
  - full config validation mirroring `validateConfig`: field size 3–9, integer non-negative counts, counts sum to field cells, 2–4 unique valid edges, duplicate-edge rejection;
  - edge order;
  - sea-ring `shipCellFor`;
  - shuffled card generation;
  - lobby state generation with `p1..pN`, all `joined: false`;
  - pieces on ships;
  - `totalCoins = chest_3 count × 3`.
- Adds a comment that default config/deck constants must stay in sync with `src/core/setup.ts`.
- Does not write to Firebase. The output is manually merged into an exported Firebase JSON, then re-imported.
- Exits non-zero with a clear stderr message for invalid ids, invalid configs, unreadable config files, or write failures.

### `package.json`

Add:

```json
"room:create": "node scripts/create-room.mjs"
```

No `tsx` or other script runner dependency is needed.

## Phase 5: Tests and verification

### Unit tests

Add `src/lobby.test.ts`:

- `createLobbyState`:
  - status is `lobby`;
  - all players `joined: false`;
  - 3 pieces per player;
  - correct number of cards;
  - all cards face-down with `coinsOnGround: 0`;
  - `turnsPassed: 0`;
  - throws on an invalid config.
- `claimPlayer`:
  - sets only the requested player to joined;
  - rejects already joined, unknown, and non-lobby states.
- `validateStart` / `startLobby`:
  - rejects non-`p1`;
  - rejects when any player is not joined;
  - rejects wrong status;
  - rejects corrupt card/piece collections;
  - starts with `currentTurn` = first player by order;
  - preserves cards/pieces.
- `turnsPassed`:
  - increments once per successful `endTurn`;
  - starts at 0.
- `checkWin`:
  - unique highest score → player id;
  - equal highest scores → `"tie"`.
- Existing local setup/config tests still pass with `joined: true` and `turnsPassed: 0`.
- Optionally cover `isValidRoomId` in the same file or a small `src/core/roomId.test.ts`.

Add `src/net/normalize.test.ts`:

- valid room fixture normalizes;
- missing `pendingArrow`, `lastMove`, `winner` default to `null`;
- missing `turnsPassed` defaults to `0`;
- missing `joined` defaults based on status;
- missing card `coinsOnGround` defaults to `0`;
- missing/empty `players`, `pieces`, or `cards` is rejected as unsupported;
- missing/wrong `version` is rejected;
- invalid `config` is rejected.

Add `scripts/create-room.test.mjs`:

- spawns `node scripts/create-room.mjs --id test-room --out <tmpfile>`;
- parses the output;
- asserts the top-level key is `test-room`;
- asserts `version === 1`;
- asserts the config validates and the state has the expected player/piece/card counts and `totalCoins`;
- asserts an invalid room id or invalid config exits non-zero.

The `.mjs` test keeps Node-only imports out of `tsc`’s `src` include while still running under Vitest.

### Commands

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run room:create -- --id test-room`
- `npm run room:create -- --id test-room --out test-room.json`

### Manual two-browser test

1. Run the room script and merge its `{ "<roomId>": roomDoc }` output into an exported Firebase JSON, then re-import it.
2. Browser A opens the Join page, finds the room, selects `p1`.
3. Browser B (a different browser, not a tab in the same browser) finds the room, sees `p1` disabled, selects `p2`.
4. Refresh Browser B and confirm it reconnects to `p2` via localStorage.
5. Confirm Browser B sees Start disabled and Browser A can start.
6. Start the game; verify the board appears only after `running`.
7. Play a few turns; verify a player cannot act out of turn or as another player, and cannot select opponent pieces.
8. Refresh during `running`; verify reconnection.
9. Finish the game or manually set scores to force a tie; verify the `"tie"` banner.
10. Verify local hot-seat mode still works and shows the winner/tie banner.
11. Delete the room in Firebase while in the lobby or game; verify the client shows an error, unsubscribes, and returns to the menu while keeping the mapping.
12. Clear a slot's `joined` flag manually in a lobby; verify the mapped browser auto-claims it.
13. Set a slot unjoined in a running room; verify a mapped browser does not claim it, clears the stale mapping, and shows “game already started”.
14. Confirm two tabs in the same browser act as the same player (accepted limitation).

## Files expected to change

- `src/core/types.ts`
- `src/core/roomId.ts` (new)
- `src/core/lobby.ts` (new)
- `src/core/setup.ts`
- `src/core/rules.ts`
- `src/net/firebase.ts` (new)
- `src/net/normalize.ts` (new)
- `src/net/room.ts` (new)
- `src/main.ts`
- `src/ui.ts`
- `src/game/GameScene.ts`
- `index.html`
- `src/style.css`
- `scripts/create-room.mjs` (new)
- `scripts/create-room.test.mjs` (new)
- `package.json`
- `src/lobby.test.ts` (new)
- `src/net/normalize.test.ts` (new)
- `src/rules.test.ts` (update existing tests)

## Out of scope

- Firebase security rules or anti-cheat.
- `onDisconnect` / presence tracking.
- Player-slot release UI.
- Host transfer.
- Mid-game spectators or new players.
- Rematch/reset flow.
- Firebase emulator integration tests.
- Hidden-card secrecy before Start.
- Random per-room player keys; player keys remain `p1..pN`.
- A guard against multiple tabs in the same browser; tabs share the mapping and act as the same player.
