# Plan: Turn-based 2-4p board game (TS + Phaser + Firebase RTDB)

Current state inspected: `src/main.ts:1-194` is DOM `<table>` prototype with `board_state: 0|1` sync only. `docs/rtdb_schema.json:2-109` is `9x9` + `board_size_x/y` + `status`. No Phaser yet (`package.json:11-13` has only `firebase`). This plan replaces prototype but keeps room-join idea.

User decisions applied: 9x9, ship-move=1 turn (pieces on ship ride along), explicit grab/drop button, game ends when all chest coins on ships, client-side validation isolated for future server, simple Phaser shapes.

## 1. Setup

1. `npm i phaser`, keep `vite + tsc` build for GitHub Pages.
2. New layout (keep flat, beginner-readable):
```
src/core/types.ts      # all shared types, no Phaser/Firebase imports
src/core/setup.ts      # 9x9 board generator
src/core/rules.ts      # ONLY place with validateMove() - pure function for future server
src/net/firebase.ts    # init app (extract from main.ts:24-36)
src/net/room.ts        # subscribe/submit room, transactions
src/game/config.ts     # Phaser.Game config
src/game/GameScene.ts  # single scene: draw grid + pieces + ships
src/ui.ts              # DOM overlay: lobby, turn label, Grab/Drop/End-turn buttons
src/main.ts            # wiring only
```

## 2. Core model (`src/core/types.ts` + `setup.ts`)

```ts
type Vec = {x:number,y:number};
type CardType = 'empty'|'arrow'|'chest'|'trap';
type Card = { type:CardType, faceUp:boolean, arrowDir?:Vec, coinsLeft?:number, coinsOnGround?:number, trapCost?:number };
type Piece = { id:string, playerId:string, x:number,y:number, onShip:boolean, carrying:boolean, stuck:number };
type Player = { id:string, edge:'north'|'south'|'east'|'west', shipPos:number, order:number };
```

* Board: 9x9. Border = sea except ship cells. 2p: `north/south` middle (`x=4`), 3p: +`west`, 4p: +`east`. Ship state = `Player.shipPos` (index along its assigned edge), moves ±1 along same edge only, never corners.
* `setup.ts:generateBoard()`: fixed deck for v1, shuffled: e.g. 5 chests x 3 coins=15 total, 16 arrows (random 8 dirs), 4 traps (`trapCost=2`), rest `empty`. All `faceUp=false`.
* Pieces: 3/player, start `onShip=true`.

## 3. Rules engine (`src/core/rules.ts`, pure, no I/O)

Single entry for future server extraction:
```ts
validateMove(state:GameState, playerId:string, action:Action): {ok:boolean, reason?:string}
applyMove(state:GameState, action:Action): GameState // assumes valid, handles chains
type Action = {kind:'movePiece', pieceId:string, to:Vec} | {kind:'moveShip', dir:-1|+1} | {kind:'grab'} | {kind:'drop'} // + pieceId
```

Rules to implement:
* Turn: `state.currentTurn==playerId`, one `movePiece` OR `moveShip` per turn. `grab/drop` are explicit buttons, free action on your turn when `piece.x/y == card with coin` / `carrying`, do not advance turn (assumption - easy to change to cost turn).
* `movePiece`: dest must be 8-neighbour (orthogonal+diagonal), in-bounds, not sea (except own ship cell for deposit). If `piece.carrying==true` dest `Card.faceUp` must be `true`.
* Discover: stepping on `faceUp==false` flips to `true`.
* Arrow: after `applyMove`, while landed card is `arrow+faceUp`, auto-step `arrowDir` once, repeat with loop guard (e.g. max 20, break on cycle/sea). Chain happens in same turn.
* Chest: `coinsLeft` + `coinsOnGround` stack on card. `grab` sets `carrying=true`, decrements pile. `drop`/knockout leaves coin on `coinsOnGround`.
* Trap: landing sets `piece.stuck=trapCost` (e.g. 2). Stuck piece cannot move until counter decrements each own turn.
* Knockout: dest has enemy pieces -> all enemies `onShip=true, carrying=false`, their carried coins go to `coinsOnGround` on that card. Friendly stacking allowed.
* Ship deposit: moving onto own ship cell with `carrying` + pressing `Drop` on ship scores: `player.score++`, `carrying=false`.
* Win: sum `scores == totalChestCoins` -> `status='finished'`, max score wins.

## 4. Firebase schema v2 (extend `docs/rtdb_schema.json`)

Replace `board_state: number[][]` with:

```json
rooms/{roomId}: {
  "board_size_x": 9, "board_size_y": 9,
  "status": "lobby|running|finished",
  "currentTurn": "playerId1",
  "totalCoins": 15,
  "players": { "p1": {"edge": "north", "shipPos": 4, "score": 0, "order": 0} },
  "pieces": { "p1_0": {"playerId": "p1", "x": 4, "y": 0, "onShip": true, "carrying": false, "stuck": 0} },
  "cards": { "4_4": {"type": "chest", "faceUp": false, "coinsLeft": 3, "coinsOnGround": 0} },
  "lastMove": {"by": "p1", "action": "...", "at": 123456}
}
```

`src/net/room.ts`: `onValue(rooms/id)` -> render, `runTransaction` for move submit to reduce race (last-write-wins acceptable v1). Keep validation client-side only.

## 5. Phaser (keep simple)

* `config.ts`: `type:CANVAS, width:720, height:720, parent:'game', scene:[GameScene]`, no physics, no assets.
* `GameScene.ts` only: for each cell draw `Rectangle` (face-down: dark blue, face-up by type color + `Text` emoji: `⬆️🪙💀` / `S` ship / circles for pieces / `●` coin dot). Interaction: `setInteractive()` on rectangles, click own piece -> highlight 8 neighbours green, click dest -> call `validateMove()` -> `submitMove()`. Ship: click ship -> show `◀ ▶` highlights.
* All HUD (room id, `currentTurn`, Grab/Drop, End Turn) in DOM `ui.ts`, not Phaser.

## 6. Build order

1. Types + setup + rules + unit tests (pure TS, `vitest` or node asserts).
2. Firebase schema + `room.ts` + lobby/join UI.
3. Phaser `GameScene` read-only render from Firebase.
4. Interaction + `validateMove` wiring + Grab/Drop buttons.
5. Ship move + knockout + arrow-chain + trap hardening.
6. End-game screen + `vite build` GH Pages check.

What v1 will NOT do: auth/presence, anti-cheat (server later), animations/tweens, sprite packs, sea travel except ship cell.
