import { describe, expect, it } from 'vitest';
import {
  MONSTER_ROLL_FLOOR,
  PLAYER_ROLL_FLOOR,
  applyDefense,
  rollDamage,
  strike,
} from './combat';
import { MONSTERS } from './entity';
import { equipPower } from './items';
import { Rng, hashSeed } from './rng';

describe('rollDamage', () => {
  it('下限が最大値に比例する', () => {
    const rng = new Rng(hashSeed('ROLL'));
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) seen.add(rollDamage(rng, 10, 0.6));
    expect([...seen].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10]);
  });

  it('攻撃力が 1 以下でも 1 を返す', () => {
    const rng = new Rng(hashSeed('LOW'));
    for (let i = 0; i < 100; i++) {
      expect(rollDamage(rng, 1, 0.6)).toBe(1);
      expect(rollDamage(rng, 0, 0.6)).toBe(1);
    }
  });

  it('比率 1 なら常に最大値', () => {
    const rng = new Rng(hashSeed('FULL'));
    for (let i = 0; i < 100; i++) expect(rollDamage(rng, 7, 1)).toBe(7);
  });
});

describe('applyDefense', () => {
  it('防御 0 なら出目がそのまま通る', () => {
    for (let roll = 1; roll <= 20; roll++) expect(applyDefense(roll, 0)).toBe(roll);
  });

  it('防御が高くても出目の 1/4 は必ず通る', () => {
    for (let roll = 1; roll <= 40; roll++) {
      expect(applyDefense(roll, 999)).toBe(Math.ceil(roll / 4));
    }
  });

  it('軽減率が 100% に張り付かない', () => {
    // 防御が攻撃力に追いついても、軽減率は 75% で頭打ちになる
    const roll = 8;
    expect(1 - applyDefense(roll, 8) / roll).toBeLessThanOrEqual(0.75);
  });

  it('防御を上げるほど通るダメージは減る (ただし単調で逆転しない)', () => {
    for (let d = 0; d < 12; d++) {
      expect(applyDefense(10, d)).toBeGreaterThanOrEqual(applyDefense(10, d + 1));
    }
  });
});

describe('strike', () => {
  it('pierce は防御を無視する', () => {
    const rng = new Rng(hashSeed('PIERCE'));
    for (let i = 0; i < 200; i++) {
      const hit = strike(rng, 8, 99, MONSTER_ROLL_FLOOR, true);
      expect(hit.dealt).toBe(hit.roll);
    }
  });

  it('通ったダメージが出目を超えない', () => {
    const rng = new Rng(hashSeed('CAP'));
    for (let i = 0; i < 500; i++) {
      const hit = strike(rng, 1 + (i % 12), i % 6, PLAYER_ROLL_FLOOR);
      expect(hit.dealt).toBeGreaterThanOrEqual(1);
      expect(hit.dealt).toBeLessThanOrEqual(hit.roll);
    }
  });
});

describe('ボスの被弾', () => {
  // 軽減に上限があることの裏取り。
  // ドラゴンが出る最初の階 B10 では、防具は equipPower('armor', 10) = 3 になる。
  it('防具で 1 に潰れず、出目の差がそのままダメージの差になる', () => {
    const rng = new Rng(hashSeed('DRAGON'));
    const armor = equipPower('armor', 10, rng);
    expect(armor).toBe(3);

    const atk = MONSTERS.dragon.atk;
    const low = Math.ceil(atk * MONSTER_ROLL_FLOOR);
    const outcomes: number[] = [];
    for (let roll = low; roll <= atk; roll++) outcomes.push(applyDefense(roll, armor));

    expect(outcomes).toEqual([3, 4, 5, 6, 7, 8, 9]);
    const mean = outcomes.reduce((a, b) => a + b, 0) / outcomes.length;
    expect(mean).toBeCloseTo(6.0, 5);
    // 1 に潰れない
    expect(Math.min(...outcomes)).toBeGreaterThan(1);
  });

  it('防具を厚くしても軽減率は 75% で頭打ちになる', () => {
    const atk = MONSTERS.dragon.atk;
    const worst = applyDefense(atk, 99);
    expect(worst).toBe(Math.ceil(atk / 4));
    expect(1 - worst / atk).toBeLessThanOrEqual(0.75);
  });
});

describe('equipPower', () => {
  it('防具は武器より伸びが鈍い', () => {
    const rng = new Rng(hashSeed('EQUIP'));
    for (const depth of [1, 5, 9, 12, 20, 30]) {
      const weapon = equipPower('weapon', depth, rng);
      const armor = equipPower('armor', depth, rng);
      expect(weapon).toBeGreaterThanOrEqual(armor);
    }
  });

  it('防具に乱数の振れが無い', () => {
    const rng = new Rng(hashSeed('ARMOR'));
    for (let i = 0; i < 50; i++) expect(equipPower('armor', 12, rng)).toBe(4);
  });

  it('深さ 1 でも 1 以上になる', () => {
    const rng = new Rng(hashSeed('SHALLOW'));
    expect(equipPower('weapon', 1, rng)).toBeGreaterThanOrEqual(1);
    expect(equipPower('armor', 1, rng)).toBe(1);
  });
});
