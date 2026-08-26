import { actorName, createPlayer, spawnMonsters, type Actor } from './entity';
import { computeFov } from './fov';
import {
  CONSUMABLES,
  ITEM_NAMES,
  STACK_MAX,
  emptyInventory,
  isEquip,
  spawnItems,
  type ConsumableKind,
  type Inventory,
  type Item,
} from './items';
import { Tile, generateMap, idx, inBounds, isWalkable, roomCenter, tileAt, type GameMap } from './map';
import { Rng, hashSeed } from './rng';
import type { CellKind, LogEntry, LogKind, ViewActor, ViewCell, ViewItem, ViewModel } from './view';

export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' }
  | { type: 'use'; item: ConsumableKind };

export interface StepResult {
  /** ターンが進んだか。壁にぶつかった・持っていないアイテムを使おうとした、なら false */
  acted: boolean;
  /** アイテムを拾ったなど、連続移動を止めるべき出来事があったか */
  interrupt: boolean;
}

export const SAVE_VERSION = 3;

export interface GameState {
  version: typeof SAVE_VERSION;
  seed: string;
  rngState: number;
  depth: number;
  turn: number;
  nextId: number;
  kills: number;
  map: GameMap;
  player: Actor;
  monsters: Actor[];
  /** 床に落ちているアイテム */
  items: Item[];
  /** 持っている消耗品の数 */
  inventory: Inventory;
  /** 装備の強さ。攻撃力と被ダメージ軽減に足す */
  weapon: number;
  armor: number;
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
const REGEN_EVERY = 5;

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
    map: { width: 0, height: 0, tiles: [], rooms: [] },
    player: createPlayer(0, 0),
    monsters: [],
    items: [],
    inventory: emptyInventory(),
    weapon: 0,
    armor: 0,
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

  if (action.type === 'move') {
    const nx = p.x + action.dx;
    const ny = p.y + action.dy;
    const target = state.monsters.find((m) => m.x === nx && m.y === ny);
    if (target) {
      attack(state, rng, p, target);
    } else if (isWalkable(state.map, nx, ny)) {
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
    useItem(state, action.item);
    interrupt = true;
  }

  if (tileAt(state.map, p.x, p.y) === Tile.StairsDown) {
    state.turn++;
    descend(state, rng);
    state.rngState = rng.state;
    return { acted: true, interrupt: true };
  }

  monstersAct(state, rng);
  state.turn++;
  if (state.turn % REGEN_EVERY === 0 && p.hp > 0 && p.hp < p.maxHp) p.hp++;
  updateFov(state);

  if (p.hp <= 0) {
    p.hp = 0;
    state.over = true;
    pushLog(state, 'alert', `あなたは倒れた。B${state.depth} で ${state.kills} 体を倒した。`);
  }
  state.rngState = rng.state;
  return { acted: true, interrupt };
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

  if (state.depth > 1) {
    p.maxHp += 2;
    if (state.depth % 2 === 0) p.atk += 1;
    p.hp = Math.min(p.maxHp, p.hp + 5);
  }

  state.monsters = spawnMonsters(rng, state.map, state.depth, start, () => state.nextId++);
  state.items = spawnItems(rng, state.map, state.depth, start, state.monsters);
  state.visible = new Array<number>(MAP_W * MAP_H).fill(0);
  state.explored = new Array<number>(MAP_W * MAP_H).fill(0);
  updateFov(state);
  pushLog(state, 'info', state.depth === 1 ? 'B1。> を探して下に降りよう。' : `B${state.depth} に降りた。少し回復した。`);
}

/** 足元のアイテムを拾う。何か起きたら true */
function pickUp(state: GameState): boolean {
  const p = state.player;
  const i = state.items.findIndex((it) => it.x === p.x && it.y === p.y);
  if (i < 0) return false;
  const item = state.items[i];
  const name = ITEM_NAMES[item.kind];

  if (isEquip(item.kind)) {
    const current = item.kind === 'weapon' ? state.weapon : state.armor;
    if (item.power > current) {
      if (item.kind === 'weapon') state.weapon = item.power;
      else state.armor = item.power;
      pushLog(state, 'info', `${name} +${item.power} を装備した。`);
    } else {
      pushLog(state, 'info', `${name} +${item.power} は今のより弱い。置いていった。`);
    }
    state.items.splice(i, 1);
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

function useItem(state: GameState, kind: ConsumableKind): void {
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
      let killed = 0;
      for (const m of targets) {
        m.hp -= dmg;
        if (m.hp <= 0) killed++;
      }
      state.monsters = state.monsters.filter((m) => m.hp > 0);
      state.kills += killed;
      const tail = killed > 0 ? `${killed} 体を倒した。` : '';
      pushLog(state, 'player', `雷が ${targets.length} 体に ${dmg} のダメージ。${tail}`);
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
        state.explored[idx(map, x, y)] = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (inBounds(map, x + dx, y + dy)) state.explored[idx(map, x + dx, y + dy)] = 1;
          }
        }
      }
    }
  }
}

