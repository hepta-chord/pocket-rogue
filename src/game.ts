import { chooseStep, distanceField } from './ai';
import {
  BOSS,
  MONSTERS,
  SLIME_CAP,
  SPLIT_REWARD,
  STALKER,
  actorName,
  bountyFor,
  createMonster,
  createPlayer,
  hasPassive,
  placeMonster,
  spawnMonsters,
  spawnOne,
  xpFor,
  type ActionKind,
  type Actor,
  type ActorKind,
  type MonsterDef,
  type MonsterKind,
} from './entity';
import { MONSTER_ROLL_FLOOR, PLAYER_ROLL_FLOOR, applyDefense, strike } from './combat';
import { FLOORS, rollEffect, spawnFloors, type FloorEffect, type FloorTile, type Magnitude } from './floors';
import { computeFov } from './fov';
import {
  CRIT_CHANCE,
  armorDefense,
  armorEvasion,
  armorHas,
  equipDef,
  equipDetail,
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
  ITEM_NAMES,
  stackLimit,
  emptyInventory,
  isEquip,
  isTreasure,
  itemLabel,
  makeEquipItem,
  makeTreasure,
  pickDropEquip,
  pickFloorEquip,
  spawnItems,
  type ConsumableKind,
  type Inventory,
  type Item,
} from './items';
import {
  Tile,
  canReach,
  canStep,
  deadEndRooms,
  generateMap,
  idx,
  inBounds,
  isWalkable,
  randomFloorTile,
  tileAt,
  type GameMap,
  type MapKind,
  type Room,
} from './map';
import { Rng, hashSeed } from './rng';
import type {
  CellKind,
  Health,
  LogEntry,
  LogKind,
  ViewActor,
  ViewCell,
  ViewItem,
  ViewModel,
  ViewSlot,
} from './view';

export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' }
  | { type: 'use'; item: ConsumableKind }
  | { type: 'cast'; spell: SpellKind }
  /** 確認プロンプトへの回答 */
  | { type: 'confirm' }
  | { type: 'cancel' };

/** 残りターン数で切れる効果 */
export type TimedEffect = 'haste' | 'slow' | 'poison';

/** 毒が 1 ターンに与えるダメージ */
const POISON_DAMAGE = 1;
/** 毒を受けたときに乗る残りターン数 */
const POISON_TURNS = 8;
/**
 * 毒の残りターン数の上限。
 * 毒ネズミは 2〜4 匹の群れで出るので、上限が無いと 1 ターンに何度も重なって
 * 避けようのない死因になる。
 */
const POISON_MAX_TURNS = 12;

/** フロア内でこのターン数ごとに 1 体湧く */
export const SPAWN_INTERVAL = 25;
/** 湧いた個体の経験値とドロップ率の倍率。0 にはせず、倒す価値は残す */
const SPAWN_REWARD = 0.5;
// 1 階の滞在は普通に探索しても 100〜120 ターンほどなので、その倍を超えたあたりから圧をかける
/** 追う者の予告が出るフロア内ターン数 */
export const STALKER_WARN = 200;
/** 追う者が現れるフロア内ターン数 */
export const STALKER_TURN = 250;

/** 魔法。コストはスタミナで払う */
export type SpellKind = 'thunder';

export const SPELLS: Record<SpellKind, { name: string; cost: number }> = {
  thunder: { name: '雷', cost: 15 },
};

export const SPELL_KINDS = Object.keys(SPELLS) as SpellKind[];

/**
 * 確認待ちの状態。
 *
 * 汎用の器を 1 つだけ持ち、階段と装備の両方から使う。
 * 確認が出ている間はゲームが止まり、confirm と cancel 以外の手を受け付けない。
 */
export type Prompt =
  | { kind: 'descend' }
  /** 脱出階段。上ると冒険が終わる */
  | { kind: 'escape' }
  /** 拾った装備を身に着けるか。断ると床に戻る */
  | { kind: 'equip'; item: Item };

export interface StepResult {
  /** ターンが進んだか。壁にぶつかった・持っていないアイテムを使おうとした、なら false */
  acted: boolean;
  /** アイテムを拾ったなど、連続移動を止めるべき出来事があったか */
  interrupt: boolean;
}

export const SAVE_VERSION = 14;

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
  /** 踏むと効果が出る床。踏んだら消える */
  floors: FloorTile[];
  /** 残りターン数つきの効果。0 になったら切れる */
  effects: Partial<Record<TimedEffect, number>>;
  /** 今の階に入ってからのターン数。追加の湧きと追う者はこれを見る */
  floorTurn: number;
  /** 追う者を呼んだか。1 階に 1 度だけ */
  stalkerCalled: boolean;
  /** 視界が狭い階 */
  dark: boolean;
  /** モンスターハウスのある部屋の添字。無ければ -1 */
  houseRoom: number;
  /** ハウスがまだ起動していないか */
  houseArmed: boolean;
  /** 脱出して終わったか */
  cleared: boolean;
  /** 持っている消耗品の数 */
  inventory: Inventory;
  /** 確認待ち。null なら通常の操作を受け付ける */
  prompt: Prompt | null;
  /** スタミナ。行動と被弾で減り、尽きると HP が削れる */
  stamina: number;
  staminaMax: number;
  /** スタミナを減らすまでの残りターン数 */
  staminaTick: number;
  /** 自然回復までの残りターン数 */
  regenTick: number;
  /** 被弾でスタミナが減るまでの残り回数 */
  hitTick: number;
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

