import type { ActorKind } from '../entity';
import type { ItemKind } from '../items';
import type { CellKind, Health, LogKind } from '../view';

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
  stairsUp: { ch: '<', fg: '#8fe3ff' },
  unknown: { ch: ' ', fg: '#000000' },
  // イベント床。色で効果の大きさと危なさが読めるようにする
  floorGreen: { ch: '~', fg: '#7fd17f' },
  floorYellow: { ch: '~', fg: '#ffd166' },
  floorRed: { ch: '~', fg: '#ff6b6b' },
  floorBlue: { ch: '~', fg: '#7fc4ff' },
};

// 系統ごとに文字を固定し、グレードは色で示す。
// 文字で「何系の敵か」、色で「どのくらい強いか」が読める。
export const ACTOR_GLYPHS: Record<ActorKind, Glyph> = {
  player: { ch: '@', fg: '#f5f5f5' },

  rat: { ch: 'r', fg: '#c9a27a' },
  ratPoison: { ch: 'r', fg: '#b98cff' },
  ratRot: { ch: 'r', fg: '#7fa06a' },

  bat: { ch: 'b', fg: '#9a9ab8' },
  batGale: { ch: 'b', fg: '#7fe0ff' },
  batStorm: { ch: 'b', fg: '#ffe066' },

  goblin: { ch: 'g', fg: '#7fd17f' },
  goblinArmored: { ch: 'g', fg: '#8fb8e6' },
  goblinKing: { ch: 'g', fg: '#f0a83c' },

  slime: { ch: 's', fg: '#8fe3a0' },
  slimeSplit: { ch: 's', fg: '#c8c8ff' },
  slimeMimic: { ch: 's', fg: '#ff9bd8' },

  troll: { ch: 'T', fg: '#5aa9e6' },
  trollRock: { ch: 'T', fg: '#b0a08a' },
  trollIron: { ch: 'T', fg: '#d0d0d8' },

  dragon: { ch: 'D', fg: '#ff5c5c' },

  // 長居への対策。他のどれとも似ない文字にして、見た瞬間に逃げると分かるようにする
  stalker: { ch: 'X', fg: '#ff2d55' },
};

export const ITEM_GLYPHS: Record<ItemKind, Glyph> = {
  potion: { ch: '!', fg: '#ff8ad8' },
  elixir: { ch: '!', fg: '#7fe0ff' },
  weapon: { ch: ')', fg: '#d0d0d0' },
  armor: { ch: '[', fg: '#a0c4ff' },
  treasure: { ch: '$', fg: '#ffd700' },
};

/**
 * HP の帯を色に落とす。
 * 傷ついた相手ほど赤に寄せることで、あと何発かをグリフだけで読めるようにする。
 * 混ぜる比率であって塗り潰しではないので、敵の種類ごとの色は残る。
 */
const HEALTH_MIX: Record<Health, { color: string; amount: number }> = {
  healthy: { color: '#ffffff', amount: 0 },
  hurt: { color: '#ffb454', amount: 0.45 },
  critical: { color: '#ff4d4d', amount: 0.75 },
};

/**
 * 種類と HP の帯から、実際に描く文字と色を決める。
 * 擬態している敵は、正体が割れるまで落ちている武器として描く。
 */
export function actorGlyph(kind: ActorKind, health: Health, disguised = false): Glyph {
  if (disguised) return ITEM_GLYPHS.weapon;
  const base = ACTOR_GLYPHS[kind];
  // プレイヤーの色は変えない。自分の HP は HUD で見えているし、@ が赤くなると盤面が読みにくい
  if (kind === 'player') return base;
  const { color, amount } = HEALTH_MIX[health];
  return amount === 0 ? base : { ch: base.ch, fg: mix(base.fg, color, amount) };
}

/** #rrggbb を t の比率で混ぜる */
function mix(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export const COLORS = {
  bg: '#101014',
  hud: '#d0d0d8',
  hudDim: '#8a8a96',
  hpLow: '#ff6b6b',
  warn: '#ffd166',
  overlay: 'rgba(16, 16, 20, 0.85)',
};

/** ログの分類ごとの色。自分の行動は青系、敵の行動は赤系 */
export const LOG_COLORS: Record<LogKind, string> = {
  player: '#8fc6ff',
  enemy: '#ff9b9b',
  info: '#b8b8c0',
  alert: '#ffd166',
};

/** 最新ターン以外のログの明るさ */
export const LOG_OLD_ALPHA = 0.55;

/** 見えていないが記憶している場所の明るさ */
export const REMEMBERED_ALPHA = 0.4;

export const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
