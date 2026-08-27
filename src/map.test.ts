import { describe, expect, it } from 'vitest';
import { Tile, canDetour, canStep, generateMap, idx, roomCenter, type GameMap } from './map';
import { Rng, hashSeed } from './rng';

const W = 40;
const H = 30;

function build(seed: string): GameMap {
  return generateMap(new Rng(hashSeed(seed)), W, H);
}

/** 開始地点から歩いて届くマスを塗る。角の斜め移動の制限を守る */
function reachable(map: GameMap, from: { x: number; y: number }): Set<number> {
  const seen = new Set<number>([idx(map, from.x, from.y)]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!canStep(map, x, y, dx, dy)) continue;
        const i = idx(map, nx, ny);
        if (seen.has(i)) continue;
        seen.add(i);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

describe('canStep', () => {
  // . = 床、# = 壁 の 3x3 を作る
  const grid = (rows: string[]): GameMap => ({
    width: rows[0].length,
    height: rows.length,
    tiles: rows.flatMap((r) => [...r].map((c) => (c === '#' ? Tile.Wall : Tile.Floor))),
    rooms: [],
  });

  it('直交の移動は制限しない', () => {
    const map = grid(['#.#', '...', '#.#']);
    expect(canStep(map, 1, 1, 0, -1)).toBe(true);
    expect(canStep(map, 1, 1, 1, 0)).toBe(true);
  });

  it('壁には入れない', () => {
    const map = grid(['###', '...', '###']);
    expect(canStep(map, 1, 1, 0, -1)).toBe(false);
  });

  it('両隣が壁の斜めは通さない', () => {
    const map = grid(['..#', '.@#', '##.']);
    // (1,1) から右下 (2,2) へ。右 (2,1) と下 (1,2) がどちらも壁
    expect(canStep(map, 1, 1, 1, 1)).toBe(false);
  });

  it('片方が空いていれば斜めに通れる', () => {
    const map = grid(['...', '..#', '#..']);
    // (1,1) から右下 (2,2) へ。右 (2,1) は壁だが下 (1,2) は床
    expect(canStep(map, 1, 1, 1, 1)).toBe(true);
  });

  it('斜め先が壁なら両隣によらず通さない', () => {
    const map = grid(['...', '...', '..#']);
    expect(canStep(map, 1, 1, 1, 1)).toBe(false);
  });
});

describe('canDetour', () => {
  const grid = (rows: string[]): GameMap => ({
    width: rows[0].length,
    height: rows.length,
    tiles: rows.flatMap((r) => [...r].map((c) => (c === '#' ? Tile.Wall : Tile.Floor))),
    rooms: [],
  });

  it('広い部屋なら 1 マス塞いでも回り道がある', () => {
    const map = grid(['#####', '#...#', '#...#', '#...#', '#####']);
    expect(canDetour(map, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: 2, y: 2 })).toBe(true);
  });

  it('唯一の通路を塞ぐと届かない', () => {
    const map = grid(['#####', '#.#.#', '#.#.#', '#...#', '#####']);
    expect(canDetour(map, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 3 })).toBe(false);
  });

  it('起点や終点そのものは塞げない', () => {
    const map = grid(['#####', '#...#', '#...#', '#...#', '#####']);
    expect(canDetour(map, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 1 })).toBe(false);
    expect(canDetour(map, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: 3, y: 3 })).toBe(false);
  });
});

describe('generateMap', () => {
  const seeds = Array.from({ length: 60 }, (_, i) => `MAP${i}`);

  it('部屋が 2 つ以上できる', () => {
    for (const s of seeds) expect(build(s).rooms.length).toBeGreaterThanOrEqual(2);
  });

  it('下り階段がちょうど 1 つある', () => {
    for (const s of seeds) {
      const map = build(s);
      expect(map.tiles.filter((t) => t === Tile.StairsDown)).toHaveLength(1);
    }
  });

  it('開始地点から階段まで歩いて届く', () => {
    for (const s of seeds) {
      const map = build(s);
      const start = roomCenter(map.rooms[0]);
      const stairs = map.tiles.indexOf(Tile.StairsDown);
      expect(reachable(map, start).has(stairs)).toBe(true);
    }
  });

  it('外周は壁のまま残る', () => {
    for (const s of seeds) {
      const map = build(s);
      for (let x = 0; x < W; x++) {
        expect(map.tiles[idx(map, x, 0)]).toBe(Tile.Wall);
        expect(map.tiles[idx(map, x, H - 1)]).toBe(Tile.Wall);
      }
      for (let y = 0; y < H; y++) {
        expect(map.tiles[idx(map, 0, y)]).toBe(Tile.Wall);
        expect(map.tiles[idx(map, W - 1, y)]).toBe(Tile.Wall);
      }
    }
  });

  it('同じ seed なら同じ地形になる', () => {
    expect(build('SAME')).toEqual(build('SAME'));
  });
});
