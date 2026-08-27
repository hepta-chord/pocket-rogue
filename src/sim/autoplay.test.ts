import { describe, expect, it } from 'vitest';
import { runMany, runOne, seedList } from './autoplay';
import { quantiles, summarize } from './report';

describe('runOne', () => {
  it('同じ seed なら同じ結果になる', () => {
    expect(runOne('AUTO1')).toEqual(runOne('AUTO1'));
  });

  it('B1 より深く潜り、敵を倒す', () => {
    const r = runOne('AUTO2');
    expect(r.depth).toBeGreaterThan(1);
    expect(r.kills).toBeGreaterThan(0);
    expect(r.turns).toBeGreaterThan(0);
  });

  it('上限を超えて回り続けない', () => {
    const r = runOne('AUTO3', undefined, { maxTurns: 200, maxTurnsPerFloor: 60 });
    expect(r.turns).toBeLessThanOrEqual(220);
  });

  it('階ごとの内訳が到達階の範囲に収まる', () => {
    const r = runOne('AUTO4');
    for (const d of r.byDepth) {
      expect(d.depth).toBeGreaterThanOrEqual(1);
      expect(d.depth).toBeLessThanOrEqual(r.depth);
      expect(d.totalDealt).toBeLessThanOrEqual(d.totalRoll);
      expect(d.ones).toBeLessThanOrEqual(d.hits);
    }
  });

  it('計測フックを後片付けする (次の run に漏れない)', () => {
    const a = runOne('AUTO5');
    runOne('AUTO6');
    expect(runOne('AUTO5')).toEqual(a);
  });
});

describe('summarize', () => {
  it('run 数と死亡数の合計が一致する', () => {
    const results = runMany(seedList(8, 'SUM'));
    const s = summarize(results);
    expect(s.runs).toBe(8);
    expect(s.died + s.stuck).toBe(8);
  });

  it('到達階のヒストグラムの合計が run 数になる', () => {
    const s = summarize(runMany(seedList(8, 'HIST')));
    expect(s.depthHistogram.reduce((a, h) => a + h.count, 0)).toBe(8);
  });
});

describe('quantiles', () => {
  it('順に並んでいる', () => {
    const q = quantiles([5, 1, 9, 3, 7]);
    expect(q.min).toBe(1);
    expect(q.max).toBe(9);
    expect(q.median).toBe(5);
    expect(q.mean).toBe(5);
  });

  it('空でも落ちない', () => {
    expect(quantiles([])).toEqual({ min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0 });
  });
});
