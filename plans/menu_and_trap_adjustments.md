# Plan: game menu + configurable local game + multistep traps

## 0. Current state (inspected)

* `src/core/types.ts:8-31` — `CardType` (`empty`/`arrow_*`/`chest_3`/`trap_2`/`trap_3`), `Card{type,faceUp,coinsOnGround}`, `Piece{onShip,carrying,stuck:number}`. `GameState:50-67` has `fieldSizeX/Y, moved, pendingArrow`, no screen/menu state.
* `src/core/rules.ts:41-46,150-195,288-319,358-390` — `parseTrapCost()`, `stuck>0` blocks `movePiece`/`grab`, `applyMove(movePiece)` sets `stuck=trapCost`, `applyMove(endTurn)` ticks `stuck-1` for all own pieces every own turn.
* `src/core/setup.ts:4-21,54-120` — hardcoded `FIELD_SIZE=5`, `buildTestDeck()` fixed 4/2/2/1/3/2/11=25, `generateCards()` 5x5 only, `createInitialState(['p1','p2'])` north/south, `shipPos=2`.
* `src/game/GameScene.ts:61-71,73-133,183-186,218` — `cellColor()`, `allowedTargets()`, trap glyph `💀2/💀3`, piece label `✕{stuck}`.
* `src/main.ts:11,24-41,58-78` — boots straight into `createInitialState(['p1','p2'])`, no menu/router. `src/ui.ts`, `index.html:10-37`, `src/style.css` — single layout, no screens.

Agreed answers applied: (1) separate X/Y sizes, separate input per card type; (2) trap advance consumes a turn; (3) coin on trap entry goes to last position, grab only on last step, knockout from intermediate allowed; (4) row of circles, pieces on circles, green next-step highlight, per-circle piece placement; (5) clickable placeholders for join/test; (6) Back + Quit-to-menu buttons. Follow-ups applied: single `coinsOnGround` pile per trap (grab-gated to last step), drop allowed any step, `advanceTrap` blocked while carrying, each piece renders at its own step circle with vertical offset on collision.

---

## A. Menu + configurable local game

### A1. Screens (`index.html`, `src/ui.ts` or new `src/menu.ts`, `src/style.css`, `src/main.ts`)

* `main.ts` boots to `#menuView`, Phaser game created lazily on first entering `#gameView`.
* `#menuView`: `Join` / `Create local` / `Test` buttons → clickable placeholders for Join (Room-ID input + "coming soon" note) and Test ("not implemented").
* `#settingsView` (from Create local): Back + Continue buttons (Back to menu; game also gets Quit-to-menu).
* `#gameView`: existing `#layout` moved inside + `#quitToMenuBtn` (keeps state; re-entering settings → game starts fresh).

### A2. Settings form

* `fieldSizeX`, `fieldSizeY`: separate number inputs, default 5/5, clamp 3–9 (`GameScene.ts:54-59` `cellSize()` already scales as `720/(max+2)`).
* 7 number inputs, one per `CardType` (`empty, arrow_0_4, arrow_1_5, arrow_1_3_5_7, chest_3, trap_2, trap_3`), defaults = current 5×5 deck (`setup.ts:11-21`).
* Live validation: `sum == fieldSizeX*fieldSizeY` else `X/N cards assigned` + Continue disabled.
* 4 checkboxes north/south/west/east (default N+S). `<2` checked → Continue disabled + hint.
* Fixed (shown as text, not inputs): 3 pieces/player, `shipPos = floor(size/2)` per edge, `totalCoins = chest_3 * 3`.
* Shared pure `validateConfig()` in `core/` used by UI and tests.

### A3. Core generalization

* `src/core/types.ts`: new `GameConfig{fieldSizeX,fieldSizeY,deckCounts:Record<CardType,number>,edges:Edge[]}` + validation result type.
* `src/core/setup.ts`: `buildDeckFromCounts()`; `generateCards(rand, sizeX, sizeY, deck)` replacing hardcoded loops (`:60-62`); `createInitialState()` accepts config opts, keeps old defaults so `rules.test.ts:21-53` passes until extended.
* `main.ts`: New-board reshuffles same config; settings Continue builds state from config.

### A4. Files touched (menu)

`index.html`, `src/style.css`, `src/ui.ts` (or new `src/menu.ts` + `src/settings.ts`), `src/main.ts`, `src/core/types.ts`, `src/core/setup.ts`, tests.

---

## B. Multistep traps

### B1. Data model (`types.ts:23-31`, `rules.ts`, `setup.ts`)

Replace turn-skip counter with per-piece progress:

```ts
// Piece: remove/retire `stuck: number`
Piece {
  ...
  trapStep: number; // 0 = free, 1..N = position on current trap card
}
```

* Entry (`applyMove movePiece` onto face-up `trap_N`, cf. `rules.ts:381-389`): `trapStep = 1` (not `stuck = N`). `carrying` drop + `knockoutAt()` unchanged.
* Progress advances **only** when that piece moves (see B2). `endTurn` (`rules.ts:292-319`) **stops ticking** trap counters entirely. Other pieces moving has no effect on trapped pieces — fixes the reported bug.
* Leaving the trap card (any move to a different `x,y`): `trapStep = 0`.
* Knockout / return to ship: `trapStep = 0`.
* `N = parseTrapCost(type)` stays as source of step count.
* Migration: `stuck` is referenced in `rules.ts:154,201`, `GameScene.ts:218`, `main.ts:44`, `rules.test.ts:234-252`. Rename + update all + rewrite trap test.

