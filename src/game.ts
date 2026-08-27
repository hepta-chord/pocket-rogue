import {
  MONSTERS,
  SLIME_CAP,
  actorName,
  createMonster,
  createPlayer,
  hasPassive,
  spawnMonsters,
  type ActionKind,
  type Actor,
  type ActorKind,
  type MonsterDef,
  type MonsterKind,
} from './entity';
import { MONSTER_ROLL_FLOOR, PLAYER_ROLL_FLOOR, applyDefense, strike } from './combat';
import { computeFov } from './fov';
import {
  CRIT_CHANCE,
  armorDefense,
  armorEvasion,
  armorHas,
  equipDef,
  equipName,
  equipSummary,
  weaponAccuracy,
  type EquipSlot,
  weaponAtk,
  weaponHas,
  type Equipped,
} from './equip';
import {
  CONSUMABLES,
  DROP_CHANCE,
  STACK_MAX,
  emptyInventory,
  isEquip,
  itemLabel,
  makeEquipItem,
  pickDropEquip,
  spawnItems,
  type ConsumableKind,
  type Inventory,
  type Item,
} from './items';
import { Tile, canStep, generateMap, idx, inBounds, isWalkable, roomCenter, tileAt, type GameMap } from './map';
import { Rng, hashSeed } from './rng';
import type { CellKind, Health, LogEntry, LogKind, ViewActor, ViewCell, ViewItem, ViewModel } from './view';

export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' }
  | { type: 'use'; item: ConsumableKind }
  /** 確認プロンプトへの回答 */
  | { type: 'confirm' }
  | { type: 'cancel' };

/**
 * 確認待ちの状態。
 *
 * 汎用の器を 1 つだけ持ち、階段と装備の両方から使う。
 * 確認が出ている間はゲームが止まり、confirm と cancel 以外の手を受け付けない。
 */
export type Prompt =
  | { kind: 'descend' }
  /** 拾った装備を身に着けるか。断ると床に戻る */
  | { kind: 'equip'; item: Item };

export interface StepResult {
  /** ターンが進んだか。壁にぶつかった・持っていないアイテムを使おうとした、なら false */
  acted: boolean;
  /** アイテムを拾ったなど、連続移動を止めるべき出来事があったか */
  interrupt: boolean;
}

export const SAVE_VERSION = 9;

/**
 * 次のレベルまでに必要な経験値。
 *
 * 線形だと、敵の経験値が階ごとに跳ね上がるのに追いつけない。
 * 深層では 2 体倒すたびにレベルが上がり、レベルアップの全回復と噛み合って
 * 下降圧を足す仕様がすべて無効化される。
 *
 * 三角数で伸ばして、どの階でも 4〜5 体で 1 レベルに収まるようにしている。
 * 定数は敵の経験値表と対で決まるので、敵を 15 種に入れ替えたあと計測して合わせ直す。
 */
export function xpToNext(level: number): number {
  return 6 + (level * (level + 1)) / 2;
}

/** 階に到達したときのスコア */
function depthScore(depth: number): number {
  return depth * 20;
}

export interface GameState {
  version: typeof SAVE_VERSION;
  seed: string;
  rngState: number;
  depth: number;
  turn: number;
  nextId: number;
  kills: number;
  level: number;
  /** 今のレベルの中で貯めた経験値 */
  xp: number;
  score: number;
  /** ハイスコアに記録済みか。リロードで二重に記録しないための印 */
  recorded: boolean;
  map: GameMap;
  player: Actor;
  monsters: Actor[];
  /** 床に落ちているアイテム */
  items: Item[];
  /** 持っている消耗品の数 */
  inventory: Inventory;
  /** 確認待ち。null なら通常の操作を受け付ける */
  prompt: Prompt | null;
  /** 身に着けている装備。持っていなければ null */
  weapon: Equipped | null;
  armor: Equipped | null;
  /** 0/1。今見えている位置 */
  visible: number[];
  /** 0/1。一度でも見た位置 */
  explored: number[];
  log: LogEntry[];
  over: boolean;
}

