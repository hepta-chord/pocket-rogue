import type { Rng } from './rng';

export enum Tile {
  Wall = 0,
  Floor = 1,
  StairsDown = 2,
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameMap {
  width: number;
  height: number;
  tiles: Tile[];
  rooms: Room[];
  /**
   * 部屋どうしの接続。部屋の添字の組。
   * 枝の末端 (接続が 1 本だけの部屋) を行き止まりとして扱い、
   * モンスターハウスのような「入らなければ安全」な部屋を置く場所に使う。
   */
  links: [number, number][];
  /** 階段のある部屋の添字 */
  stairsRoom: number;
}

export function idx(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: GameMap, x: number, y: number): Tile {
  return inBounds(map, x, y) ? map.tiles[idx(map, x, y)] : Tile.Wall;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  return tileAt(map, x, y) !== Tile.Wall;
}

/**
 * (x, y) から (dx, dy) へ 1 マス動けるか。
 *
 * 斜めのときは、行き先が床でも**隣が片方でも壁なら通さない**。
 * 壁の角を斜めに回り込めると、通路の曲がり角が意味を失って逃走も追跡も成立しない。
 * 直交の移動には制限をかけない。
 *
 * 部屋は矩形、通路は直交の線で掘るので、この制限を入れても行き来はできなくなる場所は出ない
 * (map.test.ts の到達判定が同じ規則で確かめている)。
 */
export function canStep(map: GameMap, x: number, y: number, dx: number, dy: number): boolean {
  if (!isWalkable(map, x + dx, y + dy)) return false;
  if (dx === 0 || dy === 0) return true;
  return isWalkable(map, x + dx, y) && isWalkable(map, x, y + dy);
}

/**
 * blocked を塞いでも from から to まで歩いて行けるか。
 *
 * 取り返しがつかない効果を持つイベント床の置き場所を絞るのに使う。
 * 階段への唯一の通路に出ると、踏むかどうかの選択が消えて事故になる。
 * 40 x 30 の格子なので、階ごとに数回やっても負荷にならない。
 */
export function canDetour(
  map: GameMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  blocked: { x: number; y: number },
): boolean {
  if (from.x === blocked.x && from.y === blocked.y) return false;
  if (to.x === blocked.x && to.y === blocked.y) return false;

  const target = idx(map, to.x, to.y);
  const wall = idx(map, blocked.x, blocked.y);
  const seen = new Uint8Array(map.width * map.height);
  const queue = [from];
  seen[idx(map, from.x, from.y)] = 1;

  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!canStep(map, x, y, dx, dy)) continue;
        const nx = x + dx;
        const ny = y + dy;
        const i = idx(map, nx, ny);
        if (i === wall || seen[i] === 1) continue;
        if (i === target) return true;
        seen[i] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

export function blocksSight(map: GameMap, x: number, y: number): boolean {
  return tileAt(map, x, y) === Tile.Wall;
}

export function roomCenter(r: Room): { x: number; y: number } {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

export function randomPointInRoom(rng: Rng, r: Room): { x: number; y: number } {
  return { x: rng.int(r.x, r.x + r.w - 1), y: rng.int(r.y, r.y + r.h - 1) };
}

const MAX_ROOMS = 9;
const ROOM_ATTEMPTS = 200;

/**
 * 部屋 + 通路の生成。
 *
 * 重ならない矩形をランダムに置き、**一番近い既存の部屋**と L 字の通路で結ぶ。
 * 直前の部屋とだけ結ぶと接続が一本の鎖になり、端が 2 つしかできない。
 * その 2 つは開始地点と階段で埋まるので、行き止まりの部屋が 1 つも生まれなかった。
 * 近い部屋に繋ぐと枝分かれが自然に出るので、枝の末端が行き止まりになる。
 *
 * 階段は開始地点から最も遠い部屋に置く。
 */
export function generateMap(rng: Rng, width: number, height: number): GameMap {
  for (;;) {
    const map = tryGenerate(rng, width, height);
    if (map.rooms.length >= 2) return map;
  }
}

function tryGenerate(rng: Rng, width: number, height: number): GameMap {
  const map: GameMap = {
    width,
    height,
    tiles: new Array<Tile>(width * height).fill(Tile.Wall),
    rooms: [],
    links: [],
    stairsRoom: 0,
  };

  for (let attempt = 0; attempt < ROOM_ATTEMPTS && map.rooms.length < MAX_ROOMS; attempt++) {
    const w = rng.int(4, 9);
    const h = rng.int(3, 6);
    const x = rng.int(1, width - w - 2);
    const y = rng.int(1, height - h - 2);
    const room: Room = { x, y, w, h };
    if (map.rooms.some((r) => overlaps(r, room, 1))) continue;

    carveRoom(map, room);
    const here = map.rooms.length;
    if (here > 0) {
      const near = nearestRoom(map.rooms, room);
      carveCorridor(map, rng, roomCenter(map.rooms[near]), roomCenter(room));
      map.links.push([near, here]);
    }
    map.rooms.push(room);
  }

  if (map.rooms.length > 0) {
    map.stairsRoom = farthestRoom(map.rooms, 0);
    const c = roomCenter(map.rooms[map.stairsRoom]);
    map.tiles[idx(map, c.x, c.y)] = Tile.StairsDown;
  }
  return map;
}

function centerDistance(a: Room, b: Room): number {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

function nearestRoom(rooms: Room[], to: Room): number {
  let best = 0;
  for (let i = 1; i < rooms.length; i++) {
    if (centerDistance(rooms[i], to) < centerDistance(rooms[best], to)) best = i;
  }
  return best;
}

function farthestRoom(rooms: Room[], from: number): number {
  let best = from === 0 ? 1 % rooms.length : 0;
  for (let i = 0; i < rooms.length; i++) {
    if (i === from) continue;
    if (centerDistance(rooms[i], rooms[from]) > centerDistance(rooms[best], rooms[from])) best = i;
  }
  return best;
}

/** 部屋ごとの接続本数 */
export function roomDegrees(map: GameMap): number[] {
  const degrees = new Array<number>(map.rooms.length).fill(0);
  for (const [a, b] of map.links) {
    degrees[a]++;
    degrees[b]++;
  }
  return degrees;
}

/**
 * 行き止まりの部屋。接続が 1 本だけで、開始地点でも階段でもない部屋を返す。
 *
 * 「入らなければ安全、入れば報酬」という選択にできる場所であり、
 * 階段までの経路上に置くと迂回できない仕掛けを、ここにだけ置く。
 */
export function deadEndRooms(map: GameMap): number[] {
  const degrees = roomDegrees(map);
  const out: number[] = [];
  for (let i = 0; i < map.rooms.length; i++) {
    if (i === 0 || i === map.stairsRoom) continue;
    if (degrees[i] === 1) out.push(i);
  }
  return out;
}

function overlaps(a: Room, b: Room, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  );
}

function carveRoom(map: GameMap, r: Room): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      map.tiles[idx(map, x, y)] = Tile.Floor;
    }
  }
}

function carveCorridor(map: GameMap, rng: Rng, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const corner = rng.chance(0.5) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  carveLine(map, from, corner);
  carveLine(map, corner, to);
}

function carveLine(map: GameMap, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  for (;;) {
    if (inBounds(map, x, y) && map.tiles[idx(map, x, y)] === Tile.Wall) {
      map.tiles[idx(map, x, y)] = Tile.Floor;
    }
    if (x === b.x && y === b.y) break;
    if (x !== b.x) x += dx;
    else y += dy;
  }
}
