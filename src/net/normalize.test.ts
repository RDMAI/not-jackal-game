import { describe, expect, it } from 'vitest';
import { createRoomDoc } from '../core/lobby';
import { defaultGameConfig } from '../core/setup';
import { normalizeRoomDoc } from './normalize';

function validRoom(): any {
  return JSON.parse(JSON.stringify(createRoomDoc(defaultGameConfig(), () => 0.5)));
}

describe('normalizeRoomDoc', () => {
  it('normalizes a valid room without mutating the input', () => {
    const raw = validRoom();
    const before = JSON.stringify(raw);
    const result = normalizeRoomDoc(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.version).toBe(1);
    expect(result.room.state.status).toBe('lobby');
    expect(Object.keys(result.room.state.players)).toHaveLength(2);
    expect(Object.keys(result.room.state.pieces)).toHaveLength(6);
    expect(Object.keys(result.room.state.cards)).toHaveLength(25);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('defaults missing nullable fields and turnsPassed', () => {
    const raw = validRoom();
    delete raw.state.pendingArrow;
    delete raw.state.lastMove;
    delete raw.state.winner;
    delete raw.state.turnsPassed;

    const result = normalizeRoomDoc(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.state.pendingArrow).toBeNull();
    expect(result.room.state.lastMove).toBeNull();
    expect(result.room.state.winner).toBeNull();
    expect(result.room.state.turnsPassed).toBe(0);
  });

  it('defaults missing joined based on status', () => {
    const lobbyRaw = validRoom();
    delete lobbyRaw.state.players['p1'].joined;
    const lobbyResult = normalizeRoomDoc(lobbyRaw);
    expect(lobbyResult.ok).toBe(true);
    if (!lobbyResult.ok) return;
    expect(lobbyResult.room.state.players['p1'].joined).toBe(false);

    const runningRaw = validRoom();
    runningRaw.state.status = 'running';
    runningRaw.state.currentTurn = 'p1';
    delete runningRaw.state.players['p1'].joined;
    const runningResult = normalizeRoomDoc(runningRaw);
    expect(runningResult.ok).toBe(true);
    if (!runningResult.ok) return;
    expect(runningResult.room.state.players['p1'].joined).toBe(true);
  });

  it('defaults a missing card coinsOnGround to 0', () => {
    const raw = validRoom();
    delete raw.state.cards['0_0'].coinsOnGround;
    const result = normalizeRoomDoc(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.room.state.cards['0_0'].coinsOnGround).toBe(0);
  });

  it('accepts tie and player-id winners but rejects unknown ids', () => {
    const tie = validRoom();
    tie.state.status = 'finished';
    tie.state.winner = 'tie';
    expect(normalizeRoomDoc(tie).ok).toBe(true);

    const player = validRoom();
    player.state.status = 'finished';
    player.state.winner = 'p1';
    expect(normalizeRoomDoc(player).ok).toBe(true);

    const unknown = validRoom();
    unknown.state.status = 'finished';
    unknown.state.winner = 'p9';
    expect(normalizeRoomDoc(unknown).ok).toBe(false);
  });

  it('rejects missing or empty player/piece/card collections', () => {
    for (const key of ['players', 'pieces', 'cards']) {
      const missing = validRoom();
      delete missing.state[key];
      expect(normalizeRoomDoc(missing).ok).toBe(false);

      const empty = validRoom();
      empty.state[key] = {};
      expect(normalizeRoomDoc(empty).ok).toBe(false);
    }
  });

  it('rejects missing or wrong versions and invalid config', () => {
    const missingVersion = validRoom();
    delete missingVersion.version;
    expect(normalizeRoomDoc(missingVersion).ok).toBe(false);

    const wrongVersion = validRoom();
    wrongVersion.version = 2;
    expect(normalizeRoomDoc(wrongVersion).ok).toBe(false);

    const badConfig = validRoom();
    badConfig.config.fieldSizeX = 2;
    expect(normalizeRoomDoc(badConfig).ok).toBe(false);

    const badCounts = validRoom();
    badCounts.config.deckCounts.empty = 0;
    expect(normalizeRoomDoc(badCounts).ok).toBe(false);
  });

  it('rejects a malformed room root and malformed joined/coins values', () => {
    expect(normalizeRoomDoc(null).ok).toBe(false);
    expect(normalizeRoomDoc([]).ok).toBe(false);

    const badJoined = validRoom();
    badJoined.state.players['p1'].joined = 'yes';
    expect(normalizeRoomDoc(badJoined).ok).toBe(false);

    const badCoins = validRoom();
    badCoins.state.cards['0_0'].coinsOnGround = 'lots';
    expect(normalizeRoomDoc(badCoins).ok).toBe(false);
  });
});