### B2. Movement rules (`rules.ts:150-195` `validateMove`)

* Trapped piece (`trapStep > 0`) is **selectable** (not blocked like today).
* Let `N` = trap size under the piece, `k = trapStep`:
  * `k < N`: only legal "move" is advance to `k+1` via new action `{kind:'advanceTrap', pieceId}` (cleaner than overloading `movePiece to self`, which today fails `must move to neighbour` at `rules.ts:163`). Validates: own turn, own piece, `trapStep>0` with `k < N` under face-up `trap_N`, `!moved`, `!carrying`, no `pendingArrow` interference. Effect: `trapStep++`, sets `moved=true` (advance consumes a turn).
  * `k === N` (last position): `movePiece` to any of 8 neighbours allowed (normal neighbour/sea/carrying checks; arrow-exit logic does not apply on traps). No `advanceTrap` allowed.
* While a piece is on `k < N`, all other pieces move normally (no global lock, no `pendingArrow`-style lock).
* Coins: single `coinsOnGround` pile per trap card (conceptually on the last circle). `grab` on a trap allowed only when `trapStep === N`; `drop` on a trap allowed on any step. Entry with a coin drops it to the pile; the piece must advance to `N` to grab it back.
* Knockout: enemy landing on an occupied trap knocks out **all** enemies on that x,y regardless of step, then enters at step 1.
* Arrow interaction: landing on a trap via an arrow chain clears `pendingArrow` and starts the trap.
* Turn walkthrough (`trap_3` with coin): enter pos1 + coin→pile (turn 1) → advance to 2 (turn 2) → advance to 3 (turn 3) → grab on last step (free) + exit with coin (turn 4). Without coin: enter, advance, advance, exit.

### B3. Rendering (`GameScene.ts:73-133,161-200,218,234-266`)

* Open trap card: row of N circles centered in the cell (radius ~`CELL*0.12`); next-step circle stroked green; coin overlay `🪙n` anchored at the **last** circle.
* Pieces with `trapStep>0` render centered on **their own step's circle** (not the generic `cy+12` at `:214`); two own pieces on the same step offset vertically (first on circle, second below). Same-player stacking is the only multi-piece case (enemies knock out).
* `allowedTargets()`: if selected piece `trapStep>0` and `trapStep<N` → return `{currentCell}` only (green outline on own card + green next circle). If on last step → return 8 neighbours. `pendingArrow` branch stays higher priority.
* `handleCellClick()` (`:234-266`): allow clicking the selected piece's own cell as `advanceTrap` (today `:242` ignores `sel.x===x && sel.y===y`). Ship-move branch unchanged.
* Piece label: replace `✕{stuck}` (`:218`) with `k/N` (e.g. `1/3`); carrying `●` takes precedence as today.

### B4. Tests

Rewrite `rules.test.ts:234-252` (`trap_3 sticks...`):

* Entry sets `trapStep=1`, `faceUp=true`.
* `validateMove(movePiece away)` from `k=1,2` fails; `advanceTrap` succeeds and sets `moved`; second `advanceTrap` same turn rejected; `advanceTrap` while carrying rejected.
* `endTurn` without moving leaves `trapStep` unchanged (regression test for reported bug — move another piece + `endTurn`, assert trapped piece still at same step).
* Grab at `k<N` rejected, at `k==N` ok; exit resets `trapStep=0`; knockout of intermediate sends home with `trapStep=0`.
* `GameScene` manual check: N circles drawn, selection shows only next position.

### B5. Files touched (traps)

`src/core/types.ts`, `src/core/rules.ts`, `src/core/setup.ts`, `src/game/GameScene.ts`, `src/main.ts` (`findGrabbable` stuck check), `src/rules.test.ts`.

---

## C. Build order + verification

1. Types + setup generalization + `validateConfig()` + unit tests (`vitest run` green, old tests kept passing via defaults).
2. Menu/settings DOM + router + wiring in `main.ts` (`tsc --noEmit`, `npm run build` green; click: menu → create local → invalid sum/<2 players disables Continue → valid → game starts with right size/counts/edges → quit to menu).
3. Trap model (`trapStep`) + `advanceTrap` + `endTurn` tick removal + rewritten trap tests green.
4. Trap rendering (circles, highlights, labels) + `handleCellClick` self-click + manual playthrough: enter trap → pos1 → advance → advance → exit any direction; idle turn doesn't advance.
5. Full regression: chest open/grab/move/auto-drop, arrow chaining (`pendingArrow`), knockout, ship slide via sea click, win condition.

**Touched overall:** `index.html`, `src/style.css`, `src/ui.ts` (or new `src/menu.ts`), `src/main.ts`, `src/game/GameScene.ts`, `src/core/types.ts`, `src/core/rules.ts`, `src/core/setup.ts`, `src/rules.test.ts`.

**NOT doing (in this plan step):** Firebase/online join logic, test-page contents, animations/sprites, 9x9 balance, anti-cheat.