const MAP_W = 32;
const MAP_H = 24;
const FOV_RADIUS = 7;
/** 暗い階の視界。数マス先しか見えない */
const DARK_FOV_RADIUS = 3;
const LOG_MAX = 30;
/** レベルアップで増える最大 HP */
const LEVEL_HP = 3;

/** ボスが出る階の間隔 */
const BOSS_SPAN = 10;
/** 倒すと脱出できる階の間隔 */
const CLEAR_SPAN = 30;
/** 脱出したときの加点 */
const CLEAR_BONUS = 1000;

/** スタミナの初期最大値。イベント床で増減する */
const STAMINA_MAX = 150;
/** スタミナが 1 減るまでのターン数 */
const STAMINA_DRAIN_TURNS = 7;
/**
 * 被弾でスタミナが 1 減るまでの回数。群れよけの盾を着ていると減らない。
 *
 * 1 発ごとに 1 減らすと、これがスタミナ消費の 6 割を占めてしまい
 * (1 run で 278 発、時間による消費 151 点に対して 278 点)、
 * 死因の 9 割がスタミナ切れになっていた。
 * 数発ごとに 1 減る形にして、時間による消費を主役に戻してある。
 */
const STAMINA_HITS_PER_POINT = 3;
/** スタミナがある間、HP が 1 回復するまでのターン数 */
const REGEN_TURNS = 6;
/** スタミナが尽きている間、毎ターン減る HP */
const STARVE_DAMAGE = 1;
/** スタミナ薬 1 個で戻る量。フロア 1 つ分の消費より少し多い程度に抑える */
const ELIXIR_STAMINA = 40;

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
    map: { kind: 'rooms', width: 0, height: 0, tiles: [], rooms: [], start: { x: 0, y: 0 }, links: [], stairsRoom: 0 },
    player: createPlayer(0, 0),
    monsters: [],
    items: [],
    floors: [],
    effects: {},
    floorTurn: 0,
    stalkerCalled: false,
    dark: false,
    houseRoom: -1,
    houseArmed: false,
    cleared: false,
    inventory: emptyInventory(),
    prompt: null,
    stamina: STAMINA_MAX,
    staminaMax: STAMINA_MAX,
    staminaTick: STAMINA_DRAIN_TURNS,
    regenTick: REGEN_TURNS,
    hitTick: STAMINA_HITS_PER_POINT,
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
  /** このターンに足を踏み入れたか。その場での攻撃やアイテム使用では false */
  let entered = false;

  if (state.prompt) {
    const result = answerPrompt(state, rng, action);
    state.rngState = rng.state;
    return result;
  }
  if (action.type === 'confirm' || action.type === 'cancel') return none;
  if (action.type === 'cast' && !canCast(state, action.spell)) return none;

  if (action.type === 'move') {
    const nx = p.x + action.dx;
    const ny = p.y + action.dy;
    // 壁の角越しには攻撃も移動もできない。敵にも同じ制限をかけてある
    const reaches = canReach(state.map, p.x, p.y, action.dx, action.dy);
    const target = reaches ? monsterAt(state, nx, ny) : undefined;
    if (target) {
      playerAttack(state, rng, target);
    } else if (canStep(state.map, p.x, p.y, action.dx, action.dy)) {
      p.x = nx;
      p.y = ny;
      entered = true;
      checkHouse(state);
      if (stepOnFloor(state, rng)) interrupt = true;
      if (pickUp(state)) interrupt = true;
    } else {
      state.rngState = rng.state;
      return none;
    }
  } else if (action.type === 'use') {
    if (state.inventory[action.item] <= 0) return none;
    state.inventory[action.item]--;
    useItem(state, action.item);
    interrupt = true;
  } else if (action.type === 'cast') {
    if (!canCast(state, action.spell)) return none;
    state.stamina -= SPELLS[action.spell].cost;
    castSpell(state, rng, action.spell);
    interrupt = true;
  }

  endTurn(state, rng, { enemies: true });

  // 階段は乗った瞬間ではなく、確認を挟んでから降りる。
  // 長押しの連続移動で踏んだときに問答無用で降りてしまうのを防ぐ。
  //
  // 出すのは「踏み入れたとき」と「階段の上で待ったとき」だけにする。
  // その場で戦っている間も毎ターン出ると、確認が邪魔で戦えない。
  const tile = tileAt(state.map, p.x, p.y);
  const onStairs = tile === Tile.StairsDown || tile === Tile.StairsUp;
  const asks = onStairs && (entered || action.type === 'wait');
  if (!state.over && !state.prompt && asks) {
    state.prompt = tile === Tile.StairsUp ? { kind: 'escape' } : { kind: 'descend' };
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

    case 'escape':
      escape(state);
      return { acted: true, interrupt: true };

    case 'equip':
      equipItem(state, prompt.item);
      // 持ち替えは足元での作業なので、ターンは消費させない
      return { acted: false, interrupt: true };
  }
}

