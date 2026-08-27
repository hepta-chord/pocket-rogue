import { describe, expect, it } from 'vitest';
import {
  Tile,
  canDetour,
  canStep,
  deadEndRooms,
  generateMap,
  idx,
  randomFloorTile,
  roomDegrees,
  roomCenter,
  type GameMap,
} from './map';
import { Rng, hashSeed } from './rng';

const W = 40;
const H = 30;

function build(seed: string): GameMap {
  return generateMap(new Rng(hashSeed(seed)), W, H);
}

/** 開始地点から歩いて届くマスを塗る。角の斜め移動の制限を守る */
function isWalkableTile(map: GameMap, x: number, y: number): boolean {
  return map.tiles[idx(map, x, y)] !== Tile.Wall;
}

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
    kind: 'rooms',
    start: { x: 1, y: 1 },
    width: rows[0].length,
    height: rows.length,
    tiles: rows.flatMap((r) => [...r].map((c) => (c === '#' ? Tile.Wall : Tile.Floor))),
    rooms: [],
    links: [],
    stairsRoom: 0,
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

  it('片方だけ壁でも斜めには通れない (角を回り込めない)', () => {
    const map = grid(['...', '..#', '#..']);
    // (1,1) から右下 (2,2) へ。右 (2,1) が壁なので通れない
    expect(canStep(map, 1, 1, 1, 1)).toBe(false);
    // 左下 (0,2) も、下 (1,2) は床だが左 (0,1) が床、(0,2) が壁なので行き先で弾かれる
    expect(canStep(map, 1, 1, -1, 1)).toBe(false);
  });

  it('両隣が床なら斜めに通れる', () => {
    const map = grid(['...', '...', '...']);
    expect(canStep(map, 1, 1, 1, 1)).toBe(true);
    expect(canStep(map, 1, 1, -1, -1)).toBe(true);
  });

  it('斜め先が壁なら両隣によらず通さない', () => {
    const map = grid(['...', '...', '..#']);
    expect(canStep(map, 1, 1, 1, 1)).toBe(false);
  });
});

describe('階の作り', () => {
  const kinds = ['rooms', 'bigRoom', 'maze'] as const;

  function make(kind: (typeof kinds)[number], seed: string): GameMap {
    return generateMap(new Rng(hashSeed(seed)), W, H, kind);
  }

  it('どの作りでも開始地点が歩ける床で、階段が 1 つある', () => {
    for (const kind of kinds) {
      for (let i = 0; i < 20; i++) {
        const map = make(kind, `${kind}${i}`);
        expect(map.kind).toBe(kind);
        expect(isWalkableTile(map, map.start.x, map.start.y)).toBe(true);
        expect(map.tiles.filter((t) => t === Tile.StairsDown)).toHaveLength(1);
      }
    }
  });

  it('どの作りでも開始地点から階段まで歩いて届く', () => {
    for (const kind of kinds) {
      for (let i = 0; i < 20; i++) {
        const map = make(kind, `reach-${kind}${i}`);
        const stairs = map.tiles.indexOf(Tile.StairsDown);
        expect(reachable(map, map.start).has(stairs)).toBe(true);
      }
    }
  });

  it('大部屋は部屋が 1 つで、階段は開始地点と別の場所にある', () => {
    for (let i = 0; i < 20; i++) {
      const map = make('bigRoom', `big${i}`);
      expect(map.rooms).toHaveLength(1);
      const stairs = map.tiles.indexOf(Tile.StairsDown);
      expect(stairs).not.toBe(idx(map, map.start.x, map.start.y));
    }
  });

  it('迷路は部屋を持たず、行き止まりの部屋も無い', () => {
    for (let i = 0; i < 20; i++) {
      const map = make('maze', `maze${i}`);
      expect(map.rooms).toHaveLength(0);
      expect(deadEndRooms(map)).toHaveLength(0);
    }
  });

  it('迷路は部屋より通路が細い (床の割合が低い)', () => {
    const ratio = (map: GameMap): number =>
      map.tiles.filter((t) => t !== Tile.Wall).length / map.tiles.length;
    expect(ratio(make('maze', 'm1'))).toBeLessThan(ratio(make('bigRoom', 'b1')));
  });

  it('randomFloorTile は歩ける床だけを返す', () => {
    for (const kind of kinds) {
      const map = make(kind, `rf-${kind}`);
      const rng = new Rng(hashSeed('pick'));
      for (let i = 0; i < 200; i++) {
        const at = randomFloorTile(rng, map);
        expect(at).not.toBeNull();
        if (at) expect(map.tiles[idx(map, at.x, at.y)]).toBe(Tile.Floor);
      }
    }
  });
});

describe('canDetour', () => {
  const grid = (rows: string[]): GameMap => ({
    kind: 'rooms',
    start: { x: 1, y: 1 },
    width: rows[0].length,
    height: rows.length,
    tiles: rows.flatMap((r) => [...r].map((c) => (c === '#' ? Tile.Wall : Tile.Floor))),
    rooms: [],
    links: [],
    stairsRoom: 0,
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

  it('すべての部屋が繋がっている', () => {
    for (const s of seeds) {
      const map = build(s);
      const start = roomCenter(map.rooms[0]);
      const reach = reachable(map, start);
      for (const r of map.rooms) {
        const c = roomCenter(r);
        expect(reach.has(idx(map, c.x, c.y))).toBe(true);
      }
    }
  });

  it('接続の本数が部屋の数より 1 少ない (木になっている)', () => {
    for (const s of seeds) {
      const map = build(s);
      expect(map.links).toHaveLength(map.rooms.length - 1);
    }
  });

  it('階段は開始部屋ではない', () => {
    for (const s of seeds) {
      expect(build(s).stairsRoom).not.toBe(0);
    }
  });

  it('行き止まりの部屋ができる', () => {
    let withDeadEnd = 0;
    for (const s of seeds) {
      const map = build(s);
      const ends = deadEndRooms(map);
      // 開始部屋と階段部屋は除いてある
      expect(ends).not.toContain(0);
      expect(ends).not.toContain(map.stairsRoom);
      for (const i of ends) expect(roomDegrees(map)[i]).toBe(1);
      if (ends.length > 0) withDeadEnd++;
    }
    // 一本鎖だった頃は 0 件だった。過半数の階でできていれば配置先として使える
    expect(withDeadEnd).toBeGreaterThan(seeds.length / 2);
  });
});
