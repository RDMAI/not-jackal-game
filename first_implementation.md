# Plan: local-only 5x5 manual test build (no Firebase yet)

Current state inspected: `src/core/types.ts:8-17` has `CardType 'empty'|'arrow'|'chest'|'trap'` with `arrowDir?/coinsLeft?/coinsOnGround?/trapCost?`; `src/core/setup.ts:4-11` is 9x9 constants (5 chests x 3 = 15 coins, 16 arrows, 4 traps) with interior 7x7 sea-border logic; `src/core/rules.ts:75-161` is pure `validateMove()` + `applyMove()` with forced single-arrow auto-step chain; `src/main.ts:1-128` wires Phaser via `src/net/room.ts:24-112` (`createRoom/joinRoom/startGame/submitAction/subscribeRoom` with transactions); `src/game/GameScene.ts:20-235` gates clicks by `myId`; `src/ui.ts:4-12` is lobby + single-player HUD. This plan cuts the net layer and retools for hot-seat testing.

User decisions applied: (1) remove Firebase for now, all state local in page memory; (2) new `Card` fields (`type`/`faceUp`/`coinsOnGround` only, no `coinsLeft`); (3) 5x5 field + 25-card deck below, all face-down, randomly placed, state kept local (same shape that will later go to Firebase); (4) 2 players, both control sets on one page; (5) chest opening puts coins on the ground; carrying lasts one turn and `endTurn` auto-drops/scores; (6) `board` renamed to `field`: state stores field size, sea is the surrounding ring.

Direction digits (your keypad):

```
0:(-1,-1) 1:(0,-1) 2:(+1,-1)
7:(-1,0)           3:(+1,0)
6:(-1,+1) 5:(0,+1) 4:(+1,+1)
```

So `arrow_0_4` = {NW,SE}, `arrow_1_5` = {N,S}, `arrow_1_3_5_7` = {N,E,S,W}; `chest_3` = 3 coins; `trap_2`/`trap_3` = stuck that many of your turns.

## 1. New `Card` model (`src/core/types.ts`)

Replace `src/core/types.ts:8-17` with:

```ts
type CardType =
  | 'empty'
  | 'arrow_0_4' | 'arrow_1_5' | 'arrow_1_3_5_7'
  | 'chest_3'
  | 'trap_2' | 'trap_3';
type Card = { type:CardType, faceUp:boolean, coinsOnGround:number };
// No `coinsLeft` field. `faceUp` keeps current camelCase (you wrote `faceup`).
// Chest coins live in `coinsOnGround` from the moment the chest is opened.
```

Helpers (new, pure, in `rules.ts` or `setup.ts`):

```ts
parseArrowExits(type): Vec[]  // 'arrow_1_5' -> [{x:0,y:-1},{x:0,y:1}]
parseChestCoins(type): number // 'chest_3' -> 3
parseTrapCost(type): number   // 'trap_2' -> 2, 'trap_3' -> 3
```

Chest-open rule (resolved, replaces old A/B open point): `type` stays a label and never mutates (`chest_3` stays `chest_3` after grabs).
- At deal time every card has `coinsOnGround=0`, including face-down chests.
- When a chest is opened (`faceUp=false->true` on `movePiece` landing, including arrow-chain discovery): `coinsOnGround += parseChestCoins(type)` (3). Opening is the only coin-spawning event.
- After that chest coins are indistinguishable from knocked-out/dropped coins on the same card. `grab` just does `coinsOnGround--`.

## 2. Deck + 5x5 field (`src/core/setup.ts`)

Terminology: `field` = the card area. State stores **field sizes** (`fieldSizeX/Y`). Sea is the surrounding ring and is **not** counted in the field size. So a 5x5 field means 5x5 cards surrounded by sea cells; conceptual total including sea is 7x7 (`fieldSize+2`).

```ts
FIELD_SIZE = 5;
TEST_DECK: CardType[] = [
  4x 'chest_3',            // 12 coins total
  2x 'arrow_1_5', 2x 'arrow_0_4', 1x 'arrow_1_3_5_7',
  3x 'trap_2', 2x 'trap_3',
  11x 'empty',             // 25 - 14 = 11
];
```