const MAP_W = 40;
const MAP_H = 30;
const FOV_RADIUS = 7;
const LOG_MAX = 30;
/** 階を降りたときの回復量。自然回復は無いので、回復手段はこれと回復薬とレベルアップだけ */
const DESCEND_HEAL = 5;
/** レベルアップで増える最大 HP (実 HP も同じだけ増える) */
const LEVEL_HP = 3;

export function newGame(seed: string): GameState {
  const rng = new Rng(hashSeed(seed));
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    depth: 0,
    turn: 0,
    nextId: 1,
    kills: 0,
    level: 1,
    xp: 0,
    score: 0,
    recorded: false,
    map: { width: 0, height: 0, tiles: [], rooms: [] },
    player: createPlayer(0, 0),
    monsters: [],
    items: [],
    inventory: emptyInventory(),
    prompt: null,
    weapon: null,
    armor: null,
    visible: [],
    explored: [],
    log: [],
    over: false,
  };
  pushLog(state, 'info', `seed ${seed} のダンジョンに入った。`);
  descend(state, rng);
  state.rngState = rng.state;
  return state;
}

/** 1 ターン進める */
export function step(state: GameState, action: Action): StepResult {
  const none: StepResult = { acted: false, interrupt: false };
  if (state.over) return none;
  const rng = new Rng(state.rngState);
  const p = state.player;
  let interrupt = false;

  if (state.prompt) {
    const result = answerPrompt(state, rng, action);
    state.rngState = rng.state;
    return result;
  }
  if (action.type === 'confirm' || action.type === 'cancel') return none;

  if (action.type === 'move') {
    const nx = p.x + action.dx;
    const ny = p.y + action.dy;
    const target = monsterAt(state, nx, ny);
    if (target) {
      playerAttack(state, rng, target);
    } else if (canStep(state.map, p.x, p.y, action.dx, action.dy)) {
      p.x = nx;
      p.y = ny;
      interrupt = pickUp(state);
    } else {
      state.rngState = rng.state;
      return none;
    }
  } else if (action.type === 'use') {
    if (state.inventory[action.item] <= 0) return none;
    state.inventory[action.item]--;
    useItem(state, rng, action.item);
    interrupt = true;
  }

  endTurn(state, rng, { enemies: true });

  // 階段は乗った瞬間ではなく、確認を挟んでから降りる。
  // 長押しの連続移動で踏んだときに問答無用で降りてしまうのを防ぐ。
  if (!state.over && !state.prompt && tileAt(state.map, p.x, p.y) === Tile.StairsDown) {
    state.prompt = { kind: 'descend' };
    interrupt = true;
  }

  state.rngState = rng.state;
  return { acted: true, interrupt };
}

/**
 * 確認待ちの回答を処理する。
 * 取り消しはターンを消費しない。
 */
function answerPrompt(state: GameState, rng: Rng, action: Action): StepResult {
  const prompt = state.prompt;
  if (!prompt) return { acted: false, interrupt: false };

  if (action.type === 'cancel') {
    // 装備は床から取り上げてあるので、断られたら足元に戻す
    if (prompt.kind === 'equip') {
      state.items.push({ ...prompt.item, x: state.player.x, y: state.player.y, declined: true });
      pushLog(state, 'info', `${itemLabel(prompt.item)} は置いていった。`);
    }
    state.prompt = null;
    return { acted: false, interrupt: true };
  }
  if (action.type !== 'confirm') return { acted: false, interrupt: false };

  state.prompt = null;
  switch (prompt.kind) {
    case 'descend':
      descend(state, rng);
      // 降りる瞬間は敵に行動させない。階段への直行を逃走手段として残すための非対称である
      endTurn(state, rng, { enemies: false });
      return { acted: true, interrupt: true };

    case 'equip':
      equipItem(state, prompt.item);
      // 持ち替えは足元での作業なので、ターンは消費させない
      return { acted: false, interrupt: true };
  }
}

/**
 * 装備を身に着ける。今の装備はその場に落とす。
 *
 * 捨てるのではなく落とすことで、腐食した装備を拾い直すかどうかも判断として残る。
 */
