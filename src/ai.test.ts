import { describe, expect, it } from 'vitest';
import { createMonster, type MonsterKind } from './entity';
import { newGame, step, type GameState } from './game';
import { Tile } from './map';

/** 文字列の絵からマップを作り、P の位置にプレイヤーを置く */
function stage(seed: string, layout: string[], kinds: [MonsterKind, number, number][]): GameState {
  const h = layout.length;
  const w = layout[0].length;
  const state = newGame(seed);
  const tiles: Tile[] = [];
  let start = { x: 1, y: 1 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = layout[y][x];
      tiles.push(c === '#' ? Tile.Wall : Tile.Floor);
      if (c === 'P') start = { x, y };
    }
  }
  state.map = { kind: 'rooms', width: w, height: h, tiles, rooms: [], start, links: [], stairsRoom: -1 };
  state.player.x = start.x;
  state.player.y = start.y;
  state.player.maxHp = 9999;
  state.player.hp = 9999;
  state.items = [];
  state.floors = [];
  state.monsters = kinds.map(([kind, x, y], i) => createMonster(kind, 1, x, y, 100 + i));
  state.visible = new Array<number>(w * h).fill(1);
  state.explored = new Array<number>(w * h).fill(1);
  state.prompt = null;
  return state;
}

function adjacent(s: GameState): number {
  const p = s.player;
  return s.monsters.filter((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1).length;
}

/** プレイヤーは動かず、敵の手番だけ進める */
function waitTurns(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) step(s, { type: 'wait' });
}

describe('敵の移動', () => {
  it('通路では列を作り、隣接するのは 1 体だけ', () => {
    const s = stage(
      'AI-CORRIDOR',
      [
        '##########',
        '#P.......#',
        '##########',
      ],
      [
        ['rat', 5, 1],
        ['rat', 6, 1],
        ['rat', 7, 1],
      ],
    );
    waitTurns(s, 10);
    expect(adjacent(s)).toBe(1);
  });

  it('部屋では散って囲む', () => {
    const s = stage(
      'AI-ROOM',
      [
        '#########',
        '#.......#',
        '#...r...#',
        '#...r...#',
        '#...r...#',
        '#.......#',
        '#...P...#',
        '#.......#',
        '#########',
      ].map((row) => row.replace(/r/g, '.')),
      [
        ['rat', 4, 2],
        ['rat', 4, 3],
        ['rat', 4, 4],
      ],
    );
    waitTurns(s, 10);
    expect(adjacent(s)).toBeGreaterThanOrEqual(2);
  });

  it('前を塞がれても停止せず、回り込む', () => {
    const s = stage(
      'AI-DETOUR',
      [
        '#########',
        '#.......#',
        '#.......#',
        '#...P...#',
        '#.......#',
        '#.......#',
        '#########',
      ],
      [
        ['rat', 4, 1],
        ['rat', 4, 0 + 1],
      ],
    );
    // 同じマスに重ねない配置に直す
    s.monsters[1].x = 4;
    s.monsters[1].y = 5;
    const before = s.monsters.map((m) => `${m.x},${m.y}`).join('/');
    waitTurns(s, 6);
    const after = s.monsters.map((m) => `${m.x},${m.y}`).join('/');
    expect(after).not.toBe(before);
    expect(adjacent(s)).toBe(2);
  });

  it('壁抜けは壁の中を通って寄ってくる', () => {
    const s = stage(
      'AI-PHASE',
      [
        '#########',
        '#P#####.#',
        '#########',
      ],
      [['slimeSplit', 7, 1]],
    );
    s.monsters[0] = createMonster('slimeSplit', 11, 7, 1, 100);
    const startX = s.monsters[0].x;
    waitTurns(s, 8);
    expect(s.monsters[0].x).toBeLessThan(startX);
  });
});
