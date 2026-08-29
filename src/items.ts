import type { Actor, MonsterFamily } from './entity';
import {
  ARMORS,
  ARMOR_IDS,
  WEAPONS,
  WEAPON_IDS,
  equipDef,
  type EquipId,
  type EquipSlot,
} from './equip';
import { randomFloorTile, type GameMap } from './map';
import type { Rng } from './rng';

// アイテムの定義と配置。
// 操作性のため、使うアイテムは「対象指定が要らない消耗品」だけにしてある。
// 装備は拾ったときに持ち替えるかどうかを選ぶ (game.ts の確認プロンプト)。

// 消耗品は 2 種だけにする。
// 雷は魔法 (スタミナ消費) に、地図は床のイベント効果に移した。
export type ConsumableKind = 'potion' | 'elixir' | 'map';
export type EquipKind = EquipSlot;
/** 拾うとスコアになるだけの品。ボスが落とす */
export type TreasureKind = 'treasure';
export type ItemKind = ConsumableKind | EquipKind | TreasureKind;

export const CONSUMABLES: readonly ConsumableKind[] = ['potion', 'elixir', 'map'];

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  /** 装備の強さ (+n)。消耗品は 0 */
  power: number;
  /** 装備のときだけ。どの種類か */
  equip?: EquipId;
  /**
   * 一度断った装備。踏んでも確認を出さない。
   *
   * 断ったものが足元に残るので、印が無いと通るたびに確認が出て通行の邪魔になる。
   * 同じ部位の装備が変わったときに印を外し、事情が変わったらまた選べるようにする。
   */
  declined?: boolean;
}

export type Inventory = Record<ConsumableKind, number>;

export const ITEM_NAMES: Record<ItemKind, string> = {
  potion: 'HP 回復薬',
  elixir: 'スタミナ薬',
  map: '地図',
  weapon: '武器',
  armor: '防具',
  treasure: '財宝',
};

/**
 * 消耗品を持てる上限。種類ごとに分ける。
 *
 * スタミナ薬を無制限に持ち歩けるとスタミナ切れのペナルティが無効になり、
 * 居座って稼ぐのが最適解に戻る。
 */
export const STACK_LIMITS: Record<ConsumableKind, number> = { potion: 5, elixir: 3, map: 2 };

export function stackLimit(kind: ConsumableKind): number {
  return STACK_LIMITS[kind];
}

// 攻撃力がレベルで伸びなくなったぶん、武器の引きが勝敗に直結する。
// 武器の重みを上げて、1 個あたりの重みを下げる。
// 回復薬は 1 個で最大 HP の半分が戻る。
// 出る数を 4 に絞る案も測ったが、B20 到達率が 12% から 8% に落ちた。
// 深層は元から目標に届いていないので、量と数の両方を絞る形は採らない。
// 財宝は床には出ない。ボスを倒したときだけ落ちる
const WEIGHTS: Record<ItemKind, number> = { potion: 6, elixir: 4, map: 3, weapon: 4, armor: 3, treasure: 0 };
const KINDS = (Object.keys(WEIGHTS) as ItemKind[]).filter((k) => WEIGHTS[k] > 0);

/** 敵を倒したときに装備を落とす確率 */
/**
 * 撃破 1 回あたりに装備を落とす確率。
 *
 * 敵の予算を削ったぶん階あたりの撃破数が減るので、
 * 装備の入手機会が変わらないように少し上げてある。
 */
export const DROP_CHANCE = 0.2;

export function emptyInventory(): Inventory {
  return { potion: 0, elixir: 0, map: 0 };
}

export function isEquip(kind: ItemKind): kind is EquipKind {
  return kind === 'weapon' || kind === 'armor';
}

export function isTreasure(kind: ItemKind): kind is TreasureKind {
  return kind === 'treasure';
}