function equipItem(state: GameState, item: Item): void {
  if (!item.equip) return;
  const slot = equipDef(item.equip).slot;
  const current = slot === 'weapon' ? state.weapon : state.armor;
  const next: Equipped = { id: item.equip, power: item.power };

  if (current) {
    // 外したものは足元に落とす。捨てるのではないので拾い直せる。
    // 今それを選ばなかったのだから、印を付けて通行の邪魔にならないようにする
    state.items.push({
      kind: slot,
      x: state.player.x,
      y: state.player.y,
      power: current.power,
      equip: current.id,
      declined: true,
    });
  }
  if (slot === 'weapon') state.weapon = next;
  else state.armor = next;
  clearDeclined(state, slot);
  pushLog(state, 'info', `${equipName(next)} を装備した。`);
}

/**
 * その部位の「断った」印を外す。
 * 装備が変わると比べる相手が変わるので、床のものをもう一度選べるようにする。
 * 腐食で装備が弱ったときも、ここを通して選び直せるようにする。
 */
function clearDeclined(state: GameState, slot: EquipSlot): void {
  for (const it of state.items) {
    if (it.kind === slot && it.declined) delete it.declined;
  }
}

/** 確認の文面。描画層は文字を組み立てず、これをそのまま出す */
export function promptText(state: GameState): { text: string; confirm: string; cancel: string } | null {
  const prompt = state.prompt;
  if (!prompt) return null;
  switch (prompt.kind) {
    case 'descend':
      return { text: `B${state.depth + 1} に降りますか。`, confirm: '降りる', cancel: 'やめる' };

    case 'equip': {
      const item = prompt.item;
      if (!item.equip) return null;
      const slot = equipDef(item.equip).slot;
      const current = slot === 'weapon' ? state.weapon : state.armor;
      const found: Equipped = { id: item.equip, power: item.power };
      return {
        text: `${equipSummary(found, slot)}
今: ${equipSummary(current, slot)}`,
        confirm: '持ち替える',
        cancel: '置いていく',
      };
    }
  }
}

/**
 * ターンの終わりに必ず通る処理。
 *
 * 経路が階段と通常の 2 つに割れていると、片方だけ処理が漏れる。
 * これから足すスタミナの消費、スタミナがある間の自然回復、フロア内ターン数、
 * 追加の湧き、追跡者の出現判定は、すべてここに乗せる。
 */
function endTurn(state: GameState, rng: Rng, opts: { enemies: boolean }): void {
  if (opts.enemies) monstersAct(state, rng);
  state.turn++;
  updateFov(state);

  const p = state.player;
  if (p.hp <= 0) {
    p.hp = 0;
    state.over = true;
    pushLog(state, 'alert', `あなたは倒れた。B${state.depth} で ${state.kills} 体を倒した。`);
  }
}

/** 今プレイヤーの視界にいる敵。連続移動の停止判定と雷の巻物に使う */
export function visibleMonsters(state: GameState): Actor[] {
  return state.monsters.filter((m) => state.visible[idx(state.map, m.x, m.y)] === 1);
}

function descend(state: GameState, rng: Rng): void {
  state.depth++;
  state.map = generateMap(rng, MAP_W, MAP_H);
  const start = roomCenter(state.map.rooms[0]);
  const p = state.player;
  p.x = start.x;
  p.y = start.y;

  // 階層そのものでは強くならない。伸びるのは経験値だけで、降りたときは少し回復する
  if (state.depth > 1) p.hp = Math.min(p.maxHp, p.hp + DESCEND_HEAL);
  state.score += depthScore(state.depth);

  state.monsters = spawnMonsters(rng, state.map, state.depth, start, () => state.nextId++);
  state.items = spawnItems(rng, state.map, state.depth, start, state.monsters);
  state.visible = new Array<number>(MAP_W * MAP_H).fill(0);
  state.explored = new Array<number>(MAP_W * MAP_H).fill(0);
  updateFov(state);
  pushLog(state, 'info', state.depth === 1 ? 'B1。> を探して下に降りよう。' : `B${state.depth} に降りた。少し回復した。`);
}

// ---------------------------------------------------------------------------
// アイテム

