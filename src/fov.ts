import { blocksSight, idx, inBounds, type GameMap } from './map';

// 再帰シャドウキャスティング (8 象限)。
// 各象限を (xx, xy, yx, yy) の変換で第 1 象限に写して同じ処理を使う。
const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

/** visible を 0 で埋め直し、(ox, oy) から radius 以内で見える位置を 1 にする */
export function computeFov(map: GameMap, ox: number, oy: number, radius: number, visible: number[]): void {
  visible.fill(0);
  if (!inBounds(map, ox, oy)) return;
  visible[idx(map, ox, oy)] = 1;
  for (let oct = 0; oct < 8; oct++) {
    castLight(map, ox, oy, radius, visible, 1, 1.0, 0.0, MULT[0][oct], MULT[1][oct], MULT[2][oct], MULT[3][oct]);
  }
}

function castLight(
  map: GameMap,
  ox: number,
  oy: number,
  radius: number,
  visible: number[],
  row: number,
  start: number,
  end: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
): void {
  if (start < end) return;
  const r2 = radius * radius;
  let newStart = 0;
  let blocked = false;

  for (let dist = row; dist <= radius && !blocked; dist++) {
    const dy = -dist;
    for (let dx = -dist; dx <= 0; dx++) {
      const cx = ox + dx * xx + dy * xy;
      const cy = oy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (end > lSlope) break;

      const inside = inBounds(map, cx, cy);
      if (inside && dx * dx + dy * dy <= r2) {
        visible[idx(map, cx, cy)] = 1;
      }
      const opaque = !inside || blocksSight(map, cx, cy);

      if (blocked) {
        if (opaque) {
          newStart = rSlope;
          continue;
        }
        blocked = false;
        start = newStart;
      } else if (opaque && dist < radius) {
        blocked = true;
        castLight(map, ox, oy, radius, visible, dist + 1, start, lSlope, xx, xy, yx, yy);
        newStart = rSlope;
      }
    }
  }
}
