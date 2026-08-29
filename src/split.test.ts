import { describe, expect, it } from 'vitest';
import { SLIME_CAP, SPLIT_REWARD, createMonster, xpFor, MONSTERS } from './entity';
import { newGame, step, type GameState } from './game';
import { Tile } from './map';

/** 開けた 9 x 9 の部屋を作り、中央にプレイヤーを置く */
function room(seed: string): GameState {
  const W = 9;
  const H = 9;
  const state = newGame(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      tiles.push(edge ? Tile.Wall : Tile.Floor);
    }
  }
  state.map = {
    kind: 'rooms',
    width: W,
    height: H,
    tiles,
    rooms: [],
    start: { x: 4, y: 4 },
    links: [],
    stairsRoom: -1,
  };
  state.player.x = 4;
  state.player.y = 4;
  state.player.maxHp = 9999;
  state.player.hp = 9999;
  state.items = [];
  state.floors = [];
  state.monsters = [];
  state.visible = new Array<number>(W * H).fill(1);
  state.explored = new Array<number>(W * H).fill(1);
  state.prompt = null;
  state.weapon = { id: 'swiftSpear', power: 1 };
  return state;
}

describe('分裂', () => {
  it('グレード 2 以降でも上限が働く', () => {
    const s = room('SPLIT1');
    s.monsters = [createMonster('slimeSplit', 11, 5, 4, 100)];
    s.depth = 11;

    // 隣を殴り続ける。倒しても次の個体が隣に来るまで待つ
    for (let i = 0; i < 200; i++) {
      const alive = s.monsters.filter((m) => m.kind === 'slimeSplit');
      expect(alive.length).toBeLessThanOrEqual(SLIME_CAP);
      const next = alive.find(
        (m) => Math.max(Math.abs(m.x - s.player.x), Math.abs(m.y - s.player.y)) === 1,
      );
      if (!next) break;
      step(s, { type: 'move', dx: Math.sign(next.x - s.player.x), dy: Math.sign(next.y - s.player.y) });
    }
  });

  it('分裂体は装備を落とさない', () => {
    const s = room('SPLIT2');
    s.depth = 11;
    const parent = createMonster('slimeSplit', 11, 5, 4, 100);
    parent.hp = 1;
    parent.split = true;
    s.monsters = [parent];

    step(s, { type: 'move', dx: 1, dy: 0 });
    expect(s.monsters.length).toBe(0);
    expect(s.items.length).toBe(0);
  });

  it('分裂体の報酬は SPLIT_REWARD 倍になる', () => {
    // 経験値はレベルアップで繰り上がるので、同じ倍率が乗るスコアで比べる
    const gain = (seed: string, split: boolean): number => {
      const s = room(seed);
      s.depth = 11;
      const m = createMonster('slimeSplit', 11, 5, 4, 100);
      m.hp = 1;
      if (split) m.split = true;
      s.monsters = [m];
      const before = s.score;
      step(s, { type: 'move', dx: 1, dy: 0 });
      expect(s.monsters.length).toBe(0);
      return s.score - before;
    };

    const base = xpFor(MONSTERS.slimeSplit, 11);
    expect(gain('SPLIT3', false)).toBe(base);
    expect(gain('SPLIT4', true)).toBe(Math.ceil(base * SPLIT_REWARD));
  });
});
