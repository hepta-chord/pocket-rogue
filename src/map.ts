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
 * 部屋 + 通路の古典的な生成。
 * 重ならない矩形をランダムに置き、直前の部屋の中心と L 字の通路で結ぶ。
 * 最後の部屋の中心に下り階段を置く。
 */
export function generateMap(rng: Rng, width: number, height: number): GameMap {
  for (;;) {
    const map = tryGenerate(rng, width, height);
    if (map.rooms.length >= 2) return map;
  }
}

function tryGenerate(rng: Rng, width: number, height: number): GameMap {
  const map: GameMap = { width, height, tiles: new Array<Tile>(width * height).fill(Tile.Wall), rooms: [] };

  for (let attempt = 0; attempt < ROOM_ATTEMPTS && map.rooms.length < MAX_ROOMS; attempt++) {
    const w = rng.int(4, 9);
    const h = rng.int(3, 6);
    const x = rng.int(1, width - w - 2);
    const y = rng.int(1, height - h - 2);
    const room: Room = { x, y, w, h };
    if (map.rooms.some((r) => overlaps(r, room, 1))) continue;

    carveRoom(map, room);
    if (map.rooms.length > 0) {
      const prev = roomCenter(map.rooms[map.rooms.length - 1]);
      carveCorridor(map, rng, prev, roomCenter(room));
    }
    map.rooms.push(room);
  }

  if (map.rooms.length > 0) {
    const c = roomCenter(map.rooms[map.rooms.length - 1]);
    map.tiles[idx(map, c.x, c.y)] = Tile.StairsDown;
  }
  return map;
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
