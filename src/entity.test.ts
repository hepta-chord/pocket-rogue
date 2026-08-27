import { describe, expect, it } from 'vitest';
import {
  FAMILY_NAMES,
  MONSTERS,
  createMonster,
  familyOf,
  spawnMonsters,
  type MonsterKind,
} from './entity';
import { generateMap, idx, isWalkable, roomCenter } from './map';
import { Rng, hashSeed } from './rng';

const KINDS = Object.keys(MONSTERS) as MonsterKind[];

describe('MONSTERS', () => {
  it('すべての敵に系統が付いている', () => {
    for (const k of KINDS) {
      expect(FAMILY_NAMES[MONSTERS[k].family]).toBeTruthy();
    }
  });

  it('系統ごとの割り当てが BACKLOG 7.1 の表と一致する', () => {
    const byFamily: Record<string, MonsterKind[]> = {};
    for (const k of KINDS) (byFamily[MONSTERS[k].family] ??= []).push(k);
    expect(byFamily).toEqual({
      swarm: ['rat'],
      swift: ['bat', 'wolf'],
      warrior: ['goblin', 'orc'],
      odd: ['slime', 'ghost'],
      heavy: ['troll'],
      boss: ['dragon'],
    });
  });

  it('familyOf はプレイヤーに null を返す', () => {
    expect(familyOf('player')).toBeNull();
    expect(familyOf('troll')).toBe('heavy');
  });

  it('出現階の範囲が逆転していない', () => {
    for (const k of KINDS) {
      expect(MONSTERS[k].minDepth).toBeLessThanOrEqual(MONSTERS[k].maxDepth);
      expect(MONSTERS[k].pack[0]).toBeLessThanOrEqual(MONSTERS[k].pack[1]);
      expect(MONSTERS[k].weight).toBeGreaterThan(0);
    }
  });
});

describe('createMonster', () => {
  it('深いほど HP と攻撃力が上がる', () => {
    const shallow = createMonster('orc', 4, 0, 0, 1);
    const deep = createMonster('orc', 16, 0, 0, 2);
    expect(deep.hp).toBeGreaterThan(shallow.hp);
    expect(deep.atk).toBeGreaterThan(shallow.atk);
    expect(deep.hp).toBe(deep.maxHp);
  });
});

describe('spawnMonsters', () => {
  it('出現階の条件を守り、歩ける場所にだけ置く', () => {
    for (let i = 0; i < 20; i++) {
      const rng = new Rng(hashSeed(`SPAWN${i}`));
      const depth = 1 + (i % 12);
      const map = generateMap(rng, 40, 30);
      const start = roomCenter(map.rooms[0]);
      let id = 1;
      const monsters = spawnMonsters(rng, map, depth, start, () => id++);
      for (const m of monsters) {
        const def = MONSTERS[m.kind as MonsterKind];
        expect(def.minDepth).toBeLessThanOrEqual(depth);
        expect(depth).toBeLessThanOrEqual(def.maxDepth);
        expect(isWalkable(map, m.x, m.y)).toBe(true);
        expect(idx(map, m.x, m.y)).not.toBe(idx(map, start.x, start.y));
      }
      // id は重複しない
      expect(new Set(monsters.map((m) => m.id)).size).toBe(monsters.length);
    }
  });

  it('1 階あたりの上限を守る', () => {
    for (let i = 0; i < 20; i++) {
      const rng = new Rng(hashSeed(`CAP${i}`));
      const map = generateMap(rng, 40, 30);
      const start = roomCenter(map.rooms[0]);
      let id = 1;
      const monsters = spawnMonsters(rng, map, 6, start, () => id++);
      for (const k of KINDS) {
        const n = monsters.filter((m) => m.kind === k).length;
        // 群れは 1 回の抽選でまとめて置くので、上限は抽選回数に対して効く
        if (MONSTERS[k].pack[1] === 1) expect(n).toBeLessThanOrEqual(MONSTERS[k].maxPerFloor);
      }
    }
  });
});
