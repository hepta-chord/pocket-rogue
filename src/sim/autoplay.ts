// バランス調整用のヘッドレス自動プレイ。
//
// 目的は最適プレイの再現ではなく、変更の前後を同じ方針で比べることである。
// 方針は「隣の敵を殴る、危なくなったら飲む、近くのアイテムを拾う、階段へ向かう」の 4 つだけで、
// 数値を変えたときに死亡階や被弾がどう動くかを見るには足りる。
//
// GameState と step() が DOM を触らないので、そのまま Node で回せる。

import { BOSS } from '../entity';
import {
  canCast,
  isBossFloor,
  newGame,
  setDamageObserver,
  step,
  visibleMonsters,
  type Action,
  type DamageEvent,
  type DamageSource,
  type GameState,
} from '../game';
import {
  armorDefense,
  armorEvasion,
  equipDef,
  weaponAccuracy,
  weaponAtk,
  type Equipped,
} from '../equip';
import type { FloorKind } from '../floors';
import { isEquip, stackLimit, type ConsumableKind, type Item } from '../items';
import { canStep, idx, isWalkable, Tile } from '../map';

export interface Policy {
  /** HP がこの割合を下回ったら回復薬を飲む */
  potionAt: number;
  /** 見えている敵がこの数以上で、かつ HP が半分以下なら雷を唱える */
  thunderAt: number;
  /** スタミナがこの割合を下回ったらスタミナ薬を飲む */
  elixirAt: number;
  /** この歩数以内に見えているアイテムがあれば、階段より先に取りにいく */
  itemRange: number;
  /** HP がこの割合を下回ったら青い床を取りにいく */
  healFloorAt: number;
}

export const DEFAULT_POLICY: Policy = {
  potionAt: 0.45,
  thunderAt: 3,
  elixirAt: 0.25,
  itemRange: 14,
  healFloorAt: 0.6,
};

export interface RunLimits {
  /** 1 つの run で進める上限 */
  maxTurns: number;
  /** 1 階に留まれる上限。超えたら階段が見つからないとみなして打ち切る */
  maxTurnsPerFloor: number;
}

export const DEFAULT_LIMITS: RunLimits = { maxTurns: 8000, maxTurnsPerFloor: 900 };

export interface RunResult {
  seed: string;
  /** 到達した最も深い階 */
  depth: number;
  turns: number;
  level: number;
  kills: number;
  score: number;
  /** 死んで終わったか。false なら上限で打ち切った */
  died: boolean;
  /** レベルアップ 1 回あたりに倒した敵の数。レベル 1 のままなら null */
  killsPerLevel: number | null;
  /** 到達したボス階の数 (B10, B20, ...) */
  bossFloorsSeen: number;
  /** 倒したボスの数 */
  bossKills: number;
  /** 脱出してクリアしたか */
  cleared: boolean;
  /** 最後に受けたダメージの出どころ。死因の目安 */
  killedBy: DamageSource | null;
  /** 階ごとの内訳 */
  byDepth: DepthStats[];
}

export interface DepthStats {
  depth: number;
  /** 被弾した回数 */
  hits: number;
  /** 実際に通ったダメージの合計 */
  totalDealt: number;
  /** 軽減する前の出目の合計 */
  totalRoll: number;
  /** 1 ダメージに潰れた回数 */
  ones: number;
  kills: number;
  levelUps: number;
  turns: number;
}

