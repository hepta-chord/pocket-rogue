import type { ActorKind } from '../entity';
import type { ItemKind } from '../items';
import type { CellKind, LogKind } from '../view';

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

export const ITEM_GLYPHS: Record<ItemKind, Glyph> = {
  potion: { ch: '!', fg: '#ff8ad8' },
  thunder: { ch: '?', fg: '#ffe066' },
  map: { ch: '?', fg: '#7fe0ff' },
  weapon: { ch: ')', fg: '#d0d0d0' },
  armor: { ch: '[', fg: '#a0c4ff' },
};

export const COLORS = {
  bg: '#101014',
  hud: '#d0d0d8',
  hudDim: '#8a8a96',
  hpLow: '#ff6b6b',
  overlay: 'rgba(16, 16, 20, 0.85)',
};

/** ログの分類ごとの色。自分の行動は青系、敵の行動は赤系 */
export const LOG_COLORS: Record<LogKind, string> = {
  player: '#8fc6ff',
  enemy: '#ff9b9b',
  info: '#b8b8c0',
  alert: '#ffd166',
};

/** 最新行以外のログの明るさ */
export const LOG_OLD_ALPHA = 0.55;

/** 見えていないが記憶している場所の明るさ */
export const REMEMBERED_ALPHA = 0.4;

export const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
