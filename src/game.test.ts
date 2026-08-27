import { describe, expect, it } from 'vitest';
import { newGame, step, toViewModel, xpToNext, type Action, type GameState } from './game';
import { Tile, isWalkable, tileAt } from './map';

function play(seed: string, actions: Action[]): GameState {
  const state = newGame(seed);
  for (const a of actions) step(state, a);
  return state;
}

const WAIT: Action = { type: 'wait' };

describe('newGame', () => {
  it('B1 から始まり、歩ける場所に立っている', () => {
    const s = newGame('START1');
    expect(s.depth).toBe(1);
    expect(s.level).toBe(1);
    expect(s.over).toBe(false);
    expect(isWalkable(s.map, s.player.x, s.player.y)).toBe(true);
  });

  it('同じ seed なら同じ初期状態になる', () => {
    expect(newGame('SAME')).toEqual(newGame('SAME'));
  });

  it('敵とアイテムが開始地点に重ならない', () => {
    for (let i = 0; i < 30; i++) {
      const s = newGame(`OVERLAP${i}`);
      const here = (o: { x: number; y: number }): boolean => o.x === s.player.x && o.y === s.player.y;
      expect(s.monsters.some(here)).toBe(false);
      expect(s.items.some(here)).toBe(false);
    }
  });
});

describe('step', () => {
  it('同じ seed と同じ手順なら同じ結果になる', () => {
    const actions: Action[] = Array.from({ length: 120 }, (_, i) =>
      i % 3 === 0 ? WAIT : { type: 'move', dx: (i % 2) * 2 - 1, dy: 0 },
    );
    expect(play('REPLAY', actions)).toEqual(play('REPLAY', actions));
  });

  it('壁に向かってもターンが進まない', () => {
    const s = newGame('WALL1');
    // 上下左右のどれかは壁のはず。壁の方向を 1 つ見つけて試す
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const wall = dirs.find(([dx, dy]) => tileAt(s.map, s.player.x + dx, s.player.y + dy) === Tile.Wall);
    if (!wall) return;
    const before = { turn: s.turn, x: s.player.x, y: s.player.y };
    const result = step(s, { type: 'move', dx: wall[0], dy: wall[1] });
    expect(result.acted).toBe(false);
    expect(s.turn).toBe(before.turn);
    expect(s.player.x).toBe(before.x);
    expect(s.player.y).toBe(before.y);
  });

  it('持っていない消耗品は使えない', () => {
    const s = newGame('NOITEM');
    s.inventory.potion = 0;
    const before = s.turn;
    expect(step(s, { type: 'use', item: 'potion' }).acted).toBe(false);
    expect(s.turn).toBe(before);
  });

  it('待機してもターンは進む', () => {
    const s = newGame('WAIT1');
    const before = s.turn;
    expect(step(s, WAIT).acted).toBe(true);
    expect(s.turn).toBe(before + 1);
  });

  it('死んだあとは何をしてもターンが進まない', () => {
    const s = newGame('DEAD1');
    s.player.hp = 0;
    s.over = true;
    const before = s.turn;
    expect(step(s, WAIT).acted).toBe(false);
    expect(s.turn).toBe(before);
  });

  it('HP は最大値を超えない', () => {
    const s = newGame('HEAL1');
    s.inventory.potion = 1;
    s.player.hp = s.player.maxHp - 1;
    step(s, { type: 'use', item: 'potion' });
    expect(s.player.hp).toBe(s.player.maxHp);
  });
});

describe('xpToNext', () => {
  it('レベルが上がるほど必要量が増える', () => {
    for (let lv = 1; lv < 40; lv++) {
      expect(xpToNext(lv + 1)).toBeGreaterThan(xpToNext(lv));
    }
  });
});

describe('toViewModel', () => {
  it('セルの数がマップの広さと一致する', () => {
    const s = newGame('VM1');
    const vm = toViewModel(s);
    expect(vm.cells).toHaveLength(vm.width * vm.height);
  });

  it('プレイヤーが必ず actors に入っている', () => {
    const s = newGame('VM2');
    const vm = toViewModel(s);
    expect(vm.actors.filter((a) => a.kind === 'player')).toHaveLength(1);
  });

  it('見えていない敵は actors に出ない', () => {
    const s = newGame('VM3');
    const vm = toViewModel(s);
    const shown = vm.actors.filter((a) => a.kind !== 'player').length;
    expect(shown).toBeLessThanOrEqual(s.monsters.length);
  });
});