/** 1 回分の自動プレイ */
export function runOne(
  seed: string,
  policy: Policy = DEFAULT_POLICY,
  limits: RunLimits = DEFAULT_LIMITS,
): RunResult {
  const state = newGame(seed);
  const rows = new Map<number, DepthStats>();
  const row = (depth: number): DepthStats => {
    let r = rows.get(depth);
    if (!r) {
      r = { depth, hits: 0, totalDealt: 0, totalRoll: 0, ones: 0, kills: 0, levelUps: 0, turns: 0 };
      rows.set(depth, r);
    }
    return r;
  };

  let killedBy: DamageSource | null = null;
  setDamageObserver((e: DamageEvent) => {
    if (e.to !== 'player') return;
    killedBy = e.from;
    const r = row(e.depth);
    r.hits++;
    r.totalDealt += e.dealt;
    r.totalRoll += e.roll;
    if (e.dealt === 1) r.ones++;
  });

  let maxDepth = state.depth;
  let floorStart = state.turn;
  let lastDepth = state.depth;
  let bossFloorsSeen = isBossFloor(state.depth) ? 1 : 0;
  let bossKills = 0;
  let bossHere = state.monsters.some((m) => m.kind === BOSS);
  let lastKills = state.kills;
  let lastLevel = state.level;
  let lastTurn = state.turn;

  try {
    while (!state.over && state.turn < limits.maxTurns) {
      if (state.depth !== lastDepth) {
        lastDepth = state.depth;
        floorStart = state.turn;
        if (isBossFloor(state.depth)) bossFloorsSeen++;
        bossHere = state.monsters.some((m) => m.kind === BOSS);
      }
      if (state.turn - floorStart > limits.maxTurnsPerFloor) break;

      const here = state.depth;
      const action = decide(state, policy);
      const result = step(state, action);
      // 選んだ手が通らなかった (敵に塞がれた等) ときは、詰まらないように 1 マス適当に動く
      if (!result.acted && !state.prompt) step(state, randomStep(state));

      // 撃破とレベルアップは、それが起きた階に付ける
      const r = row(here);
      r.kills += state.kills - lastKills;
      r.levelUps += state.level - lastLevel;
      r.turns += state.turn - lastTurn;
      lastKills = state.kills;
      lastLevel = state.level;
      lastTurn = state.turn;

      // ボスが消えていたら倒したとみなす (この階から出ないので取り違えない)
      if (bossHere && !state.monsters.some((m) => m.kind === BOSS)) {
        bossHere = false;
        bossKills++;
      }

      maxDepth = Math.max(maxDepth, state.depth);
    }
  } finally {
    setDamageObserver(null);
  }

  const levelUps = state.level - 1;
  return {
    seed,
    depth: maxDepth,
    turns: state.turn,
    level: state.level,
    kills: state.kills,
    score: state.score,
    died: state.over,
    killsPerLevel: levelUps > 0 ? state.kills / levelUps : null,
    bossFloorsSeen,
    bossKills,
    cleared: state.cleared,
    killedBy: state.over ? killedBy : null,
    byDepth: [...rows.values()].sort((a, b) => a.depth - b.depth),
  };
}

/** seed を並べてまとめて回す */
export function runMany(seeds: string[], policy?: Policy, limits?: RunLimits): RunResult[] {
  return seeds.map((s) => runOne(s, policy, limits));
}

/** 再現できるように、番号から seed 文字列を作る */
export function seedList(count: number, prefix = 'SIM'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
}

// ---------------------------------------------------------------------------
// 方針

function decide(state: GameState, policy: Policy): Action {
  // 確認が出ていたら、まずそれに答える
  if (state.prompt) {
    if (state.prompt.kind === 'equip') {
      return isUpgrade(state, state.prompt.item) ? { type: 'confirm' } : { type: 'cancel' };
    }
    // 脱出すると run がそこで終わって到達階の分布が測れないので、潜り続ける側を選ぶ
    if (state.prompt.kind === 'escape') return { type: 'cancel' };
    return { type: 'confirm' };
  }

  const p = state.player;
  const ratio = p.hp / p.maxHp;
  const seen = visibleMonsters(state);

  if (ratio <= policy.potionAt && state.inventory.potion > 0) return { type: 'use', item: 'potion' };
  if (
    state.stamina <= state.staminaMax * policy.elixirAt &&
    state.inventory.elixir > 0
  ) {
    return { type: 'use', item: 'elixir' };
  }
  if (seen.length >= policy.thunderAt && ratio <= 0.5 && canCast(state, 'thunder')) {
    return { type: 'cast', spell: 'thunder' };
  }

  const adjacent = seen.find((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1);
  if (adjacent) return { type: 'move', dx: Math.sign(adjacent.x - p.x), dy: Math.sign(adjacent.y - p.y) };

  // 傷ついていたら、立て直しの拠点である青い床を先に取りにいく
  if (ratio <= policy.healFloorAt) {
    const heal = nearestFloorStep(state, 'blue', policy.itemRange);
    if (heal) return heal;
  }

  const item = nearestItemStep(state, policy.itemRange);
  if (item) return item;

  const stairs = stepTowardStairs(state);
  if (stairs) return stairs;

  const frontier = stepTowardFrontier(state);
  if (frontier) return frontier;

  return randomStep(state);
}

function nearestItemStep(state: GameState, range: number): Action | null {
  const known = state.items.filter(
    (it) => state.explored[idx(state.map, it.x, it.y)] === 1 && canTake(state, it),
  );
  if (known.length === 0) return null;
  return bfsStep(state, known.map((it) => ({ x: it.x, y: it.y })), range);
}

/**
 * 拾って意味があるか。
 *
 * 所持上限に達した消耗品と、持ち替えない装備は床に残る。
 * 除かないと、同じアイテムを目指して踏んでは離れるのを繰り返し、階から出られなくなる。
 */
function canTake(state: GameState, item: Item): boolean {
  if (isEquip(item.kind)) return isUpgrade(state, item);
  return state.inventory[item.kind as ConsumableKind] < stackLimit(item.kind as ConsumableKind);
}

/**
 * 拾った装備が今のものより良いか。
 *
 * 自動プレイの判断なので厳密である必要はない。
 * 武器は「攻撃力 × 命中率」、防具は「減算値 + 回避率の重み」で比べる。
 */
function isUpgrade(state: GameState, item: Item): boolean {
  if (!item.equip) return false;
  const found: Equipped = { id: item.equip, power: item.power };
  if (equipDef(item.equip).slot === 'weapon') {
    return weaponScore(found) > weaponScore(state.weapon);
  }
  return armorScore(found) > armorScore(state.armor);
}

function weaponScore(e: Equipped | null): number {
  return weaponAtk(e) * weaponAccuracy(e);
}

function armorScore(e: Equipped | null): number {
  return armorDefense(e) + armorEvasion(e) * 4;
}

function nearestFloorStep(state: GameState, kind: FloorKind, range: number): Action | null {
  const known = state.floors.filter(
    (f) => f.kind === kind && state.explored[idx(state.map, f.x, f.y)] === 1,
  );
  if (known.length === 0) return null;
  return bfsStep(state, known.map((f) => ({ x: f.x, y: f.y })), range);
}

function stepTowardStairs(state: GameState): Action | null {
  const { map } = state;
  const targets: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = idx(map, x, y);
      if (map.tiles[i] === Tile.StairsDown && state.explored[i] === 1) targets.push({ x, y });
    }
  }
  return targets.length > 0 ? bfsStep(state, targets, Infinity) : null;
}

