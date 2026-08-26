import type { ActorKind } from '../entity';
import type { CellKind } from '../view';

// 文字描画の見た目はこのファイルだけで決まる。
// 種類 → 文字と色の対応表。ゲーム本体はここを知らない。

export interface Glyph {
  ch: string;
  fg: string;
}

export const CELL_GLYPHS: Record<CellKind, Glyph> = {
  wall: { ch: '#', fg: '#8a8a96' },
  floor: { ch: '.', fg: '#5a5a66' },
  stairs: { ch: '>', fg: '#ffd166' },
  unknown: { ch: ' ', fg: '#000000' },
};

export const ACTOR_GLYPHS: Record<ActorKind, Glyph> = {
  player: { ch: '@', fg: '#f5f5f5' },
  rat: { ch: 'r', fg: '#c9a27a' },
  bat: { ch: 'b', fg: '#b98cff' },
  goblin: { ch: 'g', fg: '#7fd17f' },
  orc: { ch: 'o', fg: '#f08c4a' },
  troll: { ch: 'T', fg: '#5aa9e6' },
  dragon: { ch: 'D', fg: '#ff5c5c' },
};

export const COLORS = {
  bg: '#101014',
  hud: '#d0d0d8',
  hudDim: '#8a8a96',
  hpLow: '#ff6b6b',
  log: '#c0c0c8',
  logOld: '#70707a',
  overlay: 'rgba(16, 16, 20, 0.85)',
};

/** 見えていないが記憶している場所の明るさ */
export const REMEMBERED_ALPHA = 0.4;

export const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
