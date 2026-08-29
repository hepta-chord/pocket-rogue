import { describe, expect, it } from 'vitest';
import { visibleLogLines } from './text-renderer';
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