/** 脱出してクリアする。run はここで終わる */
function escape(state: GameState): void {
  state.score += CLEAR_BONUS;
  state.cleared = true;
  state.over = true;
  pushLog(state, 'alert', `地上に出た。B${state.depth} まで潜り、${state.kills} 体を倒した。`);
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
  pushLog(state, 'info', `${equipName(next)} を装備した。${equipDetail(next, slot)}`);
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

    case 'escape':
      return {
        text: '地上へ脱出しますか。\nここで冒険は終わり、スコアが確定します。',
        confirm: '脱出する',
        cancel: 'まだ潜る',
      };

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
  if (opts.enemies) {
    // 高速移動の間は 2 ターンに 1 回だけ敵が動き、鈍足の間は 2 回動く
    const times = state.effects.slow ? 2 : state.effects.haste && state.turn % 2 === 1 ? 0 : 1;
    for (let i = 0; i < times; i++) monstersAct(state, rng);
  }
  state.turn++;
  state.floorTurn++;
  tickEffects(state);
  tickStamina(state);
  updateFov(state);
  tickFloorPressure(state, rng);

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
  state.map = generateMap(rng, MAP_W, MAP_H, pickMapKind(rng, state.depth));
  const start = state.map.start;
  const p = state.player;
  p.x = start.x;
  p.y = start.y;
  state.dark = state.depth >= 4 && rng.chance(0.15);

  // 階層そのものでは強くならない。伸びるのは経験値だけである。
  // 降りたときの回復はスタミナの自然回復に置き換えたので、ここでは回復しない
  state.score += depthScore(state.depth);

  state.monsters = spawnMonsters(rng, state.map, state.depth, start, () => state.nextId++);
  state.items = spawnItems(rng, state.map, state.depth, start, state.monsters);
  const stairsAt = stairsPos(state.map);
  state.floors = stairsAt
    ? spawnFloors(rng, state.map, state.depth, start, stairsAt, [...state.monsters, ...state.items])
    : [];
  state.effects = {};
  state.floorTurn = 0;
  state.stalkerCalled = false;
  placeHouse(state, rng);
  placeBoss(state, rng);
  state.visible = new Array<number>(MAP_W * MAP_H).fill(0);
  state.explored = new Array<number>(MAP_W * MAP_H).fill(0);
  updateFov(state);
  pushLog(state, 'info', state.depth === 1 ? 'B1。> を探して下に降りよう。' : `B${state.depth} に降りた。`);
  for (const note of floorNotes(state)) pushLog(state, 'alert', note);
}

/** ボスが出る階。10 階ごと */
export function isBossFloor(depth: number): boolean {
  return depth % BOSS_SPAN === 0;
}

/** 倒すと脱出できる階。30 階ごと */
export function isClearFloor(depth: number): boolean {
  return depth % CLEAR_SPAN === 0;
}

/**
 * ボスを置く。
 *
 * 下り階段は最初から出ているので、10F と 20F のボスは倒さなくてもよい。
 * 避けて降りる選択肢を残し、報酬をスコアにすることで戦う判断に見返りを与える。
 * 30 階ごとのクリア階だけは、倒さないと脱出階段が出ない。
 */
function placeBoss(state: GameState, rng: Rng): void {
  if (!isBossFloor(state.depth)) return;
  const start = state.map.start;
  const m = placeMonster(
    rng,
    state.map,
    BOSS,
    state.depth,
    state.monsters,
    () => state.nextId++,
    (x, y) => Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) >= 8,
  );
  if (m) state.monsters.push(m);
}

/**
 * 階の作りを選ぶ。
 * B1 と B2 は必ず普通の部屋にする。覚えることが多い最初の 2 階で変化球を出さない。
 */
function pickMapKind(rng: Rng, depth: number): MapKind {
  if (depth <= 2) return 'rooms';
  const roll = rng.next();
  if (roll < 0.08) return 'bigRoom';
  if (roll < 0.14) return 'maze';
  return 'rooms';
}

/** 降りた直後に出す、その階の特色 */
function floorNotes(state: GameState): string[] {
  const notes: string[] = [];
  if (state.map.kind === 'bigRoom') notes.push('大きな空洞だ。見通しはよいが、隠れる場所がない。');
  if (state.map.kind === 'maze') notes.push('入り組んだ通路が続いている。');
  if (state.dark) notes.push('暗い。数マス先しか見えない。');
  return notes;
}

/**
 * モンスターハウスを置く。
 *
 * 行き止まりの部屋にだけ置く。
 * 階段までの経路上に出ると迂回できず、「入らなければ安全、入れば報酬」という選択にならない。
 */
