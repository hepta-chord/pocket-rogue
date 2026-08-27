import type { ViewModel } from '../view';
import {
  CELL_GLYPHS,
  COLORS,
  FONT_STACK,
  ITEM_GLYPHS,
  LOG_COLORS,
  LOG_OLD_ALPHA,
  REMEMBERED_ALPHA,
  actorGlyph,
} from './glyphs';
import type { Renderer } from './renderer';

const HUD_ROWS = 2;
const LOG_ROWS = 3;
const TARGET_COLS = 21;
const MIN_CELL = 12;
const MAX_CELL = 32;

/** Canvas に等幅フォントで文字グリッドを描く */
export class TextRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cell = 20;
  private cols = 0;
  private rows = 0;
  private camX = 0;
  private camY = 0;
  private lastVm: ViewModel | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context が取得できません');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 横 21 セル前後を目標にしつつ、縦にも HUD + マップ 8 行 + ログが入る大きさに抑える
    const byWidth = rect.width / TARGET_COLS;
    const byHeight = rect.height / (HUD_ROWS + 8 + LOG_ROWS);
    this.cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(byWidth, byHeight))));
    this.cols = Math.max(1, Math.floor(rect.width / this.cell));
    this.rows = Math.max(1, Math.floor(rect.height / this.cell) - HUD_ROWS - LOG_ROWS);

    if (this.lastVm) this.draw(this.lastVm);
  }

  draw(vm: ViewModel): void {
    this.lastVm = vm;
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = COLORS.bg;
    this.ctx.fillRect(0, 0, rect.width, rect.height);

    this.updateCamera(vm);
    this.drawMap(vm);
    this.drawHud(vm, rect.width);
    this.drawLog(vm, rect.height);
    if (vm.gameOver) this.drawGameOver(vm, rect.width, rect.height);
  }

  cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top - HUD_ROWS * this.cell;
    const sx = Math.floor(px / this.cell);
    const sy = Math.floor(py / this.cell);
    if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) return null;
    return { x: this.camX + sx, y: this.camY + sy };
  }

  private updateCamera(vm: ViewModel): void {
    // プレイヤーを中央に置き、マップの端では止める。マップが画面より小さければ中央寄せ
    this.camX =
      vm.width <= this.cols
        ? -Math.floor((this.cols - vm.width) / 2)
        : clamp(vm.player.x - Math.floor(this.cols / 2), 0, vm.width - this.cols);
    this.camY =
      vm.height <= this.rows
        ? -Math.floor((this.rows - vm.height) / 2)
        : clamp(vm.player.y - Math.floor(this.rows / 2), 0, vm.height - this.rows);
  }

  private drawMap(vm: ViewModel): void {
    const { ctx, cell } = this;
    const top = HUD_ROWS * cell;
    ctx.font = `${Math.floor(cell * 0.85)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let sy = 0; sy < this.rows; sy++) {
      const my = this.camY + sy;
      if (my < 0 || my >= vm.height) continue;
      for (let sx = 0; sx < this.cols; sx++) {
        const mx = this.camX + sx;
        if (mx < 0 || mx >= vm.width) continue;
        const c = vm.cells[my * vm.width + mx];
        if (c.vis === 'unknown') continue;
        const g = CELL_GLYPHS[c.kind];
        ctx.globalAlpha = c.vis === 'visible' ? 1 : REMEMBERED_ALPHA;
        ctx.fillStyle = g.fg;
        ctx.fillText(g.ch, sx * cell + cell / 2, top + sy * cell + cell / 2);
      }
    }
    ctx.globalAlpha = 1;

    for (const it of vm.items) {
      const sx = it.x - this.camX;
      const sy = it.y - this.camY;
      if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) continue;
      const g = ITEM_GLYPHS[it.kind];
      const vis = vm.cells[it.y * vm.width + it.x].vis;
      ctx.globalAlpha = vis === 'visible' ? 1 : REMEMBERED_ALPHA;
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(sx * cell, top + sy * cell, cell, cell);
      ctx.fillStyle = g.fg;
      ctx.fillText(g.ch, sx * cell + cell / 2, top + sy * cell + cell / 2);
    }
    ctx.globalAlpha = 1;

    for (const a of vm.actors) {
      const sx = a.x - this.camX;
      const sy = a.y - this.camY;
      if (sx < 0 || sy < 0 || sx >= this.cols || sy >= this.rows) continue;
      const g = actorGlyph(a.kind, a.health);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(sx * cell, top + sy * cell, cell, cell);
      ctx.fillStyle = g.fg;
      ctx.fillText(g.ch, sx * cell + cell / 2, top + sy * cell + cell / 2);
    }
  }

  private drawHud(vm: ViewModel, width: number): void {
    const { ctx, cell } = this;
    const size = Math.floor(cell * 0.55);
    ctx.font = `${size}px ${FONT_STACK}`;
    ctx.textBaseline = 'middle';
    const { hp, maxHp, atk, def, level, xp, xpNext } = vm.player;

    this.drawSegments(
      [
        { text: `B${vm.depth}`, color: COLORS.hud },
        { text: `LV${level}`, color: COLORS.hud },
        { text: `HP ${hp}/${maxHp}`, color: hp <= maxHp * 0.3 ? COLORS.hpLow : COLORS.hud },
      ],
      cell * 0.5,
      size,
    );
    this.drawSegments(
      [
        { text: `ATK ${atk}`, color: COLORS.hudDim },
        { text: `DEF ${def}`, color: COLORS.hudDim },
        { text: `XP ${xp}/${xpNext}`, color: COLORS.hudDim },
      ],
      cell * 1.5,
      size,
    );

    // スコアは右端に置く。1 行目と 2 行目にまたがらないよう 1 行目の右へ
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.hud;
    ctx.fillText(`${vm.score}`, width - 54, cell * 0.5);
    ctx.fillStyle = COLORS.hudDim;
    ctx.fillText(`T${vm.turn}`, width - 54, cell * 1.5);
  }

  /** 左から順に、実測幅ぶんずつずらして描く (項目が重ならないようにする) */
  private drawSegments(segs: { text: string; color: string }[], y: number, size: number): void {
    const { ctx } = this;
    ctx.textAlign = 'left';
    let x = 6;
    for (const s of segs) {
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, x, y);
      x += ctx.measureText(s.text).width + size;
    }
  }

  /**
   * ログを描く。
   *
   * 見えるのは 3 行しかないので、ターンの切れ目に区切り線を入れると情報が 2 行に減る。
   * 代わりに減光の単位を行からターンに変え、最新ターンの行だけを明るくする。
   * 行数を使わずに「どこまでが今の 1 手の結果か」が読める。
   */
  private drawLog(vm: ViewModel, height: number): void {
    const { ctx, cell } = this;
    const size = Math.floor(cell * 0.6);
    ctx.font = `${size}px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const lines = vm.log.slice(-LOG_ROWS);
    const latest = lines.length > 0 ? lines[lines.length - 1].turn : 0;
    const base = height - LOG_ROWS * cell;
    for (let i = 0; i < lines.length; i++) {
      ctx.globalAlpha = lines[i].turn === latest ? 1 : LOG_OLD_ALPHA;
      ctx.fillStyle = LOG_COLORS[lines[i].kind];
      ctx.fillText(lines[i].text, 6, base + i * cell + cell / 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawGameOver(vm: ViewModel, width: number, height: number): void {
    const { ctx, cell } = this;
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = height / 2;
    ctx.fillStyle = COLORS.hpLow;
    ctx.font = `bold ${Math.floor(cell * 1.2)}px ${FONT_STACK}`;
    ctx.fillText('ゲームオーバー', width / 2, cy - cell * 2.4);
    ctx.fillStyle = COLORS.hud;
    ctx.font = `bold ${Math.floor(cell * 1.6)}px ${FONT_STACK}`;
    ctx.fillText(`${vm.score}`, width / 2, cy - cell * 0.6);
    ctx.font = `${Math.floor(cell * 0.75)}px ${FONT_STACK}`;
    ctx.fillText(`B${vm.depth}  LV${vm.player.level}  ${vm.kills} 体撃破`, width / 2, cy + cell * 0.8);
    ctx.fillStyle = COLORS.hudDim;
    ctx.font = `${Math.floor(cell * 0.65)}px ${FONT_STACK}`;
    ctx.fillText(`seed: ${vm.seed}`, width / 2, cy + cell * 2);
    ctx.fillText('右上の ≡ から新しいゲーム', width / 2, cy + cell * 3.2);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
