// ダメージの計算式。
//
// プレイヤーと敵で同じ関数を使い、攻める側と守る側の扱いを対称にする。
// 数値の調整はここと呼び出し側の定数だけで済むようにしてある。

import type { Rng } from './rng';

/** 攻撃の出目の下限。プレイヤーは最大値の 6 割、敵は 5 割から振る */
export const PLAYER_ROLL_FLOOR = 0.6;
export const MONSTER_ROLL_FLOOR = 0.5;

/**
 * 防御で軽減しきれずに必ず通る割合の逆数。4 なら出目の 1/4 は必ず通る。
 *
 * 1 ダメージに潰れる被弾が多いので 3 も試したが、深層が成立しなくなった。
 * 出目そのものが小さい序盤では 1 が 2 になるだけだが、深い階では
 * 避けられないダメージが 1.5 倍になり、被弾回数の多さと掛け算になる。
 * 200 run で B20 到達率が 25% から 11% に落ちたので 4 に戻した。
 *
 * 1 ダメージが多いこと自体は、出目の小ささが原因である。
 * 直すなら軽減の下限ではなく、序盤の攻撃力の側で調整する。
 */
export const DAMAGE_FLOOR_DIV = 4;

/**
 * 攻撃の出目を振る。
 *
 * 1 から最大値までの一様乱数だと、平均が最大値の半分にしかならないうえ分散が大きい。
 * 防御側に軽減が入ると下限が潰れて 1 ダメージが連発し、会心が出たのか上振れたのかも区別できない。
 * 下限を最大値に比例させて、引きではなく数値の差が結果に出るようにする。
 */
export function rollDamage(rng: Rng, power: number, lowRatio: number): number {
  const max = Math.max(1, Math.floor(power));
  const min = Math.min(max, Math.max(1, Math.ceil(max * lowRatio)));
  return rng.int(min, max);
}

/**
 * 防御で軽減する。
 *
 * 減算だけだと、防御の数値が相手の攻撃力に追いつくと軽減率が 100% に張り付く。
 * 出目の 1/4 は必ず通る下限を置いて、軽減そのものに上限を作る。
 */
export function applyDefense(roll: number, def: number): number {
  return Math.max(Math.ceil(roll / DAMAGE_FLOOR_DIV), roll - Math.max(0, def));
}

/** 攻撃 1 回ぶんの出目と通ったダメージ */
export interface Hit {
  roll: number;
  dealt: number;
}

/** 攻める側の攻撃力と守る側の防御力から 1 回ぶんを決める。pierce なら防御を無視する */
export function strike(
  rng: Rng,
  power: number,
  def: number,
  lowRatio: number,
  pierce = false,
): Hit {
  const roll = rollDamage(rng, power, lowRatio);
  return { roll, dealt: pierce ? roll : applyDefense(roll, def) };
}