/** 足元のアイテムを拾う。何か起きたら true */
function pickUp(state: GameState): boolean {
  const p = state.player;
  const i = state.items.findIndex((it) => it.x === p.x && it.y === p.y);
  if (i < 0) return false;
  const item = state.items[i];
  const name = itemLabel(item);

  // 装備は自動で持ち替えない。拾った時点で選ばせる。
  // 床から取り上げておき、断られたら戻す
  if (isEquip(item.kind)) {
    // 一度断ったものは、通るたびに確認を出さない
    if (item.declined) return false;
    state.items.splice(i, 1);
    state.prompt = { kind: 'equip', item };
    return true;
  }

  const kind = item.kind;
  if (state.inventory[kind] >= STACK_MAX) {
    pushLog(state, 'info', `${name} はもう持てない (${STACK_MAX} 個まで)。`);
    return true;
  }
  state.inventory[kind]++;
  state.items.splice(i, 1);
  pushLog(state, 'info', `${name} を拾った (${state.inventory[kind]})。`);
  return true;
}

function useItem(state: GameState, rng: Rng, kind: ConsumableKind): void {
  const p = state.player;
  switch (kind) {
    case 'potion': {
      const heal = Math.min(p.maxHp - p.hp, Math.max(8, Math.floor(p.maxHp / 2)));
      p.hp += heal;
      pushLog(state, 'player', `回復薬を飲んだ。HP が ${heal} 回復した。`);
      return;
    }
    case 'thunder': {
      const targets = visibleMonsters(state);
      if (targets.length === 0) {
        pushLog(state, 'player', '雷の巻物を読んだが、周りに敵はいなかった。');
        return;
      }
      const dmg = 6 + state.depth * 2;
      for (const m of targets) m.hp -= dmg;
      const dead = targets.filter((m) => m.hp <= 0);
      state.monsters = state.monsters.filter((m) => m.hp > 0);
      const tail = dead.length > 0 ? `${dead.length} 体を倒した。` : '';
      pushLog(state, 'player', `雷が ${targets.length} 体に ${dmg} のダメージ。${tail}`);
      for (const m of dead) {
        rewardKill(state, m);
        dropEquip(state, rng, m);
      }
      return;
    }
    case 'map': {
      revealMap(state);
      pushLog(state, 'player', '地図の巻物を読んだ。この階の地形が頭に浮かんだ。');
      return;
    }
  }
}

/** 床と、床に隣接する壁を既知にする (壁だけの領域は塗らない) */
function revealMap(state: GameState): void {
  const { map } = state;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[idx(map, x, y)] !== Tile.Wall) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (inBounds(map, x + dx, y + dy)) state.explored[idx(map, x + dx, y + dy)] = 1;
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 戦闘

/**
 * ダメージが 1 回通るたびに呼ばれる計測用の通知。
 * バランス調整の自動プレイ (src/sim) だけが使う。
 *
 * GameState に持たせるとセーブに載って形式が変わるので、モジュール変数に置いている。
 * 本編では誰も登録しないので、常に null のまま何も起きない。
 */
export interface DamageEvent {
  /** 誰が受けたか */
  to: 'player' | 'monster';
  depth: number;
  /** 攻撃した側 */
  from: ActorKind;
  /** 軽減する前の出目 */
  roll: number;
  /** 実際に通ったダメージ */
  dealt: number;
}

let damageObserver: ((e: DamageEvent) => void) | null = null;

export function setDamageObserver(fn: ((e: DamageEvent) => void) | null): void {
  damageObserver = fn;
}

function notifyDamage(e: DamageEvent): void {
  damageObserver?.(e);
}

/**
 * プレイヤーの攻撃。
 * 武器の特殊効果はここで分岐する。
 */
function playerAttack(state: GameState, rng: Rng, target: Actor): void {
  const w = state.weapon;

  // 群れ薙ぎ: 隣接する敵すべてに当たる。数で押してくる相手に効く
  const targets = weaponHas(w, 'cleave') ? adjacentMonsters(state) : [target];
  // 双牙: 2 回攻撃する
  const swings = weaponHas(w, 'double') ? 2 : 1;

  for (let i = 0; i < swings; i++) {
    for (const m of targets) {
      if (!state.monsters.includes(m)) continue;
      strikeMonster(state, rng, m);
    }
  }
}