function placeHouse(state: GameState, rng: Rng): void {
  state.houseRoom = -1;
  state.houseArmed = false;
  if (state.map.kind !== 'rooms' || state.depth < 4) return;
  if (!rng.chance(0.18)) return;

  const ends = deadEndRooms(state.map);
  if (ends.length === 0) return;
  const index = rng.pick(ends);
  const room = state.map.rooms[index];

  const extra = 4 + Math.floor(state.depth / 2);
  for (let i = 0; i < extra; i++) {
    const m = spawnOne(rng, state.map, state.depth, state.monsters, () => state.nextId++, (x, y) =>
      inRoom(room, x, y),
    );
    if (m) state.monsters.push(m);
  }
  for (let i = 0; i < 3; i++) {
    const at = randomFloorTile(rng, state.map);
    if (!at || !inRoom(room, at.x, at.y)) continue;
    if (state.items.some((it) => it.x === at.x && it.y === at.y)) continue;
    const slot: EquipSlot = rng.chance(0.5) ? 'weapon' : 'armor';
    state.items.push(makeEquipItem(rng, pickFloorEquip(rng, slot), state.depth, at.x, at.y));
  }

  state.houseRoom = index;
  state.houseArmed = true;
}

function inRoom(room: Room, x: number, y: number): boolean {
  return x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h;
}

/** ハウスの部屋に入ったら起動する */
function checkHouse(state: GameState): void {
  if (!state.houseArmed || state.houseRoom < 0) return;
  const room = state.map.rooms[state.houseRoom];
  if (!inRoom(room, state.player.x, state.player.y)) return;
  state.houseArmed = false;
  pushLog(state, 'alert', '部屋中の敵が一斉にこちらを向いた。');
}

// ---------------------------------------------------------------------------
// イベント床

function stairsPos(map: GameMap): { x: number; y: number } | null {
  const i = map.tiles.indexOf(Tile.StairsDown);
  return i < 0 ? null : { x: i % map.width, y: Math.floor(i / map.width) };
}

/** 足元のイベント床を踏む。踏んだら消える。何か起きたら true */
function stepOnFloor(state: GameState, rng: Rng): boolean {
  const p = state.player;
  const i = state.floors.findIndex((f) => f.x === p.x && f.y === p.y);
  if (i < 0) return false;
  const floor = state.floors[i];
  state.floors.splice(i, 1);

  const effect = rollEffect(rng, floor.kind);
  pushLog(state, 'info', `${FLOORS[floor.kind].name}を踏んだ。`);
  applyFloorEffect(state, effect);
  return true;
}

/** 深さと最大 HP から、大きさの段階を実数に変える */
function healAmount(state: GameState, size: Magnitude): number {
  const max = state.player.maxHp;
  if (size === 'small') return Math.max(3, Math.ceil(max / 5));
  if (size === 'medium') return Math.max(5, Math.ceil(max / 3));
  return max;
}

function damageAmount(state: GameState, size: Magnitude): number {
  const base = 2 + Math.floor(state.depth / 3);
  return size === 'small' ? base : size === 'medium' ? base * 2 : base * 3;
}

function xpAmount(state: GameState, size: Magnitude): number {
  const base = xpToNext(state.level);
  return Math.max(1, Math.ceil(base * (size === 'small' ? 0.2 : size === 'medium' ? 0.4 : 0.8)));
}

/** 効果を 1 つ適用する。踏んだときのほか、テストからも呼ぶ */
export function applyFloorEffect(state: GameState, effect: FloorEffect): void {
  const p = state.player;
  switch (effect.kind) {
    case 'healHp': {
      const heal = Math.min(p.maxHp - p.hp, healAmount(state, effect.size));
      p.hp += heal;
      pushLog(state, 'player', heal > 0 ? `HP が ${heal} 回復した。` : '傷は無かった。');
      return;
    }
    case 'rest': {
      const heal = p.maxHp - p.hp;
      p.hp = p.maxHp;
      const gain = Math.min(state.staminaMax - state.stamina, effect.stamina);
      state.stamina += gain;
      pushLog(state, 'player', `深く息をついた。HP が ${heal}、スタミナが ${gain} 戻った。`);
      return;
    }
    case 'damage': {
      const dmg = damageAmount(state, effect.size);
      p.hp -= dmg;
      notifyDamage({ to: 'player', depth: state.depth, from: 'floor', roll: dmg, dealt: dmg });
      pushLog(state, 'enemy', `毒気に当てられた。${dmg} のダメージ。`);
      return;
    }
    case 'restoreStamina': {
      const gain = Math.min(state.staminaMax - state.stamina, effect.amount);
      state.stamina += gain;
      pushLog(state, 'player', `スタミナが ${gain} 戻った。`);
      return;
    }
    case 'gainXp': {
      const amount = xpAmount(state, effect.size);
      pushLog(state, 'player', `経験値が ${amount} 入った。`);
      gainXp(state, amount);
      return;
    }
    case 'boostAtk':
      p.atk += effect.amount;
      pushLog(state, 'player', `力がみなぎる。攻撃力が ${effect.amount} 上がった。`);
      return;
    case 'boostDef':
      p.def += effect.amount;
      pushLog(state, 'player', `体が硬くなった。防御力が ${effect.amount} 上がった。`);
      return;
    case 'boostStaminaMax':
      state.staminaMax += effect.amount;
      state.stamina += effect.amount;
      pushLog(state, 'player', `スタミナの最大値が ${effect.amount} 増えた。`);
      return;
    case 'drainStaminaMax': {
      // 最大値が 0 になると即死になるので下限を残す
      const lost = Math.min(effect.amount, state.staminaMax - 20);
      if (lost <= 0) {
        pushLog(state, 'info', '何も起きなかった。');
        return;
      }
      state.staminaMax -= lost;
      state.stamina = Math.min(state.stamina, state.staminaMax);
      pushLog(state, 'alert', `スタミナの最大値が ${lost} 減った。`);
      return;
    }
    case 'corrode':
      corrode(state);
      return;
    case 'haste':
      state.effects.haste = (state.effects.haste ?? 0) + effect.turns;
      pushLog(state, 'player', '体が軽い。しばらく敵より速く動ける。');
      return;
    case 'slow':
      state.effects.slow = (state.effects.slow ?? 0) + effect.turns;
      pushLog(state, 'alert', '足が重い。しばらく敵に余計に動かれる。');
      return;
    case 'reveal':
      revealMap(state);
      pushLog(state, 'player', 'この階の地形が頭に浮かんだ。');
      return;
  }
}

