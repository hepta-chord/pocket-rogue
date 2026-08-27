import type { GameMap } from './map';
import { Tile, idx, isWalkable, randomFloorTile } from './map';
import type { Rng } from './rng';

// 敵は 5 系統 × 3 グレード + ボスの 16 種。
// グレードは種類ごとに階層を割り当てるのではなく、同じ系統の変種として変化させる。
// 名前とグリフから系統と強さを推測できるように、系統ごとに base の生き物と文字を固定してある。
export type MonsterKind =
  | 'rat'
  | 'ratPoison'
  | 'ratRot'
  | 'bat'
  | 'batGale'
  | 'batStorm'
  | 'goblin'
  | 'goblinArmored'
  | 'goblinKing'
  | 'slime'
  | 'slimeSplit'
  | 'slimeMimic'
  | 'troll'
  | 'trollRock'
  | 'trollIron'
  | 'dragon'
  | 'stalker';
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
  /** 擬態が解けたか。mimic を持つ敵だけが使う */
  revealed?: boolean;
  /** フロア生成後に湧いた個体。経験値とドロップを下げる */
  spawned?: boolean;
}

/**
 * パッシブ: 常に働く性質。
 * - fast: 1 ターンに 2 回行動する (攻撃は 1 回まで)
 * - slow: 2 ターンに 1 回しか行動しない
 * - regen: 毎ターン HP 1 回復
 * - erratic: 追うとき半分の確率で狙いがそれる
 * - phasing: 壁の中を移動できる
 * - split: 近接攻撃を受けて生き残ると HP を半分にして 2 匹に割れる
 * - mimic: 落ちている武器に化けている。隣に来るか殴られるまで動かず、武器として見える
 */
export type Passive = 'fast' | 'slow' | 'regen' | 'erratic' | 'phasing' | 'split' | 'mimic';

/**
 * アクション: 条件が揃ったとき確率で使う技。使わなかったら通常行動。
 * - doubleAttack: 隣接時、2 回攻撃
 * - smash: 隣接時、防具を無視した一撃
 * - leap: 距離 2 のとき、一気に隣接して攻撃
 * - breath: 距離 2〜4 で見えているとき、炎を吐く (攻撃力の半分 + 階数。防具で軽減)
 * - poison: 隣接時、毒を与える (しばらく毎ターン HP が減る)
 * - corrodeHit: 隣接時、装備を腐食させる
 */
export type ActionKind = 'doubleAttack' | 'smash' | 'leap' | 'breath' | 'poison' | 'corrodeHit';

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
 * 装備の系統特効がこの軸を参照する。
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
  /** 1〜3。10 階ごとに次のグレードへ切り替わる。ボスは 0 */
  grade: number;
  hp: number;
  atk: number;
  /** 防御力。プレイヤーの被弾計算と対称に効く */
  def: number;
  /**
   * 回避率 0〜1。命中率と掛け算になるので低く抑える。
   * 命中 80% の武器で回避 20% の相手に当てると実効 64% になり、3 連続で外れる確率が 5% 近く出る。
   */
  evasion: number;
  /** 倒したときの経験値 */
  xp: number;
  /**
   * 倒したときのスコア。省くと経験値と同じ値になる。
   * 追う者のように「経験値は 0 だがスコアは出す」敵を素直に書けるように分けてある。
   */
  bounty?: number;
  /** この階から出る */
  minDepth: number;
  /** この階を過ぎると出ない */
  maxDepth: number;
  /** 出現の重み。0 なら通常の配置では出ない */
  weight: number;
  /** 1 階に配置する上限 (分裂などで増えるぶんは含まない) */
  maxPerFloor: number;
  /** 群れの人数 [最小, 最大] */
  pack: [number, number];
  passives: Passive[];
  action?: MonsterAction;
}

/**
 * 階が深いほど、同じ敵でも 1 体の価値が上がる割合。
 *
 * グレードの中では敵の種類が変わらないのに必要経験値だけが伸びるので、
 * 深いほどレベルが上がりにくくなっていた (B9 で 1 レベルに 16 体)。
 * HP や攻撃力と同じように経験値にも深さ補正を掛けて、どの階でも 4〜8 体で 1 レベルにする。
 *
 * 掛けるのは「その敵が出始めてからの階数」ではなく**絶対の階数**である。
 * 出始めからの階数だと、グレードが切り替わる階で補正が 0 に戻り、
 * B10 より B11 のほうが 1 体の経験値が下がって、そこだけレベルが上がらなくなる。
 */
export const XP_DEPTH_RATE = 0.15;

/** その階で倒したときの経験値 */
export function xpFor(def: MonsterDef, depth: number): number {
  if (def.xp <= 0) return 0;
  return Math.max(1, Math.round(def.xp * (1 + depth * XP_DEPTH_RATE)));
}