/** まだ見ていない場所に接している既知の床を目指す */
function stepTowardFrontier(state: GameState): Action | null {
  const { map } = state;
  const targets: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = idx(map, x, y);
      if (state.explored[i] !== 1 || !isWalkable(map, x, y)) continue;
      if (hasUnknownNeighbor(state, x, y)) targets.push({ x, y });
    }
  }
  return targets.length > 0 ? bfsStep(state, targets, Infinity) : null;
}

function hasUnknownNeighbor(state: GameState, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue;
      if (state.explored[idx(state.map, nx, ny)] !== 1) return true;
    }
  }
  return false;
}

/**
 * 目的地の集合に向かう 1 歩を返す。
 * 目的地から幅優先で距離を広げ、プレイヤーの隣で最も距離の小さいマスへ動く。
 * 通れるのは「既知」かつ「歩ける」マスだけで、敵がいるマスは避ける。
 */
function bfsStep(state: GameState, targets: { x: number; y: number }[], limit: number): Action | null {
  const { map } = state;
  const dist = new Int32Array(map.width * map.height).fill(-1);
  const queue: number[] = [];

  for (const t of targets) {
    if (!isWalkable(map, t.x, t.y)) continue;
    const i = idx(map, t.x, t.y);
    if (dist[i] !== -1) continue;
    dist[i] = 0;
    queue.push(i);
  }

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const cx = i % map.width;
    const cy = Math.floor(i / map.width);
    if (dist[i] >= limit) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const ni = idx(map, nx, ny);
        if (dist[ni] !== -1) continue;
        if (state.explored[ni] !== 1) continue;
        // 角の制限は左右対称なので、目的地から遡る向きで判定してよい
        if (!canStep(map, cx, cy, dx, dy)) continue;
        dist[ni] = dist[i] + 1;
        queue.push(ni);
      }
    }
  }

  const p = state.player;
  let best: { dx: number; dy: number; d: number } | null = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const d = dist[idx(map, nx, ny)];
      if (d < 0 || d > limit) continue;
      if (!canStep(map, p.x, p.y, dx, dy)) continue;
      if (state.monsters.some((m) => m.x === nx && m.y === ny)) continue;
      if (!best || d < best.d) best = { dx, dy, d };
    }
  }
  return best ? { type: 'move', dx: best.dx, dy: best.dy } : null;
}

/** 詰まったときの逃げ道。歩ける隣を 1 つ選ぶ */
function randomStep(state: GameState): Action {
  const p = state.player;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (canStep(state.map, p.x, p.y, dx, dy)) return { type: 'move', dx, dy };
    }
  }
  return { type: 'wait' };
}
