// イベント床の定義と配置。
//
// 緑・黄・赤の 3 段階で、効果の大きさとマイナスの出る率が上がる。
// 青は別枠で、HP を大きく回復する立て直しの拠点になる。各階に 1 つ保証する。
//
// 効果の中身はここが持ち、実際にどう適用するかは game.ts が受け持つ。
// 深さや装備を見る必要があるのは適用側だけなので、この表は数値と種類だけを持つ。

import { canDetour, randomFloorTile, type GameMap } from './map';
import type { Rng } from './rng';

export type FloorKind = 'green' | 'yellow' | 'red' | 'blue';

export interface FloorTile {
  kind: FloorKind;
  x: number;
  y: number;
}

/** 効果の大きさ。実際の数値は深さと最大 HP から適用側が決める */
export type Magnitude = 'small' | 'medium' | 'large';

export type FloorEffect =
  | { kind: 'healHp'; size: Magnitude }
  | { kind: 'damage'; size: Magnitude }
  | { kind: 'restoreStamina'; amount: number }
  | { kind: 'gainXp'; size: Magnitude }
  | { kind: 'boostAtk'; amount: number }
  | { kind: 'boostDef'; amount: number }
  | { kind: 'boostStaminaMax'; amount: number }
  | { kind: 'drainStaminaMax'; amount: number }
  /** 装備が弱る。取り返しがつかない */
  | { kind: 'corrode' }
  | { kind: 'haste'; turns: number }
  | { kind: 'slow'; turns: number }
  | { kind: 'reveal' };

interface FloorDef {
  name: string;
  good: FloorEffect[];
  bad: FloorEffect[];
  /** マイナスが出る確率 */
  badRate: number;
}

export const FLOORS: Record<FloorKind, FloorDef> = {
  green: {
    name: '緑の床',
    good: [
      { kind: 'healHp', size: 'small' },
      { kind: 'restoreStamina', amount: 20 },
      { kind: 'gainXp', size: 'small' },
    ],
    bad: [{ kind: 'damage', size: 'small' }],
    badRate: 0.15,
  },
  yellow: {
    name: '黄の床',
    good: [
      { kind: 'boostAtk', amount: 1 },
      { kind: 'boostDef', amount: 1 },
      { kind: 'boostStaminaMax', amount: 10 },
      { kind: 'haste', turns: 20 },
      { kind: 'gainXp', size: 'medium' },
    ],
    bad: [
      { kind: 'damage', size: 'medium' },
      { kind: 'slow', turns: 15 },
      { kind: 'drainStaminaMax', amount: 10 },
    ],
    badRate: 0.3,
  },
  red: {
    name: '赤の床',
    good: [
      { kind: 'boostAtk', amount: 2 },
      { kind: 'boostDef', amount: 2 },
      { kind: 'boostStaminaMax', amount: 20 },
      { kind: 'reveal' },
      { kind: 'gainXp', size: 'large' },
    ],
    bad: [
      { kind: 'damage', size: 'large' },
      { kind: 'corrode' },
      { kind: 'drainStaminaMax', amount: 15 },
    ],
    badRate: 0.5,
  },
  blue: {
    name: '青の床',
    good: [{ kind: 'healHp', size: 'large' }],
    bad: [],
    badRate: 0,
  },
};

/** 取り返しがつかない効果を含む色。置く場所に制約をかける */
const RISKY: FloorKind[] = ['yellow', 'red'];

export function isRisky(kind: FloorKind): boolean {
  return RISKY.includes(kind);
}

/** 踏んだときに起きることを 1 つ選ぶ */
export function rollEffect(rng: Rng, kind: FloorKind): FloorEffect {
  const def = FLOORS[kind];
  const pool = def.bad.length > 0 && rng.chance(def.badRate) ? def.bad : def.good;
  return rng.pick(pool);
}

/** 階ごとの配置。青は必ず 1 つ置き、色つきは階が深いほど出やすくする */
export function spawnFloors(
  rng: Rng,
  map: GameMap,
  depth: number,
  start: { x: number; y: number },
  stairs: { x: number; y: number },
  taken: { x: number; y: number }[],
): FloorTile[] {
  const floors: FloorTile[] = [];
  const occupied = [...taken];

  const place = (kind: FloorKind): void => {
    const pos = findSpot(rng, map, start, stairs, occupied, isRisky(kind));
    if (!pos) return;
    floors.push({ kind, x: pos.x, y: pos.y });
    occupied.push(pos);
  };

  // 立て直しの拠点は必ず 1 つ
  place('blue');

  // 緑は 1〜2 個、黄は B3 から、赤は B6 から出る
  for (let i = 0; i < rng.int(1, 2); i++) place('green');
  if (depth >= 3 && rng.chance(0.6)) place('yellow');
  if (depth >= 6 && rng.chance(0.4)) place('red');

  return floors;
}

/**
 * 置ける場所を探す。
 *
 * 取り返しがつかない効果を含む床は、迂回できる位置にしか置かない。
 * 階段への唯一の通路に出ると、踏むかどうかの選択が消えて事故になる。
 */
function findSpot(
  rng: Rng,
  map: GameMap,
  start: { x: number; y: number },
  stairs: { x: number; y: number },
  occupied: { x: number; y: number }[],
  needDetour: boolean,
): { x: number; y: number } | null {
  for (let tries = 0; tries < 60; tries++) {
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (at.x === start.x && at.y === start.y) continue;
    if (occupied.some((o) => o.x === at.x && o.y === at.y)) continue;
    if (needDetour && !canDetour(map, start, stairs, at)) continue;
    return at;
  }
  return null;
}
