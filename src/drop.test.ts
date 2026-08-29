import { describe, expect, it } from 'vitest';
import { freeFloorNear, newGame, step, type GameState } from './game';
import { Tile, tileAt } from './map';

/**
 * 盤面を作る。`P` がプレイヤー、`#` が壁、`>` が階段。
 * 罠・休憩床・アイテムは呼び出し側が置く。
 */
function board(seed: string, layout: string[]): GameState {
  const width = layout[0].length;
  const height = layout.length;
  const tiles: Tile[] = [];
  let start = { x: 1, y: 1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = layout[y][x];
      tiles.push(c === '#' ? Tile.Wall : c === '>' ? Tile.StairsDown : Tile.Floor);
      if (c === 'P') start = { x, y };
    }
  }
  const s = newGame(seed);
  s.map = { kind: 'rooms', width, height, tiles, rooms: [], start, links: [], stairsRoom: -1 };
  s.player.x = start.x;
  s.player.y = start.y;
  s.items = [];
  s.floors = [];
  s.traps = [];
  s.monsters = [];
  s.visible = new Array<number>(width * height).fill(1);
  s.explored = new Array<number>(width * height).fill(1);
  s.prompt = null;
  return s;
}

/** 返ってきたマスが「何も無い床」であることを確かめる */
function expectFree(s: GameState, at: { x: number; y: number } | null): void {
  expect(at).not.toBeNull();
  const { x, y } = at!;
  expect(tileAt(s.map, x, y)).toBe(Tile.Floor);
  expect(s.traps.some((t) => t.x === x && t.y === y)).toBe(false);
  expect(s.floors.some((f) => f.x === x && f.y === y)).toBe(false);
  expect(s.items.some((it) => it.x === x && it.y === y)).toBe(false);
}

describe('落とし物の置き場所', () => {
  it('壁の中で倒しても、隣の床に落ちる', () => {
    // 壁抜けの敵は壁の中で死ぬ。そこに置くと拾いに行けない
    const s = board('DROPW', ['#####', '#P#.#', '#...#', '#####']);
    expectFree(s, freeFloorNear(s, { x: 2, y: 1 }));
  });

  it('階段の上には落ちない', () => {
    const s = board('DROPS', ['#####', '#P>.#', '#####']);
    const at = freeFloorNear(s, { x: 2, y: 1 });
    expectFree(s, at);
    expect(at).not.toEqual({ x: 2, y: 1 });
  });

  it('罠の上には落ちない', () => {
    const s = board('DROPT', ['#####', '#P..#', '#####']);
    s.traps = [{ kind: 'pit', x: 2, y: 1, found: false }];
    expectFree(s, freeFloorNear(s, { x: 2, y: 1 }));
  });

  it('休憩床の上には落ちない', () => {
    const s = board('DROPF', ['#####', '#P..#', '#####']);
    s.floors = [{ x: 2, y: 1 }];
    expectFree(s, freeFloorNear(s, { x: 2, y: 1 }));
  });

  it('他のアイテムの上には落ちない', () => {
    const s = board('DROPI', ['#####', '#P..#', '#####']);
    s.items = [{ kind: 'potion', x: 2, y: 1, power: 0 }];
    expectFree(s, freeFloorNear(s, { x: 2, y: 1 }));
  });

  it('壁の向こう側には落ちない。歩いて取りに行ける場所だけを返す', () => {
    // (3,1) は壁で仕切られた反対側。近くても選ばない
    const s = board('DROPB', ['#####', '#P#.#', '#.###', '#####']);
    s.items = [{ kind: 'potion', x: 1, y: 1, power: 0 }];
    expect(freeFloorNear(s, { x: 1, y: 1 })).toEqual({ x: 1, y: 2 });
  });

  it('置ける床が無ければ null を返す', () => {
    const s = board('DROPN', ['###', '#P#', '###']);
    s.items = [{ kind: 'potion', x: 1, y: 1, power: 0 }];
    expect(freeFloorNear(s, { x: 1, y: 1 })).toBeNull();
  });
});

/** 1 マスに 2 つ以上乗っているものを挙げる */
function overlaps(s: GameState): string[] {
  const bad: string[] = [];
  for (const it of s.items) {
    const where = `(${it.x},${it.y}) ${it.kind}`;
    if (tileAt(s.map, it.x, it.y) !== Tile.Floor) bad.push(`${where} が床でない場所にある`);
    if (s.traps.some((t) => t.x === it.x && t.y === it.y)) bad.push(`${where} が罠と重なっている`);
    if (s.floors.some((f) => f.x === it.x && f.y === it.y)) bad.push(`${where} が休憩床と重なっている`);
    if (s.items.filter((o) => o.x === it.x && o.y === it.y).length > 1) bad.push(`${where} がアイテムと重なっている`);
  }
  return bad;
}

const DIRS: [number, number][] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
];

describe('遊んでいる間ずっと', () => {
  it('アイテムが他のものと重ならない', () => {
    const found: string[] = [];
    for (let n = 0; n < 20 && found.length === 0; n++) {
      const s = newGame(`OVERLAP${n}`);
      for (let t = 0; t < 500 && !s.over; t++) {
        // 確認は受ける。降りる確認も受けるので、run はどんどん深くなる
        if (s.prompt) {
          step(s, { type: 'confirm' });
        } else {
          const [dx, dy] = DIRS[(t * 3 + n) % DIRS.length];
          step(s, { type: 'move', dx, dy });
        }
        const bad = overlaps(s);
        if (bad.length > 0) {
          found.push(`seed OVERLAP${n} / ${t} ターン目: ${bad.join(', ')}`);
          break;
        }
      }
    }
    expect(found).toEqual([]);
  });
});
