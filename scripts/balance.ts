// バランス計測を回して表を出す。
//
//   npm run balance            # 既定の 100 run
//   npm run balance -- 300     # run 数を指定する
//
// seed は SIM000 から順に振るので、同じ run 数なら何度回しても同じ結果になる。
// 数値を変える前と後で同じコマンドを打ち、表を見比べるのが使い方である。

import { runMany, seedList } from '../src/sim/autoplay';
import { formatReport, summarize } from '../src/sim/report';

const count = Number(process.argv[2] ?? 100);
if (!Number.isFinite(count) || count < 1) {
  console.error('run 数は 1 以上の数値で指定する');
  process.exit(1);
}

const started = Date.now();
const results = runMany(seedList(count));
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(formatReport(summarize(results), `${count} run / ${elapsed} 秒`));