/** その階で倒したときにスコアへ入る点 */
export function bountyFor(def: MonsterDef, depth: number): number {
  const base = def.bounty ?? def.xp;
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * (1 + depth * XP_DEPTH_RATE)));
}

const ANY = 99;

/** グレードが切り替わる間隔 (階) */
export const GRADE_SPAN = 10;

/** その階のグレード。31 階以降は 3 のまま据え置く */
export function gradeAt(depth: number): number {
  return Math.min(3, Math.floor((depth - 1) / GRADE_SPAN) + 1);
}

/**
 * 敵の定義表。
 *
 * グレードの境目で数値が飛ばないように、次のグレードの基礎値は
 * 前のグレードが最深部で持つ値 (createMonster の深さ補正込み) から続くように置いてある。
 * 例: 群れのグレード 1 は B10 で HP 12 になるので、グレード 2 の基礎 HP は 14 にしてある。
 *
 * 系統ごとに文字と base の生き物を固定し、名前の修飾でグレードを示す。
 */
export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  // 群れ: 1 体は弱く数で押す。グレードが上がると付与攻撃を持つ
  rat: { name: 'ネズミ', family: 'swarm', grade: 1, hp: 3, atk: 1, def: 0, evasion: 0, xp: 2, minDepth: 1, maxDepth: 10, weight: 5, maxPerFloor: ANY, pack: [2, 3], passives: [] },
  ratPoison: { name: '毒ネズミ', family: 'swarm', grade: 2, hp: 14, atk: 5, def: 2, evasion: 0, xp: 8, minDepth: 11, maxDepth: 20, weight: 5, maxPerFloor: ANY, pack: [2, 4], passives: [], action: { kind: 'poison', chance: 0.25 } },
  ratRot: { name: '腐れネズミ', family: 'swarm', grade: 3, hp: 26, atk: 9, def: 4, evasion: 0, xp: 24, minDepth: 21, maxDepth: ANY, weight: 5, maxPerFloor: ANY, pack: [3, 5], passives: [], action: { kind: 'corrodeHit', chance: 0.2 } },

  // 俊敏: 速い、逃げられない。グレードが上がると跳躍が付く
  bat: { name: 'コウモリ', family: 'swift', grade: 1, hp: 4, atk: 3, def: 0, evasion: 0.1, xp: 3, minDepth: 1, maxDepth: 10, weight: 3, maxPerFloor: ANY, pack: [1, 1], passives: ['fast', 'erratic'] },
  batGale: { name: '疾風コウモリ', family: 'swift', grade: 2, hp: 15, atk: 7, def: 2, evasion: 0.12, xp: 10, minDepth: 11, maxDepth: 20, weight: 3, maxPerFloor: ANY, pack: [1, 2], passives: ['fast', 'erratic'], action: { kind: 'leap', chance: 0.4 } },
  batStorm: { name: '雷コウモリ', family: 'swift', grade: 3, hp: 27, atk: 11, def: 4, evasion: 0.15, xp: 30, minDepth: 21, maxDepth: ANY, weight: 3, maxPerFloor: ANY, pack: [1, 2], passives: ['fast', 'erratic'], action: { kind: 'leap', chance: 0.5 } },

  // 戦士: 素直に強い。装備を落とす率が高い系統
  goblin: { name: 'ゴブリン', family: 'warrior', grade: 1, hp: 6, atk: 4, def: 1, evasion: 0, xp: 4, minDepth: 2, maxDepth: 10, weight: 4, maxPerFloor: ANY, pack: [1, 1], passives: [], action: { kind: 'doubleAttack', chance: 0.3 } },
  goblinArmored: { name: '重装ゴブリン', family: 'warrior', grade: 2, hp: 17, atk: 7, def: 4, evasion: 0, xp: 14, minDepth: 11, maxDepth: 20, weight: 4, maxPerFloor: ANY, pack: [1, 1], passives: [], action: { kind: 'doubleAttack', chance: 0.4 } },
  goblinKing: { name: 'ゴブリン王', family: 'warrior', grade: 3, hp: 29, atk: 11, def: 6, evasion: 0, xp: 40, minDepth: 21, maxDepth: ANY, weight: 4, maxPerFloor: ANY, pack: [1, 1], passives: [], action: { kind: 'doubleAttack', chance: 0.5 } },

  // 変則: 通常の戦い方が通じない。分裂 → 壁抜け → 擬態と重なっていく
  slime: { name: 'スライム', family: 'odd', grade: 1, hp: 8, atk: 3, def: 1, evasion: 0, xp: 3, minDepth: 3, maxDepth: 10, weight: 3, maxPerFloor: 2, pack: [1, 1], passives: ['split'] },
  slimeSplit: { name: '幽体スライム', family: 'odd', grade: 2, hp: 18, atk: 6, def: 3, evasion: 0.05, xp: 8, minDepth: 11, maxDepth: 20, weight: 3, maxPerFloor: 2, pack: [1, 1], passives: ['split', 'phasing'] },
  slimeMimic: { name: '擬態スライム', family: 'odd', grade: 3, hp: 30, atk: 10, def: 5, evasion: 0.05, xp: 22, minDepth: 21, maxDepth: ANY, weight: 3, maxPerFloor: 2, pack: [1, 1], passives: ['split', 'phasing', 'mimic'] },

  // 重装: 高 HP、鈍足、再生。強打の発生率と再生量が上がっていく
  troll: { name: 'トロル', family: 'heavy', grade: 1, hp: 18, atk: 8, def: 3, evasion: 0, xp: 16, minDepth: 6, maxDepth: 10, weight: 2, maxPerFloor: 2, pack: [1, 1], passives: ['regen', 'slow'], action: { kind: 'smash', chance: 0.25 } },
  trollRock: { name: '岩トロル', family: 'heavy', grade: 2, hp: 24, atk: 10, def: 4, evasion: 0, xp: 34, minDepth: 11, maxDepth: 20, weight: 2, maxPerFloor: 2, pack: [1, 1], passives: ['regen', 'slow'], action: { kind: 'smash', chance: 0.35 } },
  trollIron: { name: '鉄トロル', family: 'heavy', grade: 3, hp: 36, atk: 14, def: 6, evasion: 0, xp: 70, minDepth: 21, maxDepth: ANY, weight: 2, maxPerFloor: 2, pack: [1, 1], passives: ['regen', 'slow'], action: { kind: 'smash', chance: 0.45 } },

  // ボス: 階を代表する 1 体
  dragon: { name: 'ドラゴン', family: 'boss', grade: 0, hp: 30, atk: 12, def: 3, evasion: 0, xp: 40, bounty: 120, minDepth: 10, maxDepth: ANY, weight: 0, maxPerFloor: 1, pack: [1, 1], passives: [], action: { kind: 'breath', chance: 0.3 } },

  // 長居への対策。通常の配置では出ず、フロア内のターン数で呼ばれる。
  // 勝てない強さだが、逃げ切れるように fast は付けない。
  // 経験値を 0 にしてあるので、倒せてしまっても成長が壊れない。
  stalker: { name: '追う者', family: 'boss', grade: 0, hp: 160, atk: 12, def: 8, evasion: 0, xp: 0, bounty: 300, minDepth: 1, maxDepth: ANY, weight: 0, maxPerFloor: 1, pack: [1, 1], passives: [], action: { kind: 'smash', chance: 0.3 } },
};