* New `buildTestDeck(): CardType[]` (exported so tests assert the 4/2/2/1/3/2/11 counts).
* Rename: `BOARD_SIZE` -> `FIELD_SIZE`, `GameState{boardSizeX,boardSizeY}` -> `{fieldSizeX,fieldSizeY}` (current `src/core/types.ts:47-48`, `src/core/setup.ts:4,32,34,115-116`). All `boardSize`/`isInBounds`/`isBorder`/`isCorner` logic becomes field-based; `isSea()` = outside the field except the owner's current ship cell.
* `generateCards(rand)`: shuffle deck (keep existing Fisher-Yates), deal one card per field cell `0..4 x 0..4`, all `faceUp=false`, `coinsOnGround=0`. `cards` map holds field cells only; sea cells have no cards.
* `createInitialState(['p1','p2'], 2, rand)`: `fieldSizeX/Y=5`, `totalCoins=12`, `status='running'` at once (no lobby in local mode), `p1` north ship above the field, `p2` south ship below it, 3 pieces each `onShip=true`.
* Parametrize `shipCellFor`/`edgeForOrder` by field size + sea offset. Field coords are `0..4`; ships float on the adjacent sea ring, e.g. north `(shipPos,-1)`, south `(shipPos,5)`. Ship start `shipPos=2`, slide range `0..4` along the field edge (sea-ring corners are never ship cells, so no corner ban needed).

## 3. Rules changes (`src/core/rules.ts`, still pure, no I/O)

* `coinsOnCard()`: just `coinsOnGround` for every card type (chests included). Knocked-out/dropped coins stay grabbable anywhere on land.
* `grab`: requires land card under the piece with `coinsOnGround>0`, piece not `onShip`, not already `carrying`, not `stuck`. Effect: `coinsOnGround--`, `piece.carrying=true`. Forbidden on/from ships: ships hold no ground piles and other players cannot grab coins from ships.
* Transient carrying (grab is only for moving to a different cell, lasts one turn):
  * `grab` does not set `moved`; the existing single `movePiece`/`moveShip` per turn limit (`moved` flag) stays, so the normal sequence is `grab -> movePiece -> endTurn`.
  * `endTurn` auto-resolves every own piece with `carrying=true` before passing the turn (in addition to the existing `stuck-1` tick):
    * on own ship cell -> `score+1`, `carrying=false`, coin removed from the game (no pile left on the ship);
    * on a land card -> `cards[key].coinsOnGround++`, `carrying=false`, at the cell where the carrying piece stands;
    * no card (should not happen; sea moves are blocked) -> `carrying=false`, coin lost.
  * `grab` then `endTurn` without moving is allowed and is a no-op (coin returns to the same card via the auto-drop).
  * Manual `drop` stays as an optional mid-turn explicit action (same `coinsOnGround++` / on-ship score effect); the normative path is the `endTurn` auto-drop/score, so UI/tests must cover `endTurn` carrying.
* Traps: `trap_2` -> `stuck=2`, `trap_3` -> `stuck=3`; carrying still drops to `coinsOnGround` on entry; `endTurn` still ticks each own piece `stuck-1` (plus the auto-drop above).
* Knockout drops to `coinsOnGround` unchanged.
* Arrows (semantics change — planned default): old code did a **forced** single-`arrowDir` auto-step with 20-step loop guard + knockout each step. New cards offer **2-4 exits**, so no forced slide: landing flips face-up (as today, including the chest-open payout above), and the **next** `movePiece` from that cell is restricted to `parseArrowExits(type)` (plus existing neighbour/sea/carrying checks). Allowed cells render green. (Alternative — auto-step with a chooser popup when >1 exit — deferred as more UI work. Say so if you want forced movement instead.)
* `moveShip`: bounds in field/sea-ring terms, keep ship-vs-ship collision check; old corner check (`isCorner`) goes away with the field+ring coordinates.
* Win: `sum(scores) >= 12` -> `status='finished'`, max score wins (`checkWin` + `totalCoins`).

