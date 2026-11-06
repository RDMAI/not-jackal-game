import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/core/setup';

const scriptPath = fileURLToPath(new URL('./create-room.mjs', import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
}

function assertRoomDoc(room) {
  expect(room.version).toBe(1);
  expect(validateConfig(room.config).ok).toBe(true);
  expect(room.state.status).toBe('lobby');
  expect(room.state.turnsPassed).toBe(0);
  expect(Object.keys(room.state.players)).toEqual(['p1', 'p2']);
  expect(Object.values(room.state.players).every((player) => player.joined === false)).toBe(true);
  expect(Object.keys(room.state.pieces)).toHaveLength(6);
  expect(Object.keys(room.state.cards)).toHaveLength(25);
  expect(room.state.totalCoins).toBe(12);
  expect(room.state.maxPlayers).toBe(2);
}

describe('create-room script', () => {
  it('prints a map keyed by room id to stdout', () => {
    const result = run(['--id', 'test-room']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Object.keys(parsed)).toEqual(['test-room']);
    assertRoomDoc(parsed['test-room']);
  });

  it('writes the map to --out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'not-jackal-room-'));
    try {
      const out = join(dir, 'test-room.json');
      const result = run(['--id', 'test-room', '--out', out]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      const parsed = JSON.parse(readFileSync(out, 'utf8'));
      expect(Object.keys(parsed)).toEqual(['test-room']);
      assertRoomDoc(parsed['test-room']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates a UUID when --id is omitted', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const ids = Object.keys(parsed);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    assertRoomDoc(parsed[ids[0]]);
  });

  it('rejects an invalid room id and an invalid config', () => {
    const badId = run(['--id', 'bad/id']);
    expect(badId.status).not.toBe(0);
    expect(badId.stderr).toMatch(/invalid room id/);

    const dir = mkdtempSync(join(tmpdir(), 'not-jackal-room-'));
    try {
      const configPath = join(dir, 'bad-config.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          fieldSizeX: 5,
          fieldSizeY: 5,
          deckCounts: {
            empty: 1,
            arrow_0_4: 0,
            arrow_1_5: 0,
            arrow_1_3_5_7: 0,
            chest_3: 0,
            trap_2: 0,
            trap_3: 0,
          },
          edges: ['north', 'south'],
        }),
        'utf8',
      );
      const badConfig = run(['--id', 'test-room', '--config', configPath]);
      expect(badConfig.status).not.toBe(0);
      expect(badConfig.stderr).toMatch(/cards assigned/);

      const missingConfig = run(['--id', 'test-room', '--config', join(dir, 'missing.json')]);
      expect(missingConfig.status).not.toBe(0);
      expect(missingConfig.stderr).toMatch(/cannot read config/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
