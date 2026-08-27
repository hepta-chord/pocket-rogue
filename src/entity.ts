import type { GameMap } from './map';
import { Tile, idx, isWalkable } from './map';
import type { Rng } from './rng';

export type MonsterKind = 'rat' | 'bat' | 'goblin' | 'slime' | 'orc' | 'ghost' | 'troll' | 'wolf' | 'dragon';
export type ActorKind = 'player' | MonsterKind;

export interface Actor {
  id: number;
  kind: ActorKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  /** 防御力。被ダメージを減らす。プレイヤーは防具の値を別に足す */
  def: number;
  /** 回避率 0〜1。プレイヤーは防具の値を別に足す */
  evasion: number;
}

/**
 * パッシブ: 常に働く性質。
 * - fast: 1 ターンに 2 回行動する (攻撃は 1 回まで)
 * - slow: 2 ターンに 1 回しか行動しない
 * - regen: 毎ターン HP 1 回復
 * - erratic: 追うとき半分の確率で狙いがそれる
 * - phasing: 壁の中を移動できる
 * - split: 近接攻撃を受けて生き残ると HP を半分にして 2 匹に割れる
 */
export type Passive = 'fast' | 'slow' | 'regen' | 'erratic' | 'phasing' | 'split';

/**
 * アクション: 条件が揃ったとき確率で使う技。使わなかったら通常行動。
 * - doubleAttack: 隣接時、2 回攻撃
 * - smash: 隣接時、防具を無視した一撃
 * - leap: 距離 2 のとき、一気に隣接して攻撃
 * - breath: 距離 2〜4 で見えているとき、炎を吐く (攻撃力の半分 + 階数。防具で軽減)
 */
export type ActionKind = 'doubleAttack' | 'smash' | 'leap' | 'breath';

export interface MonsterAction {
  kind: ActionKind;
  /** 条件が揃ったときに使う確率 (0〜1) */
  chance: number;
}

/**
 * 系統。敵を役割で畳んだ分類で、装備の系統特効が効く相手を決める軸になる。
 * - swarm 群れ: 1 体は弱く数で押す
 * - swift 俊敏: 速い、逃げられない
 * - warrior 戦士: 素直に強い、装備を落とす
 * - odd 変則: 通常の戦い方が通じない
 * - heavy 重装: 高 HP、鈍足、再生
 * - boss ボス: 階を代表する 1 体
 *
 * 今は分類を持たせるだけで、効果はまだ何にも繋がっていない。
 * 装備の系統特効とグレード変種が、この軸を参照して入る。
 */
export type MonsterFamily = 'swarm' | 'swift' | 'warrior' | 'odd' | 'heavy' | 'boss';

export const FAMILY_NAMES: Record<MonsterFamily, string> = {
  swarm: '群れ',
  swift: '俊敏',
  warrior: '戦士',
  odd: '変則',
  heavy: '重装',
  boss: 'ボス',
};

export interface MonsterDef {
  name: string;
  family: MonsterFamily;
  hp: number;
  atk: number;
  /** 防御力。プレイヤーの被弾計算と対称に効く */
  def: number;
  /**
   * 回避率 0〜1。命中率と掛け算になるので低く抑える。
   * 命中 80% の武器で回避 20% の相手に当てると実効 64% になり、3 連続で外れる確率が 5% 近く出る。
   */
  evasion: number;
  /** 倒したときの経験値。スコアの撃破点にも同じ値を使う */
  xp: number;
  /** この階から出る */
  minDepth: number;
  /** この階を過ぎると出ない */
  maxDepth: number;
  /** 出現の重み */
  weight: number;
  /** 1 階に配置する上限 (分裂などで増えるぶんは含まない) */
  maxPerFloor: number;
  /** 群れの人数 [最小, 最大] */
  pack: [number, number];
  passives: Passive[];
  action?: MonsterAction;
}

const ANY = 99;