/** ボスが落とす財宝。深いボスほど価値が上がる */
export function makeTreasure(depth: number, x: number, y: number): Item {
  return { kind: 'treasure', x, y, power: 150 * Math.max(1, Math.floor(depth / 10)) };
}

/** 表示する名前。装備は種類と強さを出す */
export function itemLabel(item: Item): string {
  if (item.equip) return `${equipDef(item.equip).name} +${item.power}`;
  if (isTreasure(item.kind)) return `${ITEM_NAMES.treasure} (${item.power} 点)`;
  return ITEM_NAMES[item.kind];
}

/**
 * 装備の強さ。武器と防具で式を分ける。
 *
 * 武器の +1 はダメージの上限が 1 増えるだけだが、防具の +1 は被弾がすべて 1 減る。
 * 同じ式で伸ばすと防具だけが効きすぎるので、防具は伸びを鈍らせる。
 */
export function equipPower(kind: EquipKind, depth: number, rng: Rng): number {
  return kind === 'weapon'
    ? 1 + Math.floor(depth / 3) + rng.int(0, 1)
    : 1 + Math.floor(depth / 4);
}

/** 床に出る装備を 1 つ選ぶ。ドロップ限定のものは出ない */
export function pickFloorEquip(rng: Rng, kind: EquipKind): EquipId {
  const pool: EquipId[] =
    kind === 'weapon'
      ? WEAPON_IDS.filter((id) => !WEAPONS[id].dropOnly)
      : ARMOR_IDS.filter((id) => !ARMORS[id].dropOnly);
  return rng.pick(pool);
}

/**
 * 系統ごとのドロップ率の倍率。
 *
 * 手強い相手ほど良いものを落とす。狩る対象を選ぶ判断がここに乗る。
 * 数で出る系統を高くすると、雑魚狩りが装備集めとして最適になってしまう。
 */
export const FAMILY_DROP_RATE: Record<MonsterFamily, number> = {
  swarm: 0.5,
  swift: 0.7,
  warrior: 1,
  odd: 1.2,
  heavy: 1.8,
  // 遠隔は柔らかいぶん、近づけさえすれば安全に倒せる。近づく手間に見合う程度に留める
  ranged: 1.1,
  boss: 1,
};

/**
 * 倒した敵が落とす装備を選ぶ。
 *
 * ドロップ限定の品からしか出ない。床に出る品とは重ならないので、
 * 拾うことと狩ることが別の意味を持つ。
 */
export function pickDropEquip(rng: Rng, _family: MonsterFamily): EquipId | null {
  const pool: EquipId[] = [
    ...WEAPON_IDS.filter((id) => WEAPONS[id].dropOnly),
    ...ARMOR_IDS.filter((id) => ARMORS[id].dropOnly),
  ];
  return pool.length > 0 ? rng.pick(pool) : null;
}

/** 装備 1 点ぶんの床アイテムを作る */
export function makeEquipItem(rng: Rng, id: EquipId, depth: number, x: number, y: number): Item {
  const slot = equipDef(id).slot;
  return { kind: slot, x, y, power: equipPower(slot, depth, rng), equip: id };
}

/** 階層ごとに 2〜4 個。装備の強さは階が深いほど上がる */
export function spawnItems(rng: Rng, map: GameMap, depth: number, avoid: { x: number; y: number }, actors: Actor[]): Item[] {
  const count = rng.int(2, 4);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const kind = weightedPick(rng);
    const pos = findSpot(rng, map, avoid, actors, items);
    if (!pos) break;
    if (isEquip(kind)) {
      items.push(makeEquipItem(rng, pickFloorEquip(rng, kind), depth, pos.x, pos.y));
    } else {
      items.push({ kind, x: pos.x, y: pos.y, power: 0 });
    }
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
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (at.x === avoid.x && at.y === avoid.y) continue;
    if (actors.some((a) => a.x === at.x && a.y === at.y)) continue;
    if (items.some((it) => it.x === at.x && it.y === at.y)) continue;
    return at;
  }
  return null;
}
