import { describe, expect, it } from 'vitest';
import { FAMILY_NAMES, type MonsterFamily } from './entity';
import {
  ARMORS,
  ARMOR_IDS,
  BARE_ACCURACY,
  WEAPONS,
  WEAPON_IDS,
  armorDefense,
  armorEvasion,
  armorHas,
  equipDef,
  equipName,
  equipSummary,
  weaponAccuracy,
  weaponAtk,
  weaponHas,
  type EquipId,
} from './equip';
import { pickDropEquip, pickFloorEquip } from './items';
import { Rng, hashSeed } from './rng';

const ALL: EquipId[] = [...WEAPON_IDS, ...ARMOR_IDS];

describe('装備の定義', () => {
  it('武器 10 種、防具 10 種ある', () => {
    expect(WEAPON_IDS).toHaveLength(10);
    expect(ARMOR_IDS).toHaveLength(10);
  });

  it('slot が種別と一致する', () => {
    for (const id of WEAPON_IDS) expect(WEAPONS[id].slot).toBe('weapon');
    for (const id of ARMOR_IDS) expect(ARMORS[id].slot).toBe('armor');
  });

  it('名前が重複しない', () => {
    const names = ALL.map((id) => equipDef(id).name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('命中率と回避率が 0〜1 に収まる', () => {
    for (const id of WEAPON_IDS) {
      expect(WEAPONS[id].accuracy).toBeGreaterThan(0);
      expect(WEAPONS[id].accuracy).toBeLessThanOrEqual(1);
    }
    for (const id of ARMOR_IDS) {
      expect(ARMORS[id].evasion).toBeGreaterThanOrEqual(0);
      // 回避が高すぎると被弾しない run が出るので上限を決めてある
      expect(ARMORS[id].evasion).toBeLessThanOrEqual(0.3);
    }
  });

  it('系統ごとに特効の武器と防具が 1 つずつある', () => {
    const families = (Object.keys(FAMILY_NAMES) as MonsterFamily[]).filter((f) => f !== 'boss');
    for (const f of families) {
      expect(WEAPON_IDS.filter((id) => WEAPONS[id].bane === f)).toHaveLength(1);
      expect(ARMOR_IDS.filter((id) => ARMORS[id].bane === f)).toHaveLength(1);
    }
  });

  it('基礎装備が武器・防具それぞれ 3 種ある', () => {
    expect(WEAPON_IDS.filter((id) => !WEAPONS[id].bane && !WEAPONS[id].dropOnly)).toHaveLength(3);
    expect(ARMOR_IDS.filter((id) => !ARMORS[id].bane && !ARMORS[id].dropOnly)).toHaveLength(3);
  });

  it('ドロップ限定は系統を持たない', () => {
    for (const id of ALL) {
      const def = equipDef(id);
      if (def.dropOnly) expect(def.bane).toBeNull();
    }
  });

  it('単純な上位互換が無い (どの基礎装備も一方的に劣らない)', () => {
    const base = WEAPON_IDS.filter((id) => !WEAPONS[id].bane && !WEAPONS[id].dropOnly);
    for (const a of base) {
      for (const b of base) {
        if (a === b) continue;
        const x = WEAPONS[a];
        const y = WEAPONS[b];
        const worseBoth = x.atkBonus <= y.atkBonus && x.accuracy <= y.accuracy;
        expect(worseBoth).toBe(false);
      }
    }
  });
});

describe('実効値', () => {
  it('素手と裸の既定値', () => {
    expect(weaponAtk(null)).toBe(0);
    expect(weaponAccuracy(null)).toBe(BARE_ACCURACY);
    expect(armorDefense(null)).toBe(0);
    expect(armorEvasion(null)).toBe(0);
    expect(weaponHas(null, 'crit')).toBe(false);
    expect(armorHas(null, 'thorns')).toBe(false);
  });

  it('補正で負にならない', () => {
    // 影衣は defBonus -2。深さ 1 の power 1 でも 0 で止まる
    expect(armorDefense({ id: 'shadowVeil', power: 1 })).toBe(0);
    expect(weaponAtk({ id: 'twinFang', power: 1 })).toBe(0);
  });

  it('強さがそのまま乗る', () => {
    expect(weaponAtk({ id: 'sword', power: 5 })).toBe(5);
    expect(weaponAtk({ id: 'axe', power: 5 })).toBe(7);
    expect(armorDefense({ id: 'plate', power: 3 })).toBe(5);
  });

  it('特殊効果を引ける', () => {
    expect(weaponHas({ id: 'critEdge', power: 1 }, 'crit')).toBe(true);
    expect(weaponHas({ id: 'sword', power: 1 }, 'crit')).toBe(false);
    expect(armorHas({ id: 'thornMail', power: 1 }, 'thorns')).toBe(true);
  });

  it('名前と説明が出る', () => {
    expect(equipName({ id: 'sword', power: 3 })).toBe('剣 +3');
    expect(equipSummary({ id: 'sword', power: 3 }, 'weapon')).toContain('攻撃 +3');
    expect(equipSummary(null, 'weapon')).toContain('素手');
    expect(equipSummary(null, 'armor')).toContain('裸');
  });
});

describe('出現の選び方', () => {
  it('床にはドロップ限定のものが出ない', () => {
    const rng = new Rng(hashSeed('FLOOR'));
    for (let i = 0; i < 500; i++) {
      expect(equipDef(pickFloorEquip(rng, 'weapon')).dropOnly).toBe(false);
      expect(equipDef(pickFloorEquip(rng, 'armor')).dropOnly).toBe(false);
    }
  });

  it('床には基礎と系統特効の両方が出る', () => {
    const rng = new Rng(hashSeed('MIX'));
    const seen = new Set<EquipId>();
    for (let i = 0; i < 500; i++) seen.add(pickFloorEquip(rng, 'weapon'));
    expect(seen.size).toBe(WEAPON_IDS.filter((id) => !WEAPONS[id].dropOnly).length);
  });

  it('ドロップはその系統に効くものか、ドロップ限定の変わり種になる', () => {
    const rng = new Rng(hashSeed('DROP'));
    const families: MonsterFamily[] = ['swarm', 'swift', 'warrior', 'odd', 'heavy'];
    for (const f of families) {
      for (let i = 0; i < 200; i++) {
        const id = pickDropEquip(rng, f);
        expect(id).not.toBeNull();
        const def = equipDef(id as EquipId);
        expect(def.bane === f || def.dropOnly).toBe(true);
      }
    }
  });

  it('系統を持たないボスでも何かは落とす', () => {
    const rng = new Rng(hashSeed('BOSS'));
    for (let i = 0; i < 50; i++) {
      expect(pickDropEquip(rng, 'boss')).not.toBeNull();
    }
  });
});