/** プレイヤーから 1 体への 1 回ぶん */
function strikeMonster(state: GameState, rng: Rng, target: Actor): void {
  const p = state.player;
  const w = state.weapon;
  const name = actorName(target.kind);

  if (!rollHit(rng, weaponAccuracy(w), target.evasion, weaponHas(w, 'sureHit'))) {
    pushLog(state, 'player', `${name}に攻撃を外した。`);
    return;
  }

  // 鎧通しは常に、会心の刃は確率で防御力を無視する
  const crit = weaponHas(w, 'crit') && rng.chance(CRIT_CHANCE);
  const pierce = weaponHas(w, 'pierce') || crit;
  const hit = strike(rng, p.atk + weaponAtk(w), target.def, PLAYER_ROLL_FLOOR, pierce);

  target.hp -= hit.dealt;
  notifyDamage({ to: 'monster', depth: state.depth, from: 'player', roll: hit.roll, dealt: hit.dealt });
  // 残り HP を出す。何発で倒せるかが読めないと、効いている感覚が出ない
  const rest = target.hp > 0 ? ` (残り ${target.hp})` : '';
  const head = crit ? '会心の一撃! ' : '';
  pushLog(state, 'player', `${head}${name}に ${hit.dealt} のダメージ${rest}。`);

  if (target.hp <= 0) {
    killMonster(state, rng, target);
    return;
  }
  // 祓いの杖は分裂を止める
  if (hasPassive(target.kind, 'split') && !weaponHas(state.weapon, 'ward')) {
    trySplit(state, rng, target);
  }
}

/**
 * 当たったかどうか。
 * 命中率と回避率は掛け算になるので、どちらも極端な値を置かないようにしてある。
 */
function rollHit(rng: Rng, accuracy: number, evasion: number, sureHit: boolean): boolean {
  if (sureHit) return true;
  return rng.chance(accuracy * (1 - evasion));
}