/** 長居への対策として呼ばれる敵 */
export const STALKER: MonsterKind = 'stalker';

/** フロアボス */
export const BOSS: MonsterKind = 'dragon';

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
      return d.weight > 0 && d.minDepth <= depth && depth <= d.maxDepth && (counts[k] ?? 0) < d.maxPerFloor;
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

/**
 * 追加で 1 体だけ湧かせる。
 *
 * 倒し切ると階が無人になるので、滞在ターン数に応じて足す。
 * 目の前に湧くと避けようがないので、置ける場所は呼び出し側が絞る。
 */
export function spawnOne(
  rng: Rng,
  map: GameMap,
  depth: number,
  occupied: Actor[],
  nextId: () => number,
  allowed: (x: number, y: number) => boolean,
): Actor | null {
  const pool = (Object.keys(MONSTERS) as MonsterKind[]).filter((k) => {
    const d = MONSTERS[k];
    return d.weight > 0 && d.minDepth <= depth && depth <= d.maxDepth;
  });
  if (pool.length === 0) return null;

  for (let tries = 0; tries < 40; tries++) {
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (!allowed(at.x, at.y)) continue;
    if (occupied.some((m) => m.x === at.x && m.y === at.y)) continue;
    return createMonster(weightedPick(rng, pool), depth, at.x, at.y, nextId());
  }
  return null;
}

/** 指定した種類を 1 体、置ける場所に出す */
export function placeMonster(
  rng: Rng,
  map: GameMap,
  kind: MonsterKind,
  depth: number,
  occupied: Actor[],
  nextId: () => number,
  allowed: (x: number, y: number) => boolean,
): Actor | null {
  for (let tries = 0; tries < 60; tries++) {
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (!allowed(at.x, at.y)) continue;
    if (occupied.some((m) => m.x === at.x && m.y === at.y)) continue;
    return createMonster(kind, depth, at.x, at.y, nextId());
  }
  return null;
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
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (Math.max(Math.abs(at.x - avoid.x), Math.abs(at.y - avoid.y)) < 6) continue;
    if (occupied.some((m) => m.x === at.x && m.y === at.y)) continue;
    return at;
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