## 4. Go local: cut Firebase, hot-seat state

* `src/main.ts` rewrite (~60 lines, wiring only): delete `net/room` + `getMyId` + `roomId/subscribe` logic; `let state = createInitialState(['p1','p2'],2)` in module scope; `doAction(playerId,action)` = `validateMove` -> `state = applyMove(state,playerId,action)` -> `scene.setState(state); ui.update(state)` (all sync); add `New board (shuffle)` button regenerating state via `Math.random`. State stays JSON-serializable so later Firebase is just `set(roomRef,state)`.
* Delete/stub `src/net/firebase.ts` + `src/net/room.ts` (delete both; `tsc` `noUnusedLocals` fails on dead imports otherwise).
* `src/game/GameScene.ts`: drop `myId` gating (`setMyId`, `piece.playerId===myId` in `handlePieceClick:166-175` / `handleCellClick:217-225`); all pieces clickable, selection tracks `(playerId,pieceId)`; `CELL=720/5=144`, loops use `state.fieldSizeX/Y`; new `cellColor()` + glyphs: `?` facedown, `arrow_1_5`=`↕`, `arrow_0_4`=`⤡`, `arrow_1_3_5_7`=`✛` (+`1·5` label), chest `🪙n` (`coinsOnGround` only), traps `💀2`/`💀3`, `S` ships; `onAction` becomes `(playerId:string,a:Action)=>void`.
* `src/ui.ts` + `index.html`: remove lobby (`roomIdInput/maxPlayers/createBtn/joinBtn/startBtn/roomError`, `myId` script in `index.html:10,35-38`); HUD = `turnLabel` (`p1`/`p2`+`*`), scores, `New board` button, **two control blocks** `P1:[Grab][Drop][Ship◀][Ship▶][End]` + `P2:[...]` each calling `doAction('p1'|'p2',…)`; board clicks act as `state.currentTurn` (turn order still testable), buttons use fixed player (invalid ones surface `validateMove` reason e.g. "not your turn"). Optional `Free test (ignore turns)` checkbox skipping only the `currentTurn` check in `doAction` (not in `rules.ts`).
* `src/game/config.ts`: unchanged (720x720 fits 5x5).
* `src/rules.test.ts`: rewrite — 5x5 field, 25 cards, deck counts, `totalCoins=12`, open chest `coinsOnGround 0->3`, grab `3->2 + carrying`, move + `endTurn` auto-drops to dest card, `endTurn` on own ship scores and removes coin, grab + `endTurn` without moving is a no-op, cannot grab from ships, `trap_3 -> stuck=3`, arrow-exit restriction, sea-ring test (outside field is sea except own ship cell).

## 5. Build order (no Firebase console work)

1. `types.ts` -> new `CardType`/`Card` (no `coinsLeft`) + `fieldSizeX/Y`.
2. `setup.ts` -> `FIELD_SIZE` 5x5 deck/shuffle/state + sea-ring ships.
3. `rules.ts` -> parsers + chest-open payout + transient-carrying `endTurn` + trap/arrow updates.
4. `rules.test.ts` -> `npx vitest run` green.
5. `GameScene.ts` (grid+glyphs+selection) -> `ui.ts`/`index.html` (dual panels) -> `main.ts` (local state, delete `net/`) -> `npx tsc --noEmit` + `npm run build` green; click-test every card type, chest open -> grab -> move -> `endTurn` auto-drop, ship scoring, knockout, trap wait, ship ride-along, full 12-coin win screen.

Touched: `src/core/types.ts`, `src/core/setup.ts`, `src/core/rules.ts`, `src/rules.test.ts`, `src/game/GameScene.ts`, `src/ui.ts`, `src/main.ts`, `index.html`, delete `src/net/firebase.ts` + `src/net/room.ts`.

NOT doing: any Firebase/Auth/rules edits, animations, sprites, 9x9 balance, anti-cheat, actual code implementation in this plan step.
