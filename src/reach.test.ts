import { describe, expect, it } from 'vitest';
import { createMonster, type Actor } from './entity';
import { newGame, step, type GameState } from './game';
import { Tile } from './map';

/**
 * 壁の角を挟んだ配置を作る。
 *
 * ```
 * #####
 * #P.##
 * ##M.#
 * #####
 * ```
 *
 * P(1,1) から M(2,2) は斜めだが、(1,2) が壁なので角越しになる。
 * (2,1) を通れば 2 歩で回り込める。
 */
const W = 5;
const H = 4;
const LAYOUT = ['#####', '#P.##', '##M.#', '#####'];

function corner(seed: string, monsterKind: Parameters<typeof createMonster>[0], depth = 11): GameState {
  const state = newGame(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      tiles.push(LAYOUT[y][x] === '#' ? Tile.Wall : Tile.Floor);
    }
  }
  state.map = {
    kind: 'rooms',
    width: W,
    height: H,
    tiles,
    rooms: [],
    start: { x: 1, y: 1 },
    links: [],
    stairsRoom: -1,
  };
  state.player.x = 1;
  state.player.y = 1;
  state.player.hp = state.player.maxHp;
  state.items = [];
  state.floors = [];
  state.monsters = [createMonster(monsterKind, depth, 2, 2, 100)];
  state.visible = new Array<number>(W * H).fill(1);
  state.explored = new Array<number>(W * H).fill(1);
  state.prompt = null;
  return state;
}

const target = (s: GameState): Actor => s.monsters[0];

describe('角越しの攻撃', () => {
  it('プレイヤーは壁の角越しの敵を殴れない', () => {
    const s = corner('REACH1', 'goblinArmored');
    const before = target(s).hp;
    const r = step(s, { type: 'move', dx: 1, dy: 1 });

    expect(r.acted).toBe(false);
    expect(target(s).hp).toBe(before);
    // 動いてもいない
    expect(s.player.x).toBe(1);
    expect(s.player.y).toBe(1);
  });

  it('角を回り込めば殴れる', () => {
    const s = corner('REACH2', 'goblinArmored');
    // (2,1) へ横に動く。ここからなら (2,2) は真下なので届く
    step(s, { type: 'move', dx: 1, dy: 0 });
    expect(s.player.x).toBe(2);

    const before = target(s).hp;
    const r = step(s, { type: 'move', dx: 0, dy: 1 });
    expect(r.acted).toBe(true);
    expect(target(s).hp).toBeLessThan(before);
  });

  it('敵も壁の角越しにはプレイヤーを殴れない', () => {
    const s = corner('REACH3', 'goblinArmored');
    const before = s.player.hp;
    // 待つと敵の手番が回る
    step(s, { type: 'wait' });
    expect(s.player.hp).toBe(before);
  });

  it('壁抜けを持つ敵は角越しでも殴ってくる', () => {
    const s = corner('REACH4', 'slimeSplit');
    const before = s.player.hp;
    // 命中しない回もあるので数ターン見る。動かれると条件が崩れるため 1 ターンずつ確認する
    let hit = false;
    for (let i = 0; i < 12 && !hit; i++) {
      const m = target(s);
      if (!m || Math.max(Math.abs(m.x - s.player.x), Math.abs(m.y - s.player.y)) !== 1) break;
      step(s, { type: 'wait' });
      if (s.player.hp < before) hit = true;
    }
    expect(hit).toBe(true);
  });

  it('群れ薙ぎは角越しの敵を巻き込まない', () => {
    const s = corner('REACH5', 'ratPoison');
    // (2,1) にもう 1 体置き、群れ薙ぎで殴る
    s.monsters.push(createMonster('ratPoison', 11, 2, 1, 101));
    s.weapon = { id: 'swarmBlade', power: 9 };

    const cornerHp = target(s).hp;
    step(s, { type: 'move', dx: 1, dy: 0 });

    // 隣の 1 体は巻き込まれるが、角越しの 1 体は無傷のまま
    expect(target(s).hp).toBe(cornerHp);
  });
});
