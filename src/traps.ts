// 罠の定義と配置。
//
// イベント床 (`~`) と違い、罠は**見えない**。踏むまで分からず、踏むと発動して消える。
// どれも即死しない。取り返しがつかないのは腐食だけで、それ以外は立て直せる。
//
// 見えないものを踏ませる以上、対抗手段が要る。地図を使うと位置が分かる。
//
// 効果の中身はここが持ち、実際にどう適用するかは game.ts が受け持つ。

import { randomFloorTile, tileAt, Tile, type GameMap } from './map';
import type { Rng } from './rng';

export type TrapKind =
  /** 装備が弱る。取り返しがつかない */
  | 'corrode'
  /** 周囲に敵を呼ぶ */
  | 'summon'
  /** 数ターン動けなくなる */
  | 'root'
  /** HP が半分になる。1 は残るので即死しない */
  | 'halveHp'
  /** スタミナが半分になる */
  | 'halveStamina'
  /** 次の階へ落ちる。階段を探さずに降りられるので、得になることもある */
  | 'pit';

export interface Trap {
  kind: TrapKind;
  x: number;
  y: number;
  /** 見つかっているか。地図を使うか、踏んで発動すると分かる */
  found: boolean;
}

export const TRAP_NAMES: Record<TrapKind, string> = {
  corrode: '腐食の罠',
  summon: '呼び寄せの罠',
  root: '足止めの罠',
  halveHp: '衰弱の罠',
  halveStamina: '疲労の罠',
  pit: '落とし穴',
};

/**
 * 出やすさ。
 *
 * 腐食だけ低くしてある。取り返しがつかない効果なので、
 * 踏んだ回数がそのまま run の質を下げてしまう。
 */
const WEIGHTS: Record<TrapKind, number> = {
  corrode: 2,
  summon: 5,
  root: 5,
  halveHp: 4,
  halveStamina: 4,
  pit: 4,
};

const KINDS = Object.keys(WEIGHTS) as TrapKind[];

/** 足止めが続くターン数 */
export const ROOT_TURNS = 4;

/** 呼び寄せで湧く数 */
export const SUMMON_COUNT: [number, number] = [2, 3];

/** 階に置く罠の数。深いほど増える */
export function trapCount(rng: Rng, depth: number): number {
  return 1 + Math.floor(depth / 6) + rng.int(0, 2);
}

function pick(rng: Rng): TrapKind {
  const total = KINDS.reduce((sum, k) => sum + WEIGHTS[k], 0);
  let r = rng.next() * total;
  for (const k of KINDS) {
    r -= WEIGHTS[k];
    if (r <= 0) return k;
  }
  return KINDS[KINDS.length - 1];
}

/**
 * 罠を配置する。
 *
 * 階段の上と開始地点には置かない。降りた瞬間や降りる瞬間に踏むと、
 * 避ける判断がそもそも成立しないためである。
 * イベント床やアイテムとも重ねない。見えているものの下に隠れると理不尽になる。
 */
export function spawnTraps(
  rng: Rng,
  map: GameMap,
  depth: number,
  avoid: { x: number; y: number },
  taken: { x: number; y: number }[],
): Trap[] {
  const traps: Trap[] = [];
  const want = trapCount(rng, depth);

  for (let tries = 0; tries < 200 && traps.length < want; tries++) {
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (tileAt(map, at.x, at.y) !== Tile.Floor) continue;
    if (at.x === avoid.x && at.y === avoid.y) continue;
    if (taken.some((t) => t.x === at.x && t.y === at.y)) continue;
    if (traps.some((t) => t.x === at.x && t.y === at.y)) continue;
    traps.push({ kind: pick(rng), x: at.x, y: at.y, found: false });
  }
  return traps;
}