// 敵の定義表。新しい敵はここに 1 行足せば出る。
// スライムの経験値が低いのは、分裂で 1 匹から何度も倒せるため (稼ぎ場にならないように抑えている)。
export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  rat: { name: 'ネズミ', family: 'swarm', hp: 3, atk: 1, def: 0, evasion: 0, xp: 1, minDepth: 1, maxDepth: 4, weight: 5, maxPerFloor: ANY, pack: [2, 3], passives: [] },
  bat: { name: 'コウモリ', family: 'swift', hp: 4, atk: 2, def: 0, evasion: 0.1, xp: 2, minDepth: 1, maxDepth: 6, weight: 3, maxPerFloor: ANY, pack: [1, 1], passives: ['fast', 'erratic'] },
  goblin: { name: 'ゴブリン', family: 'warrior', hp: 6, atk: 2, def: 1, evasion: 0, xp: 4, minDepth: 2, maxDepth: 8, weight: 4, maxPerFloor: ANY, pack: [1, 1], passives: [], action: { kind: 'doubleAttack', chance: 0.3 } },
  slime: { name: 'スライム', family: 'odd', hp: 8, atk: 2, def: 1, evasion: 0, xp: 2, minDepth: 3, maxDepth: 7, weight: 3, maxPerFloor: 2, pack: [1, 1], passives: ['split'] },
  orc: { name: 'オーク', family: 'warrior', hp: 12, atk: 4, def: 2, evasion: 0, xp: 9, minDepth: 4, maxDepth: ANY, weight: 3, maxPerFloor: ANY, pack: [1, 1], passives: [] },
  ghost: { name: '幽霊', family: 'odd', hp: 8, atk: 3, def: 0, evasion: 0.05, xp: 8, minDepth: 5, maxDepth: ANY, weight: 2, maxPerFloor: ANY, pack: [1, 1], passives: ['phasing'] },
  troll: { name: 'トロル', family: 'heavy', hp: 18, atk: 5, def: 3, evasion: 0, xp: 16, minDepth: 6, maxDepth: ANY, weight: 2, maxPerFloor: ANY, pack: [1, 1], passives: ['regen', 'slow'], action: { kind: 'smash', chance: 0.25 } },
  wolf: { name: '狼', family: 'swift', hp: 10, atk: 4, def: 1, evasion: 0.1, xp: 11, minDepth: 7, maxDepth: ANY, weight: 3, maxPerFloor: ANY, pack: [1, 1], passives: ['fast'], action: { kind: 'leap', chance: 0.4 } },
  dragon: { name: 'ドラゴン', family: 'boss', hp: 30, atk: 8, def: 3, evasion: 0, xp: 40, minDepth: 9, maxDepth: ANY, weight: 1, maxPerFloor: 1, pack: [1, 1], passives: [], action: { kind: 'breath', chance: 0.3 } },
};

/** 分裂で増えるスライムの上限 (1 階あたり) */
export const SLIME_CAP = 4;

export function monsterDef(kind: ActorKind): MonsterDef | null {
  return kind === 'player' ? null : MONSTERS[kind];
}

export function familyOf(kind: ActorKind): MonsterFamily | null {
  return monsterDef(kind)?.family ?? null;
}

export function hasPassive(kind: ActorKind, p: Passive): boolean {
  return monsterDef(kind)?.passives.includes(p) ?? false;
}

export function actorName(kind: ActorKind): string {
  return kind === 'player' ? 'あなた' : MONSTERS[kind].name;
}

/**
 * プレイヤーの素の攻撃力。レベルでは伸びず、武器の補正が上に乗る。
 * 0 にすると武器の引きだけで勝敗が決まるので、下限として残してある。
 */
export const PLAYER_BASE_ATK = 4;

export function createPlayer(x: number, y: number): Actor {
  return { id: 0, kind: 'player', x, y, hp: 20, maxHp: 20, atk: PLAYER_BASE_ATK, def: 0, evasion: 0 };
}

