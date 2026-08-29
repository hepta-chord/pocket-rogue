// 敵の移動の決め方。
//
// プレイヤーからの距離場を 1 枚作り、各個体はそれを下る。
// 寄れるマスがすべて塞がっているときだけ、同じ距離のマスへ横にずれることを許す。
//
// 席の予約表は持たない。地形の違いだけで挙動が分かれるためである。
// 部屋では同じ距離のマスが周囲に多いので散って囲み、
// 通路では横が壁で塞がるので列のまま止まる。

import { canStep, idx, isWalkable, type GameMap } from './map';
import type { Rng } from './rng';

export interface Pos {
  x: number;
  y: number;
}

/**
 * from からの歩数。canStep の規則で辿れないマスは -1 のまま残る。
 *
 * 敵は障害物として扱わない。扱うと 1 体動くたびに作り直しになるためで、
 * 塞がっているかどうかは 1 歩を選ぶ時点で見る。
 */
export function distanceField(map: GameMap, from: Pos): Int32Array {
  const dist = new Int32Array(map.width * map.height).fill(-1);
  if (!isWalkable(map, from.x, from.y)) return dist;

  const queue = [idx(map, from.x, from.y)];
  dist[queue[0]] = 0;

  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const cx = i % map.width;
    const cy = Math.floor(i / map.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!canStep(map, cx, cy, dx, dy)) continue;
        const ni = idx(map, cx + dx, cy + dy);
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[i] + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}

/** 歩ける隣接マスが 2 以下なら隘路。通路の中や入口を指す */
export function isChoke(map: GameMap, x: number, y: number): boolean {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (canStep(map, x, y, dx, dy)) n++;
      if (n > 2) return false;
    }
  }
  return true;
}

export interface StepContext {
  map: GameMap;
  player: Pos;
  /** プレイヤーからの距離場 */
  field: Int32Array;
  /** そのマスが埋まっているか (プレイヤーと他の敵) */
  occupied: (x: number, y: number) => boolean;
  rng: Rng;
}

interface Candidate {
  x: number;
  y: number;
  d: number;
  /** プレイヤー方向との近さ。同点のときの選び分けに使う */
  toward: number;
}

/**
 * 1 歩の行き先を返す。動かないときは null。
 *
 * 1. 距離が減るマスがあれば、そこへ動く
 * 2. 隘路にいるなら動かない (通路で列を作るのが正しい)
 * 3. 距離が同じマスがあれば、プレイヤーの隣に接しているものを優先して横にずれる
 */
export function chooseStep(ctx: StepContext, from: Pos, erratic: boolean): Pos | null {
  const { map, field, occupied, rng } = ctx;
  const here = field[idx(map, from.x, from.y)];
  if (here < 0) return null;

  const sx = Math.sign(ctx.player.x - from.x);
  const sy = Math.sign(ctx.player.y - from.y);

  const down: Candidate[] = [];
  const side: Candidate[] = [];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!canStep(map, from.x, from.y, dx, dy)) continue;
      const nx = from.x + dx;
      const ny = from.y + dy;
      if (occupied(nx, ny)) continue;
      const d = field[idx(map, nx, ny)];
      if (d < 0) continue;
      const cand: Candidate = { x: nx, y: ny, d, toward: (dx === sx ? 1 : 0) + (dy === sy ? 1 : 0) };
      if (d < here) down.push(cand);
      else if (d === here) side.push(cand);
    }
  }

  if (down.length > 0) {
    // ふらつきは「最短ではない寄り方」に置き換える。方向を丸ごと乱数にすると距離場と噛み合わない
    if (erratic && down.length > 1 && rng.chance(0.5)) {
      return pick(rng, worst(down));
    }
    return pick(rng, best(down));
  }

  // 通路では下がらず、後ろで待つ
  if (isChoke(map, from.x, from.y)) return null;

  if (side.length > 0) {
    const seats = side.filter((c) => touchesSeat(ctx, c));
    return pick(rng, seats.length > 0 ? seats : side);
  }
  return null;
}

/** そのマスがプレイヤーの隣 (距離 1) に接しているか。回り込む先として優先する */
function touchesSeat(ctx: StepContext, c: Candidate): boolean {
  const { map, field } = ctx;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!canStep(map, c.x, c.y, dx, dy)) continue;
      if (field[idx(map, c.x + dx, c.y + dy)] === 1) return true;
    }
  }
  return false;
}

function best(cs: Candidate[]): Candidate[] {
  const d = Math.min(...cs.map((c) => c.d));
  const near = cs.filter((c) => c.d === d);
  const t = Math.max(...near.map((c) => c.toward));
  return near.filter((c) => c.toward === t);
}

function worst(cs: Candidate[]): Candidate[] {
  const t = Math.min(...cs.map((c) => c.toward));
  return cs.filter((c) => c.toward === t);
}

function pick(rng: Rng, cs: Candidate[]): Pos {
  const c = cs.length === 1 ? cs[0] : rng.pick(cs);
  return { x: c.x, y: c.y };
}
