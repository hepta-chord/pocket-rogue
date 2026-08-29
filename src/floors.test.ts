import { describe, expect, it } from 'vitest';
import { REST_SPAN, isRestFloor, spawnFloors } from './floors';
import { Tile, generateMap, idx, roomCenter, type GameMap } from './map';
import { Rng, hashSeed } from './rng';

describe('isRestFloor', () => {
  it('REST_SPAN の倍数の階だけ真になる', () => {
    for (let depth = 1; depth <= 30; depth++) {
      expect(isRestFloor(depth)).toBe(depth % REST_SPAN === 0);
    }
  });
});

describe('spawnFloors', () => {
  function build(seed: string, depth: number): { map: GameMap; floors: ReturnType<typeof spawnFloors> } {
    const rng = new Rng(hashSeed(seed));
    const map = generateMap(rng, 32, 24);
    const start = roomCenter(map.rooms[0]);
    return { map, floors: spawnFloors(rng, map, depth, start, []) };
  }

  it('REST_SPAN の倍数の階には休憩床が 1 つ出る', () => {
    for (let i = 0; i < 30; i++) {
      const { floors } = build(`REST${i}`, REST_SPAN);
      expect(floors).toHaveLength(1);
    }
  });

  it('それ以外の階には出ない', () => {
    for (let i = 0; i < 30; i++) {
      const depth = 1 + (i % (REST_SPAN - 1));
      const { floors } = build(`NONE${i}`, depth);
      expect(floors).toHaveLength(0);
    }
  });

  it('歩ける床の上にだけ置く', () => {
    for (let i = 0; i < 20; i++) {
      const { map, floors } = build(`SPOT${i}`, REST_SPAN * 2);
      for (const f of floors) {
        expect(map.tiles[idx(map, f.x, f.y)]).toBe(Tile.Floor);
      }
    }
  });

  it('開始地点や既に使われている位置には置かない', () => {
    for (let i = 0; i < 20; i++) {
      const rng = new Rng(hashSeed(`TAKEN${i}`));
      const map = generateMap(rng, 32, 24);
      const start = roomCenter(map.rooms[0]);
      const taken = [{ x: start.x + 1, y: start.y }];
      const floors = spawnFloors(rng, map, REST_SPAN * 3, start, taken);
      for (const f of floors) {
        expect(f.x === start.x && f.y === start.y).toBe(false);
        expect(taken.some((t) => t.x === f.x && t.y === f.y)).toBe(false);
      }
    }
  });
});
