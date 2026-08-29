import { describe, expect, it } from 'vitest';
import { HUD_ROWS, LOG_ROWS, gridFor, visibleLogLines } from './text-renderer';
import type { LogEntry } from '../view';

const line = (text: string, turn: number): LogEntry => ({ text, kind: 'info', turn });

describe('visibleLogLines', () => {
  it('行数の上限を超えたぶんは出さない', () => {
    const log = Array.from({ length: 10 }, (_, i) => line(`${i}`, i));
    const lines = visibleLogLines(log, 9, 3, 20);
    expect(lines.map((l) => l.text)).toEqual(['7', '8', '9']);
  });

  it('経過ターンが上限を超えた行は出さない', () => {
    // 開幕の 3 行のあと、20 ターン以上なにも起きなかった場合を再現する。
    // 移動や待機では pushLog が呼ばれないので、この状況は普通に起こる
    const log = [line('前のセーブは形式が古いので読めなかった。', 0), line('seed に入った。', 0), line('B1。', 0)];
    expect(visibleLogLines(log, 25, 6, 20)).toHaveLength(0);
    expect(visibleLogLines(log, 20, 6, 20)).toHaveLength(3);
  });

  it('放置された古い行だけが消え、直後の新しい行は残る', () => {
    const log = [line('古い行', 0), line('新しい行', 30)];
    const lines = visibleLogLines(log, 31, 6, 20);
    expect(lines.map((l) => l.text)).toEqual(['新しい行']);
  });

  it('戦闘が続いているあいだは経過ターンでは切られない', () => {
    // 毎ターン何かが起きていれば、直前の行との差は常に上限内に収まる
    const log = Array.from({ length: 8 }, (_, i) => line(`turn${i}`, i));
    const lines = visibleLogLines(log, 7, 6, 20);
    expect(lines).toHaveLength(6);
  });
});

describe('gridFor', () => {
  /**
   * マップとログが重ならないこと。
   *
   * canvas を測ったときの高さと、描くときの高さが違うとここが破れる。
   * 実際、起動時にスロットが組み上がって canvas が縮んだあと測り直していなかったため、
   * マップの下端がログに 65px 食い込み、画面全体も縦に潰れていた。
   */
  it('どの画面サイズでもマップの下端がログの上端を超えない', () => {
    for (let w = 280; w <= 1200; w += 17) {
      for (let h = 320; h <= 1400; h += 23) {
        const g = gridFor(w, h);
        const mapBottom = (HUD_ROWS + g.rows) * g.cell;
        const logTop = h - LOG_ROWS * g.cell;
        expect(mapBottom).toBeLessThanOrEqual(logTop);
      }
    }
  });

  it('セルは下限と上限の内側に収まる', () => {
    for (const [w, h] of [[280, 320], [390, 457], [1200, 1400], [100, 100]] as const) {
      const g = gridFor(w, h);
      expect(g.cell).toBeGreaterThanOrEqual(12);
      expect(g.cell).toBeLessThanOrEqual(32);
      expect(g.rows).toBeGreaterThanOrEqual(1);
      expect(g.cols).toBeGreaterThanOrEqual(1);
    }
  });
});
