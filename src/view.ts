// 描画層に渡すデータ。
// 「何がどこにあるか」だけを持ち、文字・色・画像といった見た目は一切含めない。
// 見た目の割り当ては render/ 側の対応表 (glyphs.ts など) が受け持つ。
// これにより TextRenderer を TileRenderer に差し替えてもゲーム本体は変わらない。

import type { ActorKind } from './entity';

export type CellKind = 'wall' | 'floor' | 'stairs' | 'unknown';
export type Visibility = 'visible' | 'remembered' | 'unknown';

export interface ViewCell {
  kind: CellKind;
  vis: Visibility;
}

/** ログの分類。色分けは描画層が決める */
export type LogKind = 'player' | 'enemy' | 'info' | 'alert';

export interface LogEntry {
  text: string;
  kind: LogKind;
}

export interface ViewActor {
  kind: ActorKind;
  x: number;
  y: number;
}

export interface ViewModel {
  width: number;
  height: number;
  /** width * height。行優先 (index = y * width + x) */
  cells: ViewCell[];
  /** 今見えているアクターだけ。プレイヤーを含む */
  actors: ViewActor[];
  player: { x: number; y: number; hp: number; maxHp: number; atk: number };
  depth: number;
  turn: number;
  kills: number;
  seed: string;
  /** 古い順。描画層が末尾から必要な行数だけ使う */
  log: LogEntry[];
  gameOver: boolean;
}
