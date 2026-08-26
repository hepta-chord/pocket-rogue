import type { GameMap } from './map';
import { Tile, idx } from './map';
import type { Rng } from './rng';

export type MonsterKind = 'rat' | 'bat' | 'goblin' | 'orc' | 'troll' | 'dragon';
export type ActorKind = 'player' | MonsterKind;

export interface Actor {
  id: number;
  kind: ActorKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
}

interface MonsterDef {
  name: string;
  hp: number;
  atk: number;
  /** この階層から出現する */
  minDepth: number;
  /** 出現の重み */
  weight: number;
}

export const MONSTERS: Record<MonsterKind, MonsterDef> = {
  rat: { name: 'ネズミ', hp: 3, atk: 1, minDepth: 1, weight: 5 },
  bat: { name: 'コウモリ', hp: 4, atk: 2, minDepth: 1, weight: 3 },
  goblin: { name: 'ゴブリン', hp: 6, atk: 2, minDepth: 2, weight: 4 },
  orc: { name: 'オーク', hp: 10, atk: 3, minDepth: 4, weight: 3 },
  troll: { name: 'トロル', hp: 16, atk: 5, minDepth: 6, weight: 2 },
  dragon: { name: 'ドラゴン', hp: 30, atk: 8, minDepth: 9, weight: 1 },
};

export function actorName(kind: ActorKind): string {
  return kind === 'player' ? 'あなた' : MONSTERS[kind].name;
}

export function createPlayer(x: number, y: number): Actor {
  return { id: 0, kind: 'player', x, y, hp: 20, maxHp: 20, atk: 4 };
}

export function spawnMonsters(
  rng: Rng,
  map: GameMap,
  depth: number,
  avoid: { x: number; y: number },
  nextId: () => number,
): Actor[] {
  const pool = (Object.keys(MONSTERS) as MonsterKind[]).filter((k) => MONSTERS[k].minDepth <= depth);
  const count = 3 + depth + rng.int(0, 2);
  const monsters: Actor[] = [];

  for (let i = 0; i < count; i++) {
    const kind = weightedPick(rng, pool);
    const pos = findSpot(rng, map, avoid, monsters);
    if (!pos) break;
    const def = MONSTERS[kind];
    const bonus = depth - def.minDepth;
    const hp = def.hp + bonus;
    monsters.push({
      id: nextId(),
      kind,
      x: pos.x,
      y: pos.y,
      hp,
      maxHp: hp,
      atk: def.atk + Math.floor(bonus / 3),
    });
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