/** プレイヤーに隣接している敵。群れ薙ぎで使う */
function adjacentMonsters(state: GameState): Actor[] {
  const p = state.player;
  return state.monsters.filter((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1);
}

function killMonster(state: GameState, rng: Rng, m: Actor): void {
  state.monsters = state.monsters.filter((x) => x.id !== m.id);
  pushLog(state, 'player', `${actorName(m.kind)}を倒した。`);
  rewardKill(state, m);
  dropEquip(state, rng, m);
}

/**
 * 倒した敵が装備を落とす。
 * その系統に効く装備をその系統が落とすので、狩る対象が分散し、
 * 戦うか避けるかの判断に装備の期待値が乗る。
 */
function dropEquip(state: GameState, rng: Rng, m: Actor): void {
  const family = MONSTERS[m.kind as MonsterKind].family;
  if (!rng.chance(DROP_CHANCE)) return;
  if (state.items.some((it) => it.x === m.x && it.y === m.y)) return;
  const id = pickDropEquip(rng, family);
  if (!id) return;
  const item = makeEquipItem(rng, id, state.depth, m.x, m.y);
  state.items.push(item);
  pushLog(state, 'info', `${itemLabel(item)} を落とした。`);
}

/** 撃破数・スコア・経験値をまとめて加算する。雷で倒したときもここを通す */
function rewardKill(state: GameState, m: Actor): void {
  state.kills++;
  const def = MONSTERS[m.kind as MonsterKind];
  state.score += def.xp;
  gainXp(state, def.xp);
}

/**
 * 経験値を加算し、足りていればレベルを上げる。
 *
 * レベルアップで HP が全快する。回復手段が乏しいぶんの埋め合わせであり、
 * 「瀕死のまま踏み込んで全回復を取りにいくか」を判断にするための仕掛けでもある。
 *
 * 攻撃力はレベルでは伸びない。武器で決まる。
 * レベルと装備の両方で伸ばすと、深層で攻撃力だけが青天井になって難易度が頭打ちになる。
 */
function gainXp(state: GameState, amount: number): void {
  const p = state.player;
  state.xp += amount;
  while (state.xp >= xpToNext(state.level)) {
    state.xp -= xpToNext(state.level);
    state.level++;
    p.maxHp += LEVEL_HP;
    p.hp = p.maxHp;
    pushLog(state, 'player', `レベル ${state.level} になった。最大 HP が上がり、全快した。`);
  }
}

/**
 * 敵からプレイヤーへの攻撃。
 * 防具は被ダメージを減らすが、出目の 1/4 は必ず通る (防具で被弾が 1 に潰れるのを防ぐ)。
 * pierce のときは防具を無視する。
 */
function monsterAttack(state: GameState, rng: Rng, m: Actor, opts: { pierce?: boolean; label?: string } = {}): void {
  const p = state.player;
  const a = state.armor;
  const name = actorName(m.kind);

  // 防具の回避。敵の命中率は持たせていないので、回避率がそのまま外れる確率になる
  if (rng.chance(armorEvasion(a))) {
    pushLog(state, 'enemy', `${name}の攻撃をかわした。`);
    return;
  }

  const hit = strike(rng, m.atk, p.def + armorDefense(a), MONSTER_ROLL_FLOOR, opts.pierce);
  const reduced = hit.roll - hit.dealt;
  p.hp -= hit.dealt;
  notifyDamage({ to: 'player', depth: state.depth, from: m.kind, roll: hit.roll, dealt: hit.dealt });
  const head = opts.label ?? `${name}から`;
  const note = reduced > 0 ? ` (防具で ${reduced} 軽減)` : '';
  pushLog(state, 'enemy', `${head} ${hit.dealt} のダメージ。${note}`);

  // 棘鎧の反撃。高 HP で殴り合いになる重装に効く
  if (armorHas(a, 'thorns') && p.hp > 0) thornsCounter(state, rng, m);
}

/** 反撃。受けたぶんではなく、防具の値に応じた固定の削りを返す */
function thornsCounter(state: GameState, rng: Rng, m: Actor): void {
  const back = Math.max(1, Math.ceil(armorDefense(state.armor) / 2));
  m.hp -= back;
  notifyDamage({ to: 'monster', depth: state.depth, from: 'player', roll: back, dealt: back });
  pushLog(state, 'player', `棘が ${actorName(m.kind)}に ${back} 返した。`);
  if (m.hp <= 0) killMonster(state, rng, m);
}

/** 分裂: 隣の空きマスに HP 半分の個体を置く。上限あり */
function trySplit(state: GameState, rng: Rng, m: Actor): void {
  const slimes = state.monsters.filter((x) => x.kind === 'slime').length;
  if (slimes >= SLIME_CAP) return;
  const half = Math.floor(m.hp / 2);
  if (half < 1) return;
  const spot = freeNeighbor(state, m.x, m.y, rng, false);
  if (!spot) return;
  m.hp -= half;
  const child: Actor = {
    id: state.nextId++,
    kind: m.kind,
    x: spot.x,
    y: spot.y,
    hp: half,
    maxHp: half,
    atk: m.atk,
    def: m.def,
    evasion: m.evasion,
  };
  state.monsters.push(child);
  pushLog(state, 'enemy', `${actorName(m.kind)}が分裂した。`);
}

// ---------------------------------------------------------------------------
// 敵の行動

function monstersAct(state: GameState, rng: Rng): void {
  const p = state.player;
  for (const m of [...state.monsters]) {
    if (p.hp <= 0) return;
    if (!state.monsters.includes(m)) continue;
    const def = MONSTERS[m.kind as MonsterKind];

    if (def.passives.includes('regen') && m.hp < m.maxHp) m.hp++;
    // 鈍重: id とターンの偶奇で手番を半分にする (個体ごとにずれるので一斉には止まらない)
    if (def.passives.includes('slow') && (state.turn + m.id) % 2 === 1) continue;

    const actions = def.passives.includes('fast') ? 2 : 1;
    for (let i = 0; i < actions; i++) {
      // 攻撃や技を使ったらこのターンは終わり (俊敏でも攻撃は 1 回)
      if (monsterTurn(state, rng, m, def)) break;
      if (p.hp <= 0) break;
    }
  }
}

/** 1 回分の行動。攻撃か技を使ったら true、移動だけなら false */
function monsterTurn(state: GameState, rng: Rng, m: Actor, def: MonsterDef): boolean {
  const p = state.player;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  const sees = state.visible[idx(state.map, m.x, m.y)] === 1;

  if (def.action && rng.chance(def.action.chance) && tryAction(state, rng, m, def.action.kind, dist, sees)) {
    return true;
  }

  if (dist === 1) {
    monsterAttack(state, rng, m);
    return true;
  }

  if (sees) {
    // プレイヤーから見えている = 向こうからも見えているとみなして追ってくる
    let sx = Math.sign(dx);
    let sy = Math.sign(dy);
    if (def.passives.includes('erratic') && rng.chance(0.5)) {
      sx = rng.int(-1, 1);
      sy = rng.int(-1, 1);
    }
    moveToward(state, m, sx, sy);
  } else if (rng.chance(0.25)) {
    moveToward(state, m, rng.int(-1, 1), rng.int(-1, 1));
  }
  return false;
}

/** 技を試す。条件が合わなければ false を返して通常行動に戻る */
function tryAction(state: GameState, rng: Rng, m: Actor, kind: ActionKind, dist: number, sees: boolean): boolean {
  const p = state.player;
  const name = actorName(m.kind);
  switch (kind) {
    case 'doubleAttack':
      if (dist !== 1) return false;
      pushLog(state, 'enemy', `${name}が続けて切りつけた。`);
      monsterAttack(state, rng, m);
      if (p.hp > 0) monsterAttack(state, rng, m);
      return true;

    case 'smash':
      if (dist !== 1) return false;
      monsterAttack(state, rng, m, { pierce: true, label: `${name}の強打!` });
      return true;

    case 'leap': {
      if (dist !== 2 || !sees) return false;
      const spot = freeNeighbor(state, p.x, p.y, rng, hasPassive(m.kind, 'phasing'), m);
      if (!spot) return false;
      m.x = spot.x;
      m.y = spot.y;
      pushLog(state, 'enemy', `${name}が跳びかかった。`);
      monsterAttack(state, rng, m);
      return true;
    }

    case 'breath': {
      if (!sees || dist < 2 || dist > 4) return false;
      const roll = Math.floor(m.atk / 2) + state.depth;
      const dmg = applyDefense(roll, p.def + armorDefense(state.armor));
      p.hp -= dmg;
      notifyDamage({ to: 'player', depth: state.depth, from: m.kind, roll, dealt: dmg });
      const note = roll - dmg > 0 ? ` (防具で ${roll - dmg} 軽減)` : '';
      pushLog(state, 'enemy', `${name}が炎を吐いた。${dmg} のダメージ。${note}`);
      return true;
    }
  }
}

function moveToward(state: GameState, m: Actor, sx: number, sy: number): void {
  const phasing = hasPassive(m.kind, 'phasing');
  const candidates = [
    [sx, sy],
    [sx, 0],
    [0, sy],
  ];
  for (const [cx, cy] of candidates) {
    if (cx === 0 && cy === 0) continue;
    const nx = m.x + cx;
    const ny = m.y + cy;
    // 角の制限は敵にもかける。かけないと通路で敵だけが有利になり、逃げる選択肢が消える。
    // 壁抜けだけは例外にする。壁の中を通れる相手に角の制限をかけると、その性質が意味を失う
    if (!(phasing ? canEnter(state, nx, ny, true) : canStep(state.map, m.x, m.y, cx, cy))) continue;
    if (occupied(state, nx, ny)) continue;
    m.x = nx;
    m.y = ny;
    return;
  }
}

/** 壁抜けなら盤面内ならどこでも、そうでなければ床だけ */
function canEnter(state: GameState, x: number, y: number, phasing: boolean): boolean {
  return phasing ? inBounds(state.map, x, y) : isWalkable(state.map, x, y);
}

/**
 * (x, y) の周囲 8 マスから入れる空きマスを 1 つ選ぶ。mover が近い順に試す。
 * 跳びかかりと分裂で使う。技と分裂は通常の移動ではないので、角の制限はかけない。
 */
function freeNeighbor(
  state: GameState,
  x: number,
  y: number,
  rng: Rng,
  phasing: boolean,
  mover?: Actor,
): { x: number; y: number } | null {
  const spots: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!canEnter(state, nx, ny, phasing)) continue;
      if (occupied(state, nx, ny)) continue;
      spots.push({ x: nx, y: ny });
    }
  }
  if (spots.length === 0) return null;
  if (mover) {
    spots.sort((a, b) => Math.hypot(a.x - mover.x, a.y - mover.y) - Math.hypot(b.x - mover.x, b.y - mover.y));
    return spots[0];
  }
  return rng.pick(spots);
}