/** 階の深さに応じて強くした個体を作る */
export function createMonster(kind: MonsterKind, depth: number, x: number, y: number, id: number): Actor {
  const m = MONSTERS[kind];
  const bonus = Math.max(0, depth - m.minDepth);
  const hp = m.hp + bonus;
  return {
    id,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    atk: m.atk + Math.floor(bonus / 3),
    def: m.def + Math.floor(bonus / 4),
    evasion: m.evasion,
  };
}

/**
 * 階ごとの配置。人数の予算 (3 + 階 + 0〜2) を、出現条件を満たす敵から重みで選んで埋める。
 * 群れは 1 回の抽選でまとめて置き、上限のある敵は数える。
 */
export function spawnMonsters(
  rng: Rng,
  map: GameMap,
  depth: number,
  avoid: { x: number; y: number },
  nextId: () => number,
): Actor[] {
  const budget = 3 + depth + rng.int(0, 2);
  const monsters: Actor[] = [];
  const counts: Partial<Record<MonsterKind, number>> = {};

  for (let attempt = 0; attempt < 30 && monsters.length < budget; attempt++) {
    const pool = (Object.keys(MONSTERS) as MonsterKind[]).filter((k) => {
      const d = MONSTERS[k];
      return d.minDepth <= depth && depth <= d.maxDepth && (counts[k] ?? 0) < d.maxPerFloor;
    });
    if (pool.length === 0) break;
    const kind = weightedPick(rng, pool);
    const def = MONSTERS[kind];
    const first = findSpot(rng, map, avoid, monsters);
    if (!first) continue;
    monsters.push(createMonster(kind, depth, first.x, first.y, nextId()));
    counts[kind] = (counts[kind] ?? 0) + 1;

    const packSize = rng.int(def.pack[0], def.pack[1]);
    for (let i = 1; i < packSize; i++) {
      const near = findNear(rng, map, first, monsters, avoid);
      if (!near) break;
      monsters.push(createMonster(kind, depth, near.x, near.y, nextId()));
    }
  }
  return monsters;
}

function weightedPick(rng: Rng, pool: MonsterKind[]): MonsterKind {
  const total = pool.reduce((sum, k) => sum + MONSTERS[k].weight, 0);
  let r = rng.next() * total;
  for (const k of pool) {
    r -= MONSTERS[k].weight;
    if (r < 0) return k;
  }
  return pool[pool.length - 1];
}

function findSpot(
  rng: Rng,
  map: GameMap,
  avoid: { x: number; y: number },
  occupied: Actor[],
): { x: number; y: number } | null {
  for (let tries = 0; tries < 50; tries++) {
    const room = rng.pick(map.rooms);
    const x = rng.int(room.x, room.x + room.w - 1);
    const y = rng.int(room.y, room.y + room.h - 1);
    if (map.tiles[idx(map, x, y)] !== Tile.Floor) continue;
    if (Math.max(Math.abs(x - avoid.x), Math.abs(y - avoid.y)) < 6) continue;
    if (occupied.some((m) => m.x === x && m.y === y)) continue;
    return { x, y };
  }
  return null;
}

/** 群れの仲間を置く。中心から 2 マス以内の空いた床 */
function findNear(
  rng: Rng,
  map: GameMap,
  center: { x: number; y: number },
  occupied: Actor[],
  avoid: { x: number; y: number },
): { x: number; y: number } | null {
  for (let tries = 0; tries < 20; tries++) {
    const x = center.x + rng.int(-2, 2);
    const y = center.y + rng.int(-2, 2);
    if (!isWalkable(map, x, y) || map.tiles[idx(map, x, y)] !== Tile.Floor) continue;
    if (Math.max(Math.abs(x - avoid.x), Math.abs(y - avoid.y)) < 5) continue;
    if (occupied.some((m) => m.x === x && m.y === y)) continue;
    return { x, y };
  }
  return null;
}
