import { describe, expect, it } from 'vitest';
import {
  FAMILY_NAMES,
  MONSTERS,
  STALKER,
  bountyFor,
  createMonster,
  familyOf,
  gradeAt,
  spawnMonsters,
  xpFor,
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

  it('5 系統 × 3 グレードの 15 種と、ボス枠がある', () => {
    const byFamily: Record<string, MonsterKind[]> = {};
    for (const k of KINDS) (byFamily[MONSTERS[k].family] ??= []).push(k);
    for (const f of ['swarm', 'swift', 'warrior', 'odd', 'heavy']) {
      expect(byFamily[f]).toHaveLength(3);
      expect(byFamily[f].map((k) => MONSTERS[k].grade).sort()).toEqual([1, 2, 3]);
    }
    // ボス枠はドラゴンと追う者
    expect(byFamily.boss).toEqual(['dragon', 'stalker']);
  });

  it('グレードごとに出現する階が 10 階ずつずれている', () => {
    for (const k of KINDS) {
      const d = MONSTERS[k];
      if (d.family === 'boss') continue;
      if (d.grade === 1) expect(d.maxDepth).toBe(10);
      if (d.grade === 2) {
        expect(d.minDepth).toBe(11);
        expect(d.maxDepth).toBe(20);
      }
      if (d.grade === 3) expect(d.minDepth).toBe(21);
    }
  });

  it('グレードの境目で数値が飛ばない', () => {
    const families = ['swarm', 'swift', 'warrior', 'odd', 'heavy'] as const;
    for (const f of families) {
      const byGrade = KINDS.filter((k) => MONSTERS[k].family === f).sort(
        (a, b) => MONSTERS[a].grade - MONSTERS[b].grade,
      );
      for (let i = 0; i + 1 < byGrade.length; i++) {
        const lower = MONSTERS[byGrade[i]];
        const upper = MONSTERS[byGrade[i + 1]];
        // 下のグレードが最深部で持つ値と、上のグレードの基礎値を比べる
        const atEnd = createMonster(byGrade[i], lower.maxDepth, 0, 0, 1);
        const atStart = createMonster(byGrade[i + 1], upper.minDepth, 0, 0, 2);
        expect(atStart.hp).toBeGreaterThanOrEqual(atEnd.hp);
        expect(atStart.atk).toBeGreaterThanOrEqual(atEnd.atk);
        // 飛びすぎないこと (HP は 1.6 倍まで)
        expect(atStart.hp).toBeLessThanOrEqual(Math.ceil(atEnd.hp * 1.6));
      }
    }
  });

  it('グレードが上がるほど経験値が増える', () => {
    const families = ['swarm', 'swift', 'warrior', 'odd', 'heavy'] as const;
    for (const f of families) {
      const byGrade = KINDS.filter((k) => MONSTERS[k].family === f).sort(
        (a, b) => MONSTERS[a].grade - MONSTERS[b].grade,
      );
      for (let i = 0; i + 1 < byGrade.length; i++) {
        expect(MONSTERS[byGrade[i + 1]].xp).toBeGreaterThan(MONSTERS[byGrade[i]].xp);
      }
    }
  });

  it('名前から系統が読めるように、同じ系統は同じ生き物を基にしている', () => {
    const base: Record<string, string> = {
      swarm: 'ネズミ',
      swift: 'コウモリ',
      warrior: 'ゴブリン',
      odd: 'スライム',
      heavy: 'トロル',
    };
    for (const k of KINDS) {
      const d = MONSTERS[k];
      if (d.family === 'boss') continue;
      expect(d.name).toContain(base[d.family]);
    }
  });

  it('familyOf はプレイヤーに null を返す', () => {
    expect(familyOf('player')).toBeNull();
    expect(familyOf('troll')).toBe('heavy');
  });

  it('gradeAt が 10 階ごとに切り替わり、3 で止まる', () => {
    expect(gradeAt(1)).toBe(1);
    expect(gradeAt(10)).toBe(1);
    expect(gradeAt(11)).toBe(2);
    expect(gradeAt(20)).toBe(2);
    expect(gradeAt(21)).toBe(3);
    expect(gradeAt(30)).toBe(3);
    expect(gradeAt(60)).toBe(3);
  });

  it('どの階にも出せる敵がいる', () => {
    for (let depth = 1; depth <= 40; depth++) {
      const pool = KINDS.filter((k) => {
        const d = MONSTERS[k];
        return d.minDepth <= depth && depth <= d.maxDepth && d.weight > 0;
      });
      expect(pool.length).toBeGreaterThan(0);
    }
  });

  it('出現階の範囲が逆転していない', () => {
    for (const k of KINDS) {
      expect(MONSTERS[k].minDepth).toBeLessThanOrEqual(MONSTERS[k].maxDepth);
      expect(MONSTERS[k].pack[0]).toBeLessThanOrEqual(MONSTERS[k].pack[1]);
      expect(MONSTERS[k].weight).toBeGreaterThanOrEqual(0);
    }
  });

  it('追う者は通常の配置では出ず、経験値が 0 でスコアだけ出る', () => {
    const def = MONSTERS[STALKER];
    expect(def.weight).toBe(0);
    expect(def.xp).toBe(0);
    expect(bountyFor(def, 10)).toBeGreaterThan(0);
    expect(xpFor(def, 10)).toBe(0);
    // 逃げ切れる必要があるので速くしない
    expect(def.passives).not.toContain('fast');
  });

  it('bounty を省くと経験値と同じ値になる', () => {
    expect(bountyFor(MONSTERS.goblin, MONSTERS.goblin.minDepth)).toBe(MONSTERS.goblin.xp);
  });

  it('同じ敵でも階が深いほど経験値が増える', () => {
    const def = MONSTERS.goblin;
    expect(xpFor(def, def.minDepth)).toBe(def.xp);
    expect(xpFor(def, def.minDepth + 5)).toBeGreaterThan(def.xp);
    expect(xpFor(def, def.maxDepth)).toBeGreaterThan(xpFor(def, def.minDepth + 5));
  });
});

describe('createMonster', () => {
  it('深いほど HP と攻撃力が上がる', () => {
    const shallow = createMonster('goblin', 4, 0, 0, 1);
    const deep = createMonster('goblin', 10, 0, 0, 2);
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
