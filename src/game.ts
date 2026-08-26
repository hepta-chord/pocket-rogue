import { actorName, createPlayer, spawnMonsters, type Actor } from './entity';
import { computeFov } from './fov';
import { Tile, generateMap, idx, isWalkable, roomCenter, tileAt, type GameMap } from './map';
import { Rng, hashSeed } from './rng';
import type { CellKind, ViewActor, ViewCell, ViewModel } from './view';

export type Action = { type: 'move'; dx: number; dy: number } | { type: 'wait' };

export interface GameState {
  version: 1;
  seed: string;
  rngState: number;
  depth: number;
  turn: number;
  nextId: number;
  kills: number;
  map: GameMap;
  player: Actor;
  monsters: Actor[];
  /** 0/1。今見えている位置 */
  visible: number[];
  /** 0/1。一度でも見た位置 */
  explored: number[];
  log: string[];
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
    version: 1,
    seed,
    rngState: rng.state,
    depth: 0,
    turn: 0,
    nextId: 1,
    kills: 0,
    map: { width: 0, height: 0, tiles: [], rooms: [] },
    player: createPlayer(0, 0),
    monsters: [],
    visible: [],
    explored: [],
    log: [],
    over: false,
  };
  pushLog(state, `seed ${seed} のダンジョンに入った。`);
  descend(state, rng);
  state.rngState = rng.state;
  return state;
}

/** 1 ターン進める。壁にぶつかっただけならターンは消費しない */
export function step(state: GameState, action: Action): void {
  if (state.over) return;
  const rng = new Rng(state.rngState);
  const p = state.player;

  if (action.type === 'move') {
    const nx = p.x + action.dx;
    const ny = p.y + action.dy;
    const target = state.monsters.find((m) => m.x === nx && m.y === ny);
    if (target) {
      attack(state, rng, p, target);
    } else if (isWalkable(state.map, nx, ny)) {
      p.x = nx;
      p.y = ny;
    } else {
      state.rngState = rng.state;
      return;
    }
  }

  if (tileAt(state.map, p.x, p.y) === Tile.StairsDown) {
    state.turn++;
    descend(state, rng);
    state.rngState = rng.state;
    return;
  }

  monstersAct(state, rng);
  state.turn++;
  if (state.turn % REGEN_EVERY === 0 && p.hp > 0 && p.hp < p.maxHp) p.hp++;
  updateFov(state);

  if (p.hp <= 0) {
    p.hp = 0;
    state.over = true;
    pushLog(state, `あなたは倒れた。B${state.depth} で ${state.kills} 体を倒した。`);
  }
  state.rngState = rng.state;
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
  state.visible = new Array<number>(MAP_W * MAP_H).fill(0);
  state.explored = new Array<number>(MAP_W * MAP_H).fill(0);
  updateFov(state);
  pushLog(state, state.depth === 1 ? 'B1。> を探して下に降りよう。' : `B${state.depth} に降りた。少し回復した。`);
}

function attack(state: GameState, rng: Rng, attacker: Actor, defender: Actor): void {
  const dmg = rng.int(1, attacker.atk);
  defender.hp -= dmg;
  const who = attacker.kind === 'player' ? `${actorName(defender.kind)}に` : `${actorName(attacker.kind)}から`;
  pushLog(state, `${who} ${dmg} のダメージ。`);
  if (defender.hp <= 0 && defender.kind !== 'player') {
    state.monsters = state.monsters.filter((m) => m.id !== defender.id);
    state.kills++;
    pushLog(state, `${actorName(defender.kind)}を倒した。`);
  }
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

function pushLog(state: GameState, msg: string): void {
  state.log.push(msg);
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

  const actors: ViewActor[] = state.monsters
    .filter((m) => state.visible[idx(map, m.x, m.y)] === 1)
    .map((m) => ({ kind: m.kind, x: m.x, y: m.y }));
  const p = state.player;
  actors.push({ kind: 'player', x: p.x, y: p.y });

  return {
    width: map.width,
    height: map.height,
    cells,
    actors,
    player: { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, atk: p.atk },
    depth: state.depth,
    turn: state.turn,
    kills: state.kills,
    seed: state.seed,
    log: state.log,
    gameOver: state.over,
  };
}
