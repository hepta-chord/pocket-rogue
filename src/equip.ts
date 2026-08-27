// 装備の定義。
//
// 軸は 2 つずつ持たせて、単純な上位互換が生まれないようにする。
//   武器: 攻撃力 と 命中率
//   防具: 減算値 と 回避率
// 命中率と回避率が直接ぶつかる軸なので、対称で読みやすい。
//
// 未識別のアイテムを試す要素は入れない。短時間で 1 回遊ぶ設計なので、
// 名前と効果は最初から見えている前提にする。そのぶん名前で効果が推測できるように揃える。
//
// 深さから決まる強さ (items.ts の equipPower) に、ここの補正が乗る。

import { FAMILY_NAMES, type MonsterFamily } from './entity';

export type EquipSlot = 'weapon' | 'armor';

/**
 * 武器の特殊効果。
 * - cleave: 隣接する敵すべてに当たる
 * - sureHit: 必ず当たる。相手の回避を無視する
 * - pierce: 防御力を無視する
 * - ward: 分裂を止める
 * - crit: 確率で防御力を無視する
 * - double: 2 回攻撃する
 */
export type WeaponTrait = 'cleave' | 'sureHit' | 'pierce' | 'ward' | 'crit' | 'double';

/**
 * 防具の特殊効果。
 * - guard: 被弾時のスタミナ消費を抑える (スタミナの実装後に効く)
 * - wardCorrosion: 腐食を防ぐ (腐食の実装後に効く)
 * - thorns: 近接攻撃を受けたとき、相手に反撃ダメージを返す
 */
export type ArmorTrait = 'guard' | 'wardCorrosion' | 'thorns';

export type WeaponId =
  | 'dagger'
  | 'sword'
  | 'axe'
  | 'swarmBlade'
  | 'swiftSpear'
  | 'armorPiercer'
  | 'wardStaff'
  | 'greatHammer'
  | 'critEdge'
  | 'twinFang';

export type ArmorId =
  | 'leather'
  | 'chain'
  | 'plate'
  | 'swarmGuard'
  | 'windCloak'
  | 'warBreaker'
  | 'wardCharm'
  | 'thornMail'
  | 'shadowVeil'
  | 'adamantMail';

export type EquipId = WeaponId | ArmorId;

interface EquipDefBase {
  name: string;
  /** 効く系統。ドロップでどの敵が落とすかもこれで決まる。null なら基礎装備 */
  bane: MonsterFamily | null;
  /** 床には出ず、敵のドロップでしか手に入らない */
  dropOnly: boolean;
  /**
   * 特殊効果の 1 行説明。数値で読み取れるものは書かない。
   * 名前から推測させないために、拾ったときとメニューでそのまま出す。
   */
  effect: string;
}

export interface WeaponDef extends EquipDefBase {
  slot: 'weapon';
  /** 深さから決まる強さへの補正 */
  atkBonus: number;
  /** 命中率 0〜1 */
  accuracy: number;
  traits: WeaponTrait[];
}

export interface ArmorDef extends EquipDefBase {
  slot: 'armor';
  /** 深さから決まる強さへの補正 */
  defBonus: number;
  /** 回避率 0〜1 */
  evasion: number;
  traits: ArmorTrait[];
}

export type EquipDef = WeaponDef | ArmorDef;

/** 素手のときの命中率。武器を持つと武器の値に置き換わる */
export const BARE_ACCURACY = 0.9;

/** 会心が出る確率 */
export const CRIT_CHANCE = 0.25;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // 基礎 3 種。命中重視、標準、攻撃重視で、どれかが上位互換にならないようにしてある
  dagger: { slot: 'weapon', name: '短剣', bane: null, dropOnly: false, effect: '', atkBonus: -1, accuracy: 0.95, traits: [] },
  sword: { slot: 'weapon', name: '剣', bane: null, dropOnly: false, effect: '', atkBonus: 0, accuracy: 0.85, traits: [] },
  axe: { slot: 'weapon', name: '斧', bane: null, dropOnly: false, effect: '', atkBonus: 2, accuracy: 0.7, traits: [] },

  // 系統特効 5 種。名前に対象が入るようにしてある
  swarmBlade: { slot: 'weapon', name: '群れ薙ぎ', bane: 'swarm', dropOnly: false, effect: '隣接する敵すべてに同時に当たる', atkBonus: -1, accuracy: 0.85, traits: ['cleave'] },
  swiftSpear: { slot: 'weapon', name: '韋駄天突き', bane: 'swift', dropOnly: false, effect: '必ず当たる。相手の回避を無視する', atkBonus: 0, accuracy: 1, traits: ['sureHit'] },
  armorPiercer: { slot: 'weapon', name: '鎧通し', bane: 'warrior', dropOnly: false, effect: '相手の防御力を無視する', atkBonus: -1, accuracy: 0.85, traits: ['pierce'] },
  wardStaff: { slot: 'weapon', name: '祓いの杖', bane: 'odd', dropOnly: false, effect: '分裂を止める', atkBonus: -1, accuracy: 0.9, traits: ['ward'] },
  // 重装への特効は「攻撃力が高く、再生量を上回る」ことそのものなので、特殊効果は持たせない
  greatHammer: { slot: 'weapon', name: '大槌', bane: 'heavy', dropOnly: false, effect: '一撃が重く、再生を上回る', atkBonus: 3, accuracy: 0.65, traits: [] },

  // ドロップ限定
  critEdge: { slot: 'weapon', name: '会心の刃', bane: null, dropOnly: true, effect: '25% で防御力を無視する', atkBonus: 0, accuracy: 0.85, traits: ['crit'] },
  twinFang: { slot: 'weapon', name: '双牙', bane: null, dropOnly: true, effect: '1 手で 2 回攻撃する', atkBonus: -2, accuracy: 0.8, traits: ['double'] },
};

