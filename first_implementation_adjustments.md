# Plan: 5 adjustments to current app

Based on inspection of `src/core/types.ts`, `src/core/rules.ts`, `src/core/setup.ts`, `src/game/GameScene.ts`, `src/game/config.ts`, `src/ui.ts`, `src/main.ts`, `index.html`, `src/style.css`, `src/rules.test.ts`.

User answers applied: (3) chest = `🪎 + 🪙n` stacked, other cards = `🪙n` when coins present; (5) arrow chaining continues while landing on arrows same turn; (4) ship move only via strictly adjacent sea cells.

## 1) UI layout — title `family board game`, field+scores right, controls left, friendly scores

**Current:** `index.html:9` title `Not Jackal (Jackal clone) — local test`, single column `#hud` then `#game`; `src/ui.ts:43-58` renders scores as one-line `p1*:0 p2:0 | total coins: 12`; `src/style.css:1-17` no layout.

**Changes:**
- `index.html`:
  - `<title>family board game</title>` + `<h1>family board game</h1>`.
  - New wrapper: `<div id="layout"><aside id="sidebar">...controls...</aside><main id="boardPane"><div id="scoreBoard"></div><div id="game"></div></main></div>`.
  - Move `#turnLabel` + `#scores` (or new `#scoreBoard`) + `#game` canvas container into `boardPane` (right). Move `#newBoardBtn`, `#freeTest`, `#p1panel`, `#p2panel` (minus ship buttons — see §4), `#status` into `sidebar` (left).
  - Keep existing element IDs (`turnLabel`, `scores`, `status`, etc.) so `src/ui.ts:12-16` `el()` doesn't break; only re-parent them.
- `src/style.css`:
  - `#layout { display:flex; gap:16px; }`, `#sidebar { width:260px; display:flex; flex-direction:column; gap:12px; }`, `#boardPane { flex:1; }`.
  - Style score cards: highlight current player (e.g. `.current { border:2px solid gold; }`), show `Score: X / 12`, coins remaining, winner banner.