/**
 * 腐食。装備の強さを 1 下げる。
 *
 * 変則よけの護符を着ていると防げる。
 * 弱った装備は落ちているものと比べ直せるように、床の「断った」印を外す。
 */
function corrode(state: GameState): void {
  if (armorHas(state.armor, 'wardCorrosion')) {
    pushLog(state, 'player', '護符が腐食を防いだ。');
    return;
  }
  const targets: EquipSlot[] = [];
  if (state.weapon && state.weapon.power > 0) targets.push('weapon');
  if (state.armor && state.armor.power > 0) targets.push('armor');
  if (targets.length === 0) {
    pushLog(state, 'info', '腐食する装備が無かった。');
    return;
  }
  // 武器と防具の両方を持っていたら、深いほうから減らす
  const slot = targets.length === 1 ? targets[0] : pickHeavier(state, targets);
  const current = slot === 'weapon' ? state.weapon : state.armor;
  if (!current) return;
  current.power--;
  clearDeclined(state, slot);
  pushLog(state, 'alert', `${equipName(current)} に腐食した。`);
}

function pickHeavier(state: GameState, slots: EquipSlot[]): EquipSlot {
  const power = (slot: EquipSlot): number => (slot === 'weapon' ? state.weapon?.power : state.armor?.power) ?? 0;
  return power(slots[0]) >= power(slots[1]) ? slots[0] : slots[1];
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

  // 財宝は持ち歩かない。拾った時点でスコアになる
  if (isTreasure(item.kind)) {
    state.score += item.power;
    state.items.splice(i, 1);
    pushLog(state, 'player', `${name} を手にした。${item.power} 点。`);
    return true;
  }

  const kind = item.kind as ConsumableKind;
  const limit = stackLimit(kind);
  if (state.inventory[kind] >= limit) {
    pushLog(state, 'info', `${name} はもう持てない (${limit} 個まで)。`);
    return true;
  }
  state.inventory[kind]++;
  state.items.splice(i, 1);
  pushLog(state, 'info', `${name} を拾った (${state.inventory[kind]})。`);
  return true;
}

/**
 * 消耗品を使う。
 *
 * 回復薬 1 個の量を最大 HP の 1/4 に下げてある。
 * 出るか出ないかの差がそのまま生存時間の差になっていたので、量を下げて出る数を増やした。
 */
function useItem(state: GameState, kind: ConsumableKind): void {
  const p = state.player;
  switch (kind) {
    case 'potion': {
      const heal = Math.min(p.maxHp - p.hp, Math.max(3, Math.ceil(p.maxHp / 4)));
      p.hp += heal;
      pushLog(state, 'player', `HP 回復薬を飲んだ。HP が ${heal} 回復した。`);
      return;
    }
    case 'elixir': {
      const gain = Math.min(state.staminaMax - state.stamina, ELIXIR_STAMINA);
      state.stamina += gain;
      pushLog(state, 'player', `スタミナ薬を飲んだ。スタミナが ${gain} 戻った。`);
      return;
    }
  }
}

/** 唱えられるか。スタミナが足りているかだけを見る */
export function canCast(state: GameState, spell: SpellKind): boolean {
  return !state.over && state.stamina >= SPELLS[spell].cost;
}