function attack(state: GameState, rng: Rng, attacker: Actor, defender: Actor): void {
  if (attacker.kind === 'player') {
    const dmg = rng.int(1, attacker.atk + state.weapon);
    defender.hp -= dmg;
    pushLog(state, 'player', `${actorName(defender.kind)}に ${dmg} のダメージ。`);
    if (defender.hp <= 0) {
      state.monsters = state.monsters.filter((m) => m.id !== defender.id);
      state.kills++;
      pushLog(state, 'player', `${actorName(defender.kind)}を倒した。`);
    }
    return;
  }

  // 防具は被ダメージを減らすが、最低 1 は通る (序盤の防具で弱い敵が無害になるのを防ぐ)
  const roll = rng.int(1, attacker.atk);
  const dmg = Math.max(1, roll - state.armor);
  const reduced = roll - dmg;
  defender.hp -= dmg;
  const note = reduced > 0 ? ` (防具で ${reduced} 軽減)` : '';
  pushLog(state, 'enemy', `${actorName(attacker.kind)}から ${dmg} のダメージ。${note}`);
}

function monstersAct(state: GameState, rng: Rng): void {
  const p = state.player;
  for (const m of [...state.monsters]) {
    if (p.hp <= 0) return;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist === 1) {
      attack(state, rng, m, p);
    } else if (state.visible[idx(state.map, m.x, m.y)] === 1) {
      // プレイヤーから見えている = 向こうからも見えているとみなして追ってくる
      moveToward(state, m, Math.sign(dx), Math.sign(dy));
    } else if (rng.chance(0.25)) {
      moveToward(state, m, rng.int(-1, 1), rng.int(-1, 1));
    }
  }
}

function moveToward(state: GameState, m: Actor, sx: number, sy: number): void {
  const candidates = [
    [sx, sy],
    [sx, 0],
    [0, sy],
  ];
  for (const [cx, cy] of candidates) {
    if (cx === 0 && cy === 0) continue;
    const nx = m.x + cx;
    const ny = m.y + cy;
    if (!isWalkable(state.map, nx, ny)) continue;
    if (occupied(state, nx, ny)) continue;
    m.x = nx;
    m.y = ny;
    return;
  }
}

function occupied(state: GameState, x: number, y: number): boolean {
  const p = state.player;
  if (p.x === x && p.y === y) return true;
  return state.monsters.some((m) => m.x === x && m.y === y);
}

function updateFov(state: GameState): void {
  computeFov(state.map, state.player.x, state.player.y, FOV_RADIUS, state.visible);
  for (let i = 0; i < state.visible.length; i++) {
    if (state.visible[i] === 1) state.explored[i] = 1;
  }
}

function pushLog(state: GameState, kind: LogKind, text: string): void {
  state.log.push({ kind, text });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
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

  const actors: ViewActor[] = visibleMonsters(state).map((m) => ({ kind: m.kind, x: m.x, y: m.y }));
  const p = state.player;
  actors.push({ kind: 'player', x: p.x, y: p.y });

  return {
    width: map.width,
    height: map.height,
    cells,
    items,
    actors,
    player: { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, atk: p.atk + state.weapon, def: state.armor },
    inventory: CONSUMABLES.map((kind) => ({ kind, count: state.inventory[kind] })),
    depth: state.depth,
    turn: state.turn,
    kills: state.kills,
    seed: state.seed,
    log: state.log,
    gameOver: state.over,
  };
}