export const ARMORS: Record<ArmorId, ArmorDef> = {
  // 基礎 3 種
  leather: { slot: 'armor', name: '革鎧', bane: null, dropOnly: false, effect: '', defBonus: -1, evasion: 0.12, traits: [] },
  chain: { slot: 'armor', name: '鎖帷子', bane: null, dropOnly: false, effect: '', defBonus: 0, evasion: 0.05, traits: [] },
  plate: { slot: 'armor', name: '板金鎧', bane: null, dropOnly: false, effect: '', defBonus: 2, evasion: 0, traits: [] },

  // 系統特効 5 種
  swarmGuard: { slot: 'armor', name: '群れよけの盾', bane: 'swarm', dropOnly: false, effect: '被弾でスタミナが減らない', defBonus: 0, evasion: 0.05, traits: ['guard'] },
  windCloak: { slot: 'armor', name: '疾風の外套', bane: 'swift', dropOnly: false, effect: '', defBonus: -1, evasion: 0.2, traits: [] },
  warBreaker: { slot: 'armor', name: '戦士殺しの鎧', bane: 'warrior', dropOnly: false, effect: '', defBonus: 2, evasion: 0, traits: [] },
  wardCharm: { slot: 'armor', name: '変則よけの護符', bane: 'odd', dropOnly: false, effect: '腐食を防ぐ', defBonus: 0, evasion: 0.05, traits: ['wardCorrosion'] },
  thornMail: { slot: 'armor', name: '棘鎧', bane: 'heavy', dropOnly: false, effect: '近接攻撃を受けると反撃する', defBonus: 1, evasion: 0, traits: ['thorns'] },

  // ドロップ限定
  shadowVeil: { slot: 'armor', name: '影衣', bane: null, dropOnly: true, effect: '', defBonus: -2, evasion: 0.28, traits: [] },
  adamantMail: { slot: 'armor', name: '金剛の鎧', bane: null, dropOnly: true, effect: '', defBonus: 4, evasion: 0, traits: [] },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const ARMOR_IDS = Object.keys(ARMORS) as ArmorId[];

/** 身に着けている 1 点。id が種類、power が深さから決まる強さ */
export interface Equipped {
  id: EquipId;
  power: number;
}

export function isWeaponId(id: EquipId): id is WeaponId {
  return id in WEAPONS;
}

export function equipDef(id: EquipId): EquipDef {
  return isWeaponId(id) ? WEAPONS[id] : ARMORS[id as ArmorId];
}

export function equipName(e: Equipped): string {
  return `${equipDef(e.id).name} +${e.power}`;
}

// ---------------------------------------------------------------------------
// 実効値。装備していないときの既定値もここで決める

/** 武器から得る攻撃力。負にはしない */
export function weaponAtk(e: Equipped | null): number {
  if (!e) return 0;
  return Math.max(0, e.power + (equipDef(e.id) as WeaponDef).atkBonus);
}

export function weaponAccuracy(e: Equipped | null): number {
  return e ? (equipDef(e.id) as WeaponDef).accuracy : BARE_ACCURACY;
}

export function weaponHas(e: Equipped | null, trait: WeaponTrait): boolean {
  return e ? (equipDef(e.id) as WeaponDef).traits.includes(trait) : false;
}

/** 防具から得る減算値。負にはしない */
export function armorDefense(e: Equipped | null): number {
  if (!e) return 0;
  return Math.max(0, e.power + (equipDef(e.id) as ArmorDef).defBonus);
}

export function armorEvasion(e: Equipped | null): number {
  return e ? (equipDef(e.id) as ArmorDef).evasion : 0;
}

export function armorHas(e: Equipped | null, trait: ArmorTrait): boolean {
  return e ? (equipDef(e.id) as ArmorDef).traits.includes(trait) : false;
}

/** 名前と強さ。装備していないときは素手・裸 */
export function equipHeadline(e: Equipped | null, slot: EquipSlot): string {
  if (!e) return slot === 'weapon' ? '素手' : '裸';
  return equipName(e);
}

/**
 * 性能を並べた 1 行。
 * 名前から効果を推測させないために、数値と特殊効果と効く系統をここに全部出す。
 */
export function equipDetail(e: Equipped | null, slot: EquipSlot): string {
  if (!e) {
    return slot === 'weapon' ? `攻撃 +0 / 命中 ${pct(BARE_ACCURACY)}` : '防御 +0 / 回避 0%';
  }
  const def = equipDef(e.id);
  const parts =
    def.slot === 'weapon'
      ? [`攻撃 +${weaponAtk(e)}`, `命中 ${pct(def.accuracy)}`]
      : [`防御 +${armorDefense(e)}`, `回避 ${pct(def.evasion)}`];
  if (def.bane) parts.push(`${FAMILY_NAMES[def.bane]}に効く`);
  if (def.effect) parts.push(def.effect);
  return parts.join(' / ');
}

/** 見出しと性能を 2 行で返す */
export function equipSummary(e: Equipped | null, slot: EquipSlot): string {
  return `${equipHeadline(e, slot)}
${equipDetail(e, slot)}`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
