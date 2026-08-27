// 自動プレイの結果を、読める表に畳む。
// 数値を変えたときに前後を見比べるためのものなので、桁は揃えるが飾らない。

import type { DepthStats, RunResult } from './autoplay';

export interface Summary {
  runs: number;
  died: number;
  /** 上限で打ち切った回数。多いなら自動プレイか上限のほうを疑う */
  stuck: number;
  depth: Quantiles;
  turns: Quantiles;
  level: Quantiles;
  score: Quantiles;
  /** 到達階のヒストグラム。深い順ではなく浅い順 */
  depthHistogram: { depth: number; count: number }[];
  byDepth: DepthSummary[];
}

export interface Quantiles {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
}

export interface DepthSummary {
  depth: number;
  /** その階に到達した run の数 */
  runs: number;
  /** 1 回の被弾で通った平均ダメージ */
  avgDealt: number;
  /** 軽減前の平均出目 */
  avgRoll: number;
  /** 出目のうち軽減された割合 */
  reduction: number;
  /** 1 ダメージに潰れた被弾の割合 */
  oneRate: number;
  /** レベルアップ 1 回あたりに倒した敵の数。その階でレベルが上がらなければ null */
  killsPerLevel: number | null;
  /** その階での平均滞在ターン数 */
  avgTurns: number;
}

export function summarize(results: RunResult[]): Summary {
  const depths = results.map((r) => r.depth);
  const rows = new Map<number, DepthStats[]>();
  for (const r of results) {
    for (const d of r.byDepth) {
      const list = rows.get(d.depth) ?? [];
      list.push(d);
      rows.set(d.depth, list);
    }
  }

  const histogram = [...new Set(depths)]
    .sort((a, b) => a - b)
    .map((depth) => ({ depth, count: depths.filter((d) => d === depth).length }));

  const byDepth = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, list]) => {
      const hits = sum(list.map((d) => d.hits));
      const dealt = sum(list.map((d) => d.totalDealt));
      const roll = sum(list.map((d) => d.totalRoll));
      const ones = sum(list.map((d) => d.ones));
      const kills = sum(list.map((d) => d.kills));
      const levelUps = sum(list.map((d) => d.levelUps));
      return {
        depth,
        runs: list.length,
        avgDealt: hits > 0 ? dealt / hits : 0,
        avgRoll: hits > 0 ? roll / hits : 0,
        reduction: roll > 0 ? 1 - dealt / roll : 0,
        oneRate: hits > 0 ? ones / hits : 0,
        killsPerLevel: levelUps > 0 ? kills / levelUps : null,
        avgTurns: sum(list.map((d) => d.turns)) / list.length,
      };
    });

  return {
    runs: results.length,
    died: results.filter((r) => r.died).length,
    stuck: results.filter((r) => !r.died).length,
    depth: quantiles(depths),
    turns: quantiles(results.map((r) => r.turns)),
    level: quantiles(results.map((r) => r.level)),
    score: quantiles(results.map((r) => r.score)),
    depthHistogram: histogram,
    byDepth,
  };
}

export function quantiles(values: number[]): Quantiles {
  if (values.length === 0) return { min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0],
    p25: at(s, 0.25),
    median: at(s, 0.5),
    p75: at(s, 0.75),
    max: s[s.length - 1],
    mean: sum(s) / s.length,
  };
}

/** 補間しない素朴な分位点。順位で切るので、階のような整数値でも意味が壊れない */
function at(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// 整形

export function formatReport(s: Summary, label = ''): string {
  const out: string[] = [];
  const head = label ? `バランス計測: ${label}` : 'バランス計測';
  out.push(head);
  out.push(`run ${s.runs} 回 / 死亡 ${s.died} 回 / 打ち切り ${s.stuck} 回`);
  out.push('');

  out.push('全体');
  out.push(table(
    ['項目', '最小', '25%', '中央', '75%', '最大', '平均'],
    [
      ['到達階', ...q(s.depth)],
      ['ターン', ...q(s.turns)],
      ['レベル', ...q(s.level)],
      ['スコア', ...q(s.score)],
    ],
  ));
  out.push('');

  out.push('到達階の分布');
  const width = Math.max(...s.depthHistogram.map((h) => h.count), 1);
  for (const h of s.depthHistogram) {
    const bar = '#'.repeat(Math.max(1, Math.round((h.count / width) * 32)));
    out.push(`  B${String(h.depth).padStart(2)} ${String(h.count).padStart(3)} ${bar}`);
  }
  out.push('');

  out.push('階ごとの内訳');
  out.push(table(
    ['階', 'run', '被弾平均', '出目平均', '軽減率', '1ダメ率', 'Lvあたり撃破', '滞在ターン'],
    s.byDepth.map((d) => [
      `B${d.depth}`,
      String(d.runs),
      d.avgDealt.toFixed(2),
      d.avgRoll.toFixed(2),
      pct(d.reduction),
      pct(d.oneRate),
      d.killsPerLevel === null ? '-' : d.killsPerLevel.toFixed(1),
      d.avgTurns.toFixed(0),
    ]),
  ));

  return out.join('\n');
}

function q(v: { min: number; p25: number; median: number; p75: number; max: number; mean: number }): string[] {
  return [
    fmt(v.min),
    fmt(v.p25),
    fmt(v.median),
    fmt(v.p75),
    fmt(v.max),
    v.mean.toFixed(1),
  ];
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

/** 列幅を揃えた素の表。等幅で読む前提 */
function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => visualWidth(r[i] ?? ''))));
  const line = (r: string[]): string =>
    '  ' + r.map((c, i) => pad(c ?? '', widths[i])).join('  ').trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/** 全角を 2 桁として数える (等幅フォントで桁が揃うようにする) */
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[　-鿿！-｠]/.test(ch) ? 2 : 1;
  return w;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visualWidth(s)));
}
