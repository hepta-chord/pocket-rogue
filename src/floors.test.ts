import { describe, expect, it } from 'vitest';
import { FLOORS, isRisky, rollEffect, spawnFloors, type FloorKind } from './floors';
import { Tile, canDetour, generateMap, idx, roomCenter, type GameMap } from './map';
import { Rng, hashSeed } from './rng';

const KINDS = Object.keys(FLOORS) as FloorKind[];

describe('床の定義', () => {
  it('4 色ある', () => {
    expect(KINDS).toEqual(['green', 'yellow', 'red', 'blue']);
  });

  it('マイナスの出る率が色の順に上がる', () => {
    expect(FLOORS.green.badRate).toBeLessThan(FLOORS.yellow.badRate);
    expect(FLOORS.yellow.badRate).toBeLessThan(FLOORS.red.badRate);
  });

  it('青にはマイナスが無い', () => {
    expect(FLOORS.blue.bad).toHaveLength(0);
    expect(FLOORS.blue.badRate).toBe(0);
  });

  it('取り返しがつかない効果を持つのは黄と赤だけ', () => {
    expect(isRisky('yellow')).toBe(true);
    expect(isRisky('red')).toBe(true);
    expect(isRisky('green')).toBe(false);
    expect(isRisky('blue')).toBe(false);
  });

  it('腐食が出るのは赤だけ', () => {
    for (const k of KINDS) {
      const hasCorrode = FLOORS[k].bad.some((e) => e.kind === 'corrode');
      expect(hasCorrode).toBe(k === 'red');
    }
  });
});

describe('rollEffect', () => {
  it('その色が持つ効果しか返さない', () => {
    const rng = new Rng(hashSeed('ROLL'));
    for (const k of KINDS) {
      const all = [...FLOORS[k].good, ...FLOORS[k].bad].map((e) => e.kind);
      for (let i = 0; i < 300; i++) {
        expect(all).toContain(rollEffect(rng, k).kind);
      }
    }
  });

  it('青は必ず回復になる', () => {
    const rng = new Rng(hashSeed('BLUE'));
    for (let i = 0; i < 200; i++) expect(rollEffect(rng, 'blue').kind).toBe('healHp');
  });

  it('赤はマイナスもプラスも出る', () => {
    const rng = new Rng(hashSeed('RED'));
    const kinds = new Set<string>();
    for (let i = 0; i < 500; i++) kinds.add(rollEffect(rng, 'red').kind);
    expect(kinds.size).toBeGreaterThan(2);
  });
});

describe('spawnFloors', () => {
  function build(seed: string, depth: number): { map: GameMap; floors: ReturnType<typeof spawnFloors> } {
    const rng = new Rng(hashSeed(seed));
    const map = generateMap(rng, 40, 30);
    const start = roomCenter(map.rooms[0]);
    const si = map.tiles.indexOf(Tile.StairsDown);
    const stairs = { x: si % map.width, y: Math.floor(si / map.width) };
    return { map, floors: spawnFloors(rng, map, depth, start, stairs, []) };
  }

  it('青い床が各階に 1 つ出る', () => {
    for (let i = 0; i < 30; i++) {
      const { floors } = build(`BLUE${i}`, 1 + i);
      expect(floors.filter((f) => f.kind === 'blue')).toHaveLength(1);
    }
  });

  it('歩ける床の上にだけ置く', () => {
    for (let i = 0; i < 20; i++) {
      const { map, floors } = build(`SPOT${i}`, 8);
      for (const f of floors) {
        expect(map.tiles[idx(map, f.x, f.y)]).toBe(Tile.Floor);
      }
    }
  });

  it('位置が重ならない', () => {
    for (let i = 0; i < 20; i++) {
      const { floors } = build(`DUP${i}`, 8);
      const keys = floors.map((f) => `${f.x},${f.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('取り返しがつかない床は迂回できる位置に置く', () => {
    for (let i = 0; i < 25; i++) {
      const rng = new Rng(hashSeed(`RISK${i}`));
      const map = generateMap(rng, 40, 30);
      const start = roomCenter(map.rooms[0]);
      const si = map.tiles.indexOf(Tile.StairsDown);
      const stairs = { x: si % map.width, y: Math.floor(si / map.width) };
      const floors = spawnFloors(rng, map, 10, start, stairs, []);
      for (const f of floors) {
        if (!isRisky(f.kind)) continue;
        expect(canDetour(map, start, stairs, f)).toBe(true);
      }
    }
  });

  it('浅い階には赤い床が出ない', () => {
    for (let i = 0; i < 30; i++) {
      const { floors } = build(`SHALLOW${i}`, 2);
      expect(floors.some((f) => f.kind === 'red')).toBe(false);
      expect(floors.some((f) => f.kind === 'yellow')).toBe(false);
    }
  });
});
