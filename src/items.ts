import type { Actor } from './entity';
import { Tile, idx, type GameMap } from './map';
import type { Rng } from './rng';

// アイテムの定義と配置。
// 操作性のため、使うアイテムは「対象指定が要らない消耗品」だけにし、装備は拾った時点で自動で持ち替える。

export type ConsumableKind = 'potion' | 'thunder' | 'map';
export type EquipKind = 'weapon' | 'armor';
export type ItemKind = ConsumableKind | EquipKind;

export const CONSUMABLES: readonly ConsumableKind[] = ['potion', 'thunder', 'map'];

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  /** 装備の強さ (+n)。消耗品は 0 */
  power: number;
}

export type Inventory = Record<ConsumableKind, number>;

export const ITEM_NAMES: Record<ItemKind, string> = {
  potion: '回復薬',
  thunder: '雷の巻物',
  map: '地図の巻物',
  weapon: '武器',
  armor: '防具',
};

/** 同じ消耗品を持てる上限 */
export const STACK_MAX = 5;

const WEIGHTS: Record<ItemKind, number> = { potion: 5, thunder: 2, map: 2, weapon: 2, armor: 2 };
const KINDS = Object.keys(WEIGHTS) as ItemKind[];

export function emptyInventory(): Inventory {
  return { potion: 0, thunder: 0, map: 0 };
}

export function isEquip(kind: ItemKind): kind is EquipKind {
  return kind === 'weapon' || kind === 'armor';
}

/** 階層ごとに 2〜4 個。装備の強さは階が深いほど上がる */
export function spawnItems(rng: Rng, map: GameMap, depth: number, avoid: { x: number; y: number }, actors: Actor[]): Item[] {
  const count = rng.int(2, 4);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const kind = weightedPick(rng);
    const pos = findSpot(rng, map, avoid, actors, items);
    if (!pos) break;
    const power = isEquip(kind) ? 1 + Math.floor(depth / 3) + rng.int(0, 1) : 0;
    items.push({ kind, x: pos.x, y: pos.y, power });
  }
  return items;
}

function weightedPick(rng: Rng): ItemKind {
  const total = KINDS.reduce((sum, k) => sum + WEIGHTS[k], 0);
  let r = rng.next() * total;
  for (const k of KINDS) {
    r -= WEIGHTS[k];
    if (r < 0) return k;
  }
  return KINDS[KINDS.length - 1];
}

function findSpot(
  rng: Rng,
  map: GameMap,
  avoid: { x: number; y: number },
  actors: Actor[],
  items: Item[],
): { x: number; y: number } | null {
  for (let tries = 0; tries < 50; tries++) {
    const room = rng.pick(map.rooms);
    const x = rng.int(room.x, room.x + room.w - 1);
    const y = rng.int(room.y, room.y + room.h - 1);
    if (map.tiles[idx(map, x, y)] !== Tile.Floor) continue;
    if (x === avoid.x && y === avoid.y) continue;
    if (actors.some((a) => a.x === x && a.y === y)) continue;
    if (items.some((it) => it.x === x && it.y === y)) continue;
    return { x, y };
  }
  return null;
}