- `src/ui.ts:43-58 `update()`:
  - Replace one-line `scores.textContent` with structured friendly render: per-player row `● P1 — 3 coins (current turn ◀)` + `Total: 3/12 collected, 9 left`. Use DOM creation or `innerHTML`, add CSS class for current player.
  - Keep `turnLabel` but make it redundant-friendly: `Turn: P1 — move, Grab/Drop or End`.
- `src/game/config.ts`: consider bumping canvas to fill right pane (e.g. keep 720x720, CSS `max-width:100%`).

## 2) Remove `~` / `?`, dark-green closed cards, full-size arrows

**Current:** `src/game/GameScene.ts:62-72` `cellColor()` face-down `0x1d3a5f` (blue); `148-157` glyphs: sea `~`, face-down `?`, arrows `arrowGlyph()` at `fontSize:20px` in `169`.

**Changes:**
- `GameScene.ts:cellColor()`:
  - Face-down → dark green, e.g. `0x14532d` (distinct from face-up `empty` `0x3f7d4e`). Sea stays `0x123a6d`.
- `GameScene.ts:render()` glyph section `146-167`:
  - Sea non-ship: `glyph = ''` (no `~`). Keep `S` (or ship emoji) only on actual `shipCellOf()` cells.
  - Face-down: `glyph = ''` (no `?`).
  - Arrows: `fontSize` → scaled to cell, e.g. `Math.floor(CELL*0.75) + 'px'` (~50-100px for 5x5), centered. Keep or drop small `sub` digit label `1·5` — recommend keep as tiny subtitle, main glyph large. Optionally replace `↕/⤡/✛` with larger directional glyphs that fill card.
- No `rules.ts` / test changes needed. Verify visually: closed board all dark-green blanks, sea blank blue, arrows large.

## 3) Coin-on-card `🪙` + chest `🪎` indicators

**Current:** `GameScene.ts:161-163` chest shows ``🪙n`` if `coinsOnGround>0` else `▢`; other types never show coins.

**Changes (`GameScene.ts:render()` only):**
- New rendering rule:
  - `if card.type.startsWith('chest_')`: main glyph `🪎` always (identifies gold chest even when empty).
  - `if (card.coinsOnGround ?? 0) > 0`: second line/overlay `🪙n` (e.g. `sub` text or second `add.text` below center). So chest with 2 left shows both stacked: `🪎` + `🪙2`; `empty`/`arrow_*`/`trap_*` with dropped/knocked coin shows its normal glyph + `🪙n` overlay.
  - Layout: use two text objects (center + bottom offset) so arrow/trap glyph isn't obscured. Font sizes: chest ~`CELL*0.5`, coin label ~`16-20px`.
- Covers transient case from `rules.ts:287-291,334-337` (`endTurn` auto-drop / manual `drop` moving coin to different card) and `knockoutAt():259-261`.
- No `core/` change; add manual click-test to plan verification.

## 4) Remove ship buttons; piece-on-ship → sea click = `moveShip`

**Current:** `index.html:19-20,27-28` `Ship ◀/▶` buttons; `src/ui.ts:5,35-36` `onShipMove`; `src/main.ts:68` handler; `GameScene.ts:24,124-143,224-241,252-259` `shipSelectedPlayer` arming flow; `rules.ts:131-148,307-314` `moveShip` + `rideAlong()`.

**Changes:**
- `index.html`: delete 4 ship buttons.
- `src/ui.ts`: remove `onShipMove` from `UIHandlers`, remove wiring loop for `ShipLeft/Right`.
- `src/main.ts`: remove `onShipMove` handler (keep `doAction` generic; `moveShip` action stays in core).
- `src/game/GameScene.ts`:
  - Delete `shipSelectedPlayer` field + highlight block `124-143` + arming branches in `handleCellClick()` `224-241,252-259`.
  - Extend `allowedTargets()`: if selected piece `onShip`, return the up-to-2 strictly adjacent sea cells along its edge (`shipPos±1` via `shipCellFor()`, bounds-checked, enemy-ship collision excluded). This replaces green ship-target highlight.
  - Extend `handleCellClick(x,y)`: if `selected` piece `onShip` and dest is sea (`isSea()` true):
    - Compute `dir = (edge north/south ? x - shipPos : y - shipPos)`. If `dir === ±1` AND dest equals `shipCellFor(edge, shipPos+dir)` → call `onAction(currentTurn, {kind:'moveShip', dir})` instead of `movePiece`. Else show invalid via `onAction` → `validateMove` reason (keeps `strict adjacent only` per user choice).
    - Disembark (ship → land neighbour) stays `movePiece` as today.
  - `rules.ts:validateMove/applyMove` for `moveShip` unchanged (bounds + enemy-ship check + `rideAlong()` moves all `onShip` pieces).
- Tests: update `rules.test.ts` ship test to also cover “sea-click maps to ±1” helper if extracted; add UI-level manual test (select ship piece, click adjacent water → ship + all aboard slide).

## 5) Arrow landing → continue in arrow direction(s) same turn (chained)

**Current:** `rules.ts:162-172,344-384` landing flips face-up, stays put, `moved=true`; next turn restricted to exits. Test `rules.test.ts:185-206` asserts `no forced arrow slide`.

**Changes — chained continuation (most invasive):**
- `src/core/types.ts`: add `pendingArrow: { pieceId:string } | null` to `GameState` (or `mustExitFrom`). Init `null` in `src/core/setup.ts:createInitialState()`.
- `src/core/rules.ts`:
  - `validateMove(movePiece)`: if `state.pendingArrow` set:
    - Bypass `state.moved` check for the continuation (still `already moved` for other pieces/actions).
    - Only `pieceId === pendingArrow.pieceId` allowed; dest must be in `parseArrowExits(currentCard.type)` + existing neighbour/sea/carrying checks.
    - If no `pendingArrow`, existing logic (including arrow-exit restriction when *starting* from arrow on a later turn as fallback).
  - `applyMove(movePiece)`: after normal move/discover/knockout/trap handling, if final card `faceUp && isArrowCard(type)` → set `next.pendingArrow = {pieceId}` and keep `next.moved = true` (so only arrow continuation allowed, not new piece move / ship move); else clear `next.pendingArrow = null`. If dest was second arrow, chain continues (per user choice). `endTurn` clears `pendingArrow`.
  - Decide trap+arrow interaction: if arrow card also has coin? Arrows never spawn coins, but dropped coins on arrows are allowed — keep grab/drop rules unchanged.
- `src/game/GameScene.ts:allowedTargets()`: if `state.pendingArrow` set, restrict highlights to that piece's arrow exits only.
- `src/main.ts:refresh/doAction`: no change except clearing selection only when `pendingArrow==null` (keep piece selected for continuation so player can click second dest same turn).
- `src/rules.test.ts`: rewrite arrow test: land on `arrow_1_5` → assert `pendingArrow` set + `moved==true` + second `movePiece` to exit same turn validates OK + non-exit validates `must follow arrow exits` + chain onto second arrow keeps pending + `endTurn` clears.

## Build order + verification

1. `types.ts` + `setup.ts` (`pendingArrow` field).
2. `rules.ts` (arrow chain; ship logic unchanged) + `rules.test.ts` update → `npx vitest run` green.
3. `GameScene.ts` (colors/glyphs/sizes/coin+chest icons/ship-click/arrow highlights).
4. `index.html` + `style.css` (title, flex left/right) + `ui.ts` (friendly scores, drop ship handlers) + `main.ts` (drop ship handler, keep selection on pendingArrow).
5. `npx tsc --noEmit` + `npm run build` green; manual click-through: new board, disembark, open chest (`🪎+🪙3`), grab→move→auto-drop shows `🪙` on new card, ship slide via sea click carries stack, arrow single + diagonal + 4-way chaining same turn, trap stuck, 12-coin win.

**Touched:** `index.html`, `src/style.css`, `src/ui.ts`, `src/main.ts`, `src/game/GameScene.ts`, `src/core/types.ts`, `src/core/rules.ts`, `src/core/setup.ts`, `src/rules.test.ts`.