function castSpell(state: GameState, rng: Rng, spell: SpellKind): void {
  switch (spell) {
    case 'thunder': {
      const targets = visibleMonsters(state);
      if (targets.length === 0) {
        pushLog(state, 'player', '雷を放ったが、周りに敵はいなかった。');
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
  }
}

/**
 * 床と、床に隣接する壁を既知にする (壁だけの領域は塗らない)。
 * 地図の巻物を廃したので、今はイベント床の効果として使う。
 */
export function revealMap(state: GameState): void {
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
/** ダメージの出どころ。敵の攻撃以外も区別できるようにしてある */
export type DamageSource = ActorKind | 'poison' | 'starve' | 'floor';

export interface DamageEvent {
  /** 誰が受けたか */
  to: 'player' | 'monster';
  depth: number;
  /** 攻撃した側 */
  from: DamageSource;
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

/** 擬態中で、まだ正体が割れていないか */
export function isDisguised(m: Actor): boolean {
  return hasPassive(m.kind, 'mimic') && m.revealed !== true;
}

function reveal(state: GameState, m: Actor): void {
  if (m.revealed) return;
  m.revealed = true;
  pushLog(state, 'alert', `武器だと思ったものが${actorName(m.kind)}だった。`);
}

/** プレイヤーから 1 体への 1 回ぶん */
function strikeMonster(state: GameState, rng: Rng, target: Actor): void {
  const p = state.player;
  // 殴れば正体は割れる
  if (isDisguised(target)) reveal(state, target);
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
/** プレイヤーに隣接していて、角越しではない敵。群れ薙ぎで使う */
function adjacentMonsters(state: GameState): Actor[] {
  const p = state.player;
  return state.monsters.filter(
    (m) =>
      Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) === 1 &&
      canReach(state.map, p.x, p.y, m.x - p.x, m.y - p.y),
  );
}

function killMonster(state: GameState, rng: Rng, m: Actor): void {
  state.monsters = state.monsters.filter((x) => x.id !== m.id);
  pushLog(state, 'player', `${actorName(m.kind)}を倒した。`);
  rewardKill(state, m);
  dropEquip(state, rng, m);
  if (m.kind === BOSS) defeatBoss(state, m);
}

/**
 * ボスを倒したとき。財宝を落とし、クリア階なら脱出階段を出す。
 * 財宝はその場に落とす。倒した場所まで取りに行く手間も判断のうちにする。
 */
function defeatBoss(state: GameState, m: Actor): void {
  const treasure = makeTreasure(state.depth, m.x, m.y);
  state.items.push(treasure);
  pushLog(state, 'alert', `${itemLabel(treasure)} が転がり出た。`);

  if (!isClearFloor(state.depth)) return;
  state.map.tiles[idx(state.map, m.x, m.y)] = Tile.StairsUp;
  state.explored[idx(state.map, m.x, m.y)] = 1;
  pushLog(state, 'alert', '地上へ続く階段が現れた。');
}

/**
 * 倒した敵が装備を落とす。
 * その系統に効く装備をその系統が落とすので、狩る対象が分散し、
 * 戦うか避けるかの判断に装備の期待値が乗る。
 */
function dropEquip(state: GameState, rng: Rng, m: Actor): void {
  // 分裂体は落とさない。割るたびに抽選が増えると、分裂を止める装備が分裂で稼げてしまう
  if (m.split) return;
  const family = MONSTERS[m.kind as MonsterKind].family;
  if (!rng.chance(DROP_CHANCE * (m.spawned ? SPAWN_REWARD : 1))) return;
  if (state.items.some((it) => it.x === m.x && it.y === m.y)) return;
  const id = pickDropEquip(rng, family);
  if (!id) return;
  const item = makeEquipItem(rng, id, state.depth, m.x, m.y);
  state.items.push(item);
  pushLog(state, 'info', `${itemLabel(item)} を落とした。`);
}

/**
 * 撃破数・スコア・経験値をまとめて加算する。雷で倒したときもここを通す。
 *
 * 後から湧いた個体は報酬を半分にする。居座って稼ぐ動機を弱めるためで、0 にはしない。
 * 分裂体はさらに下げる。分裂は総 HP を増やさないので、労力が同じまま撃破数だけ増えるためである。
 */
function rewardKill(state: GameState, m: Actor): void {
  state.kills++;
  const def = MONSTERS[m.kind as MonsterKind];
  const rate = (m.spawned ? SPAWN_REWARD : 1) * (m.split ? SPLIT_REWARD : 1);
  state.score += Math.ceil(bountyFor(def, state.depth) * rate);
  gainXp(state, Math.ceil(xpFor(def, state.depth) * rate));
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

  // 群れよけの盾を着ていなければ、被弾のたびにスタミナが減る。
  // 数で押してくる相手ほどスタミナを削られるので、盾がその系統への備えになる
  if (!armorHas(a, 'guard') && --state.hitTick <= 0) {
    state.hitTick = STAMINA_HITS_PER_POINT;
    state.stamina = Math.max(0, state.stamina - 1);
  }

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
  // 同じ種類で数える。kind を固定すると、グレード 2 以降 (slimeSplit, slimeMimic) で
  // 数が常に 0 になり、上限が一度も働かない
  const kin = state.monsters.filter((x) => x.kind === m.kind).length;
  if (kin >= SLIME_CAP) return;
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
    split: true,
  };
  state.monsters.push(child);
  pushLog(state, 'enemy', `${actorName(m.kind)}が分裂した。`);
}

// ---------------------------------------------------------------------------
// 敵の行動

function monstersAct(state: GameState, rng: Rng): void {
  const p = state.player;
  // 距離場はこの呼び出しの間だけ使う。プレイヤーは動かないので作り直さなくてよい
  const field = distanceField(state.map, p);
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
      if (monsterTurn(state, rng, m, def, field)) break;
      if (p.hp <= 0) break;
    }
  }
}

/** 1 回分の行動。攻撃か技を使ったら true、移動だけなら false */
function monsterTurn(state: GameState, rng: Rng, m: Actor, def: MonsterDef, field: Int32Array): boolean {
  const p = state.player;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  const sees = state.visible[idx(state.map, m.x, m.y)] === 1;

  // 擬態: 武器のふりをして動かない。隣に来られた時点で正体を現し、その場で殴る
  if (isDisguised(m)) {
    if (!canHitPlayer(state, m)) return true;
    reveal(state, m);
    monsterAttack(state, rng, m);
    return true;
  }

  if (def.action && rng.chance(def.action.chance) && tryAction(state, rng, m, def.action.kind, dist, sees)) {
    return true;
  }

  if (canHitPlayer(state, m)) {
    monsterAttack(state, rng, m);
    return true;
  }

  if (sees) {
    // プレイヤーから見えている = 向こうからも見えているとみなして追ってくる。
    // 壁抜けは距離場の外を通れるので、素朴な寄せ方のままにする
    if (def.passives.includes('phasing')) {
      moveToward(state, m, Math.sign(dx), Math.sign(dy));
    } else {
      const spot = chooseStep(
        { map: state.map, player: p, field, occupied: (x, y) => occupied(state, x, y), rng },
        m,
        def.passives.includes('erratic'),
      );
      if (spot) {
        m.x = spot.x;
        m.y = spot.y;
      }
    }
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
      if (!canHitPlayer(state, m)) return false;
      pushLog(state, 'enemy', `${name}が続けて切りつけた。`);
      monsterAttack(state, rng, m);
      if (p.hp > 0) monsterAttack(state, rng, m);
      return true;

    case 'smash':
      if (!canHitPlayer(state, m)) return false;
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

    case 'poison': {
      if (!canHitPlayer(state, m)) return false;
      monsterAttack(state, rng, m, { label: `${name}の毒牙!` });
      if (p.hp <= 0) return true;
      state.effects.poison = Math.min(POISON_MAX_TURNS, (state.effects.poison ?? 0) + POISON_TURNS);
      pushLog(state, 'alert', '毒が回った。しばらく HP が減り続ける。');
      return true;
    }

    case 'corrodeHit': {
      if (!canHitPlayer(state, m)) return false;
      monsterAttack(state, rng, m, { label: `${name}が噛みついた!` });
      if (p.hp <= 0) return true;
      corrode(state);
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

/**
 * 敵からプレイヤーへ攻撃が届くか。
 *
 * 隣接していても、壁の角越しには届かない。
 * 例外は 2 つある。壁抜けは壁の中を通れる相手なので角の制限が意味を持たず、
 * reach は角越しを能力として持たせた敵である。
 */
function canHitPlayer(state: GameState, m: Actor): boolean {
  const p = state.player;
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return false;
  if (hasPassive(m.kind, 'reach') || hasPassive(m.kind, 'phasing')) return true;
  return canReach(state.map, m.x, m.y, dx, dy);
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
  const radius = state.dark ? DARK_FOV_RADIUS : FOV_RADIUS;
  computeFov(state.map, state.player.x, state.player.y, radius, state.visible);
  for (let i = 0; i < state.visible.length; i++) {
    if (state.visible[i] === 1) state.explored[i] = 1;
  }
}

/**
 * 長居への対策。
 *
 * 滞在ターン数に応じて敵を足し、それでも居座るなら追う者を呼ぶ。
 * 湧きは視界の外にだけ出す。目の前に湧くと避けようがない。
 */
function tickFloorPressure(state: GameState, rng: Rng): void {
  if (state.over) return;

  // ハウスのある階は最初から敵が多いので、追加の湧きは止める
  if (state.houseRoom < 0 && state.floorTurn > 0 && state.floorTurn % SPAWN_INTERVAL === 0) {
    const m = spawnOne(rng, state.map, state.depth, state.monsters, () => state.nextId++, (x, y) =>
      outOfSight(state, x, y),
    );
    if (m) {
      m.spawned = true;
      state.monsters.push(m);
    }
  }

  if (state.stalkerCalled) return;

  if (state.floorTurn === STALKER_WARN) {
    // 階段の位置を把握できていない段階で出ると詰むので、方角だけ添えて予告する
    pushLog(state, 'alert', `地響きが近づいてくる。階段は${stairsDirection(state)}にある。`);
    return;
  }

  if (state.floorTurn >= STALKER_TURN) {
    const m = placeMonster(rng, state.map, STALKER, state.depth, state.monsters, () => state.nextId++, (x, y) =>
      outOfSight(state, x, y),
    );
    if (!m) return;
    state.monsters.push(m);
    state.stalkerCalled = true;
    pushLog(state, 'alert', `${actorName(STALKER)}が現れた。勝てない。降りろ。`);
  }
}

/** 視界の外で、プレイヤーから十分離れているか */
function outOfSight(state: GameState, x: number, y: number): boolean {
  if (state.visible[idx(state.map, x, y)] === 1) return false;
  const p = state.player;
  return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) >= 8;
}

/** プレイヤーから見た階段の方角 */
function stairsDirection(state: GameState): string {
  const at = stairsPos(state.map);
  if (!at) return 'どこか';
  const dx = at.x - state.player.x;
  const dy = at.y - state.player.y;
  const ns = dy < -2 ? '北' : dy > 2 ? '南' : '';
  const ew = dx > 2 ? '東' : dx < -2 ? '西' : '';
  return ns + ew || 'すぐ近く';
}

const EFFECT_END: Record<TimedEffect, string> = {
  haste: '体の軽さが消えた。',
  slow: '足の重さが取れた。',
  poison: '毒が抜けた。',
};

/** 残りターン数つきの効果を 1 ターンぶん進める */
function tickEffects(state: GameState): void {
  if (state.effects.poison) {
    state.player.hp -= POISON_DAMAGE;
    notifyDamage({ to: 'player', depth: state.depth, from: 'poison', roll: POISON_DAMAGE, dealt: POISON_DAMAGE });
  }
  for (const key of ['haste', 'slow', 'poison'] as TimedEffect[]) {
    const left = state.effects[key];
    if (left === undefined) continue;
    if (left <= 1) {
      delete state.effects[key];
      pushLog(state, 'info', EFFECT_END[key]);
    } else {
      state.effects[key] = left - 1;
    }
  }
}

/**
 * スタミナの経過処理。
 *
 * スタミナがある間は数ターンに 1 回 HP が回復し、尽きると毎ターン HP が減る。
 * 減少だけが始まる形にすると、回復手段が乏しいときはほぼ確定死になって警告として働かない。
 * 残っている間の自然回復とセットにすることで、HP をスタミナで買う一本の経済になる。
 */
function tickStamina(state: GameState): void {
  const p = state.player;

  if (state.stamina > 0) {
    if (--state.staminaTick <= 0) {
      state.staminaTick = STAMINA_DRAIN_TURNS;
      state.stamina--;
      if (state.stamina === 0) pushLog(state, 'alert', 'スタミナが尽きた。休まないと HP が減っていく。');
      else if (state.stamina === Math.floor(state.staminaMax / 5)) {
        pushLog(state, 'alert', 'スタミナが心もとない。');
      }
    }
  }

  if (state.stamina > 0) {
    if (--state.regenTick <= 0) {
      state.regenTick = REGEN_TURNS;
      if (p.hp < p.maxHp) p.hp++;
    }
    return;
  }

  // 尽きている間は自然回復が止まり、行動のたびに HP が減る
  state.regenTick = REGEN_TURNS;
  p.hp -= STARVE_DAMAGE;
  notifyDamage({ to: 'player', depth: state.depth, from: 'starve', roll: STARVE_DAMAGE, dealt: STARVE_DAMAGE });
}

/** 外から 1 行足す (セーブを捨てた通知など、ゲームの外で起きたことを伝える) */
export function addLog(state: GameState, kind: LogKind, text: string): void {
  pushLog(state, kind, text);
}

function pushLog(state: GameState, kind: LogKind, text: string): void {
  state.log.push({ kind, text, turn: state.turn });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
}

/**
 * 操作スロット。消耗品と魔法を同じ並びに出す。
 * 何を出すかはここで決め、描画層は並べるだけにする。
 */
function buildSlots(state: GameState): ViewSlot[] {
  const items: ViewSlot[] = CONSUMABLES.map((kind) => ({
    ref: { kind: 'item', id: kind },
    label: ITEM_NAMES[kind],
    badge: String(state.inventory[kind]),
    enabled: !state.over && state.inventory[kind] > 0,
  }));
  const spells: ViewSlot[] = SPELL_KINDS.map((kind) => ({
    ref: { kind: 'spell', id: kind },
    label: SPELLS[kind].name,
    badge: `${SPELLS[kind].cost}`,
    enabled: canCast(state, kind),
  }));
  return [...items, ...spells];
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
  [Tile.StairsUp]: 'stairsUp',
};

const FLOOR_CELL: Record<FloorTile['kind'], CellKind> = {
  green: 'floorGreen',
  yellow: 'floorYellow',
  red: 'floorRed',
  blue: 'floorBlue',
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

  // イベント床は地形の上に重ねる。一度見た場所のものは覚えておく
  for (const f of state.floors) {
    const i = idx(map, f.x, f.y);
    if (state.explored[i] !== 1) continue;
    cells[i] = { kind: FLOOR_CELL[f.kind], vis: cells[i].vis };
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
    disguised: isDisguised(m),
  }));
  const p = state.player;
  actors.push({ kind: 'player', x: p.x, y: p.y, health: healthOf(p), disguised: false });

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
      weaponDetail: equipSummary(state.weapon, 'weapon'),
      armorDetail: equipSummary(state.armor, 'armor'),
      level: state.level,
      xp: state.xp,
      xpNext: xpToNext(state.level),
      stamina: state.stamina,
      staminaMax: state.staminaMax,
    },
    inventory: CONSUMABLES.map((kind) => ({ kind, count: state.inventory[kind] })),
    slots: buildSlots(state),
    depth: state.depth,
    turn: state.turn,
    kills: state.kills,
    score: state.score,
    seed: state.seed,
    log: state.log,
    prompt: promptText(state),
    gameOver: state.over,
    cleared: state.cleared,
  };
}

// createMonster は分裂以外でも使えるように再エクスポートしておく (テストや将来の召喚用)
export { createMonster };
