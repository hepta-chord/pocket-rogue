// 休憩床の定義と配置。
//
// かつては緑・黄・赤のイベント床もあり、ボーナスに低確率でマイナスが乗る形だった。
// そのマイナス側 (毒気・装備の弱化・スタミナ減少など) は見えない罠 (traps.ts) と
// ほぼ同じ骨格だったので、そちらに一本化した。見えるイベントとして残すのは、
// HP とスタミナを立て直す休憩床だけである。
//
// 各階に必ず 1 つ置いていたのをやめ、REST_SPAN 階ごとに 1 つだけ置く。
// 常にどこかにあると回復が前提の難易度になり、置かない階との差も付かない。

import { randomFloorTile, type GameMap } from './map';
import type { Rng } from './rng';

export interface FloorTile {
  x: number;
  y: number;
}

/** 休憩床を置く間隔 (階) */
export const REST_SPAN = 5;

/** 休憩で戻るスタミナの量 */
export const REST_STAMINA = 50;

/** この階に休憩床があるか */
export function isRestFloor(depth: number): boolean {
  return depth % REST_SPAN === 0;
}

/** 階ごとの配置。REST_SPAN の倍数の階にだけ 1 つ置く */
export function spawnFloors(
  rng: Rng,
  map: GameMap,
  depth: number,
  start: { x: number; y: number },
  taken: { x: number; y: number }[],
): FloorTile[] {
  if (!isRestFloor(depth)) return [];

  for (let tries = 0; tries < 60; tries++) {
    const at = randomFloorTile(rng, map);
    if (!at) break;
    if (at.x === start.x && at.y === start.y) continue;
    if (taken.some((o) => o.x === at.x && o.y === at.y)) continue;
    return [{ x: at.x, y: at.y }];
  }
  return [];
}
