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
 * 斜めのときは、行き先が床でも両隣が壁なら通さない。
 * 壁と壁の隙間を斜めに抜けられると、通路の角が意味を失って逃走も追跡も成立しなくなる。
 * 直交の移動には制限をかけない。
 */
export function canStep(map: GameMap, x: number, y: number, dx: number, dy: number): boolean {
  if (!isWalkable(map, x + dx, y + dy)) return false;
  if (dx === 0 || dy === 0) return true;
  return isWalkable(map, x + dx, y) || isWalkable(map, x, y + dy);
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
