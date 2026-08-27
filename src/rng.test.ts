import { describe, expect, it } from 'vitest';
import { Rng, hashSeed, normalizeSeed } from './rng';

describe('Rng', () => {
  it('同じ seed なら同じ並びを返す', () => {
    const a = new Rng(hashSeed('ABC123'));
    const b = new Rng(hashSeed('ABC123'));
    const left = Array.from({ length: 50 }, () => a.int(1, 100));
    const right = Array.from({ length: 50 }, () => b.int(1, 100));
    expect(left).toEqual(right);
  });

  it('state を入れ替えると続きから再現できる', () => {
    const a = new Rng(hashSeed('SEED'));
    a.int(1, 6);
    a.int(1, 6);
    const saved = a.state;
    const rest = Array.from({ length: 20 }, () => a.int(1, 6));

    const b = new Rng(0);
    b.state = saved;
    expect(Array.from({ length: 20 }, () => b.int(1, 6))).toEqual(rest);
  });

  it('int は min と max を含む範囲に収まる', () => {
    const rng = new Rng(hashSeed('RANGE'));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    // 端も出ることを確かめる (片側に寄っていないか)
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('chance(0) は常に false、chance(1) は常に true', () => {
    const rng = new Rng(hashSeed('CHANCE'));
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('normalizeSeed は前後の空白を落として大文字に揃える', () => {
    expect(normalizeSeed('  ab3x ')).toBe('AB3X');
  });
});