function monsterAt(state: GameState, x: number, y: number): Actor | undefined {
  return state.monsters.find((m) => m.x === x && m.y === y);
}

function occupied(state: GameState, x: number, y: number): boolean {
  const p = state.player;
  if (p.x === x && p.y === y) return true;
  return monsterAt(state, x, y) !== undefined;
}

// ---------------------------------------------------------------------------

function updateFov(state: GameState): void {
  computeFov(state.map, state.player.x, state.player.y, FOV_RADIUS, state.visible);
  for (let i = 0; i < state.visible.length; i++) {
    if (state.visible[i] === 1) state.explored[i] = 1;
  }
}

/** 外から 1 行足す (セーブを捨てた通知など、ゲームの外で起きたことを伝える) */
export function addLog(state: GameState, kind: LogKind, text: string): void {
  pushLog(state, kind, text);
}

function pushLog(state: GameState, kind: LogKind, text: string): void {
  state.log.push({ kind, text, turn: state.turn });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
}

/** HP の帯。半分より上は無傷扱い、1/4 以下を瀕死とする */
function healthOf(a: Actor): Health {
  if (a.hp > a.maxHp / 2) return 'healthy';
  if (a.hp > a.maxHp / 4) return 'hurt';
  return 'critical';
}

const CELL_KIND: Record<Tile, CellKind> = {
  [Tile.Wall]: 'wall',
  [Tile.Floor]: 'floor',
  [Tile.StairsDown]: 'stairs',
};

/** 描画層に渡す、見た目を含まないデータに変換する */
export function toViewModel(state: GameState): ViewModel {
  const { map } = state;
  const cells: ViewCell[] = new Array(map.tiles.length);
  for (let i = 0; i < map.tiles.length; i++) {
    if (state.explored[i] !== 1) {
      cells[i] = { kind: 'unknown', vis: 'unknown' };
    } else {
      cells[i] = { kind: CELL_KIND[map.tiles[i]], vis: state.visible[i] === 1 ? 'visible' : 'remembered' };
    }
  }

  // アイテムは一度見た場所のものを覚えておく (見えていなくても表示する)
  const items: ViewItem[] = state.items
    .filter((it) => state.explored[idx(map, it.x, it.y)] === 1)
    .map((it) => ({ kind: it.kind, x: it.x, y: it.y }));

  const actors: ViewActor[] = visibleMonsters(state).map((m) => ({
    kind: m.kind,
    x: m.x,
    y: m.y,
    health: healthOf(m),
  }));
  const p = state.player;
  actors.push({ kind: 'player', x: p.x, y: p.y, health: healthOf(p) });

  return {
    width: map.width,
    height: map.height,
    cells,
    items,
    actors,
    player: {
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp,
      atk: p.atk + weaponAtk(state.weapon),
      def: p.def + armorDefense(state.armor),
      weapon: state.weapon ? equipName(state.weapon) : null,
      armor: state.armor ? equipName(state.armor) : null,
      level: state.level,
      xp: state.xp,
      xpNext: xpToNext(state.level),
    },
    inventory: CONSUMABLES.map((kind) => ({ kind, count: state.inventory[kind] })),
    depth: state.depth,
    turn: state.turn,
    kills: state.kills,
    score: state.score,
    seed: state.seed,
    log: state.log,
    prompt: promptText(state),
    gameOver: state.over,
  };
}

// createMonster は分裂以外でも使えるように再エクスポートしておく (テストや将来の召喚用)
export { createMonster };
