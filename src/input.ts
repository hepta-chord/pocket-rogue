import type { Action } from './game';
import type { ConsumableKind } from './items';

// キーボードと画面ボタンを同じ Action に揃える。

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  k: [0, -1],
  j: [0, 1],
  h: [-1, 0],
  l: [1, 0],
  y: [-1, -1],
  u: [1, -1],
  b: [-1, 1],
  n: [1, 1],
  Numpad8: [0, -1],
  Numpad2: [0, 1],
  Numpad4: [-1, 0],
  Numpad6: [1, 0],
  Numpad7: [-1, -1],
  Numpad9: [1, -1],
  Numpad1: [-1, 1],
  Numpad3: [1, 1],
  Home: [-1, -1],
  PageUp: [1, -1],
  End: [-1, 1],
  PageDown: [1, 1],
};

const WAIT_KEYS = new Set(['.', ' ', 'Numpad5', 'Clear']);

export function bindKeyboard(onAction: (a: Action) => void, isBlocked: () => boolean): void {
  window.addEventListener('keydown', (e) => {
    if (isBlocked()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const dir = KEY_DIRS[e.key] ?? KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      onAction({ type: 'move', dx: dir[0], dy: dir[1] });
      return;
    }
    if (WAIT_KEYS.has(e.key) || WAIT_KEYS.has(e.code)) {
      e.preventDefault();
      onAction({ type: 'wait' });
    }
  });
}

/** 長押しと判定するまでの時間と、連続移動の間隔 (ms) */
const HOLD_DELAY = 350;
const REPEAT_INTERVAL = 110;

/**
 * data-dir="dx,dy" を持つボタンを Action に変換する。"0,0" は待機。
 * 押した瞬間に 1 回、押し続けると一定間隔で繰り返す。
 * onAction が false を返したら (壁・敵の出現・被弾など) 繰り返しを止める。
 */
export function bindButtons(root: HTMLElement, onAction: (a: Action) => boolean): void {
  root.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((btn) => {
    const [dx, dy] = (btn.dataset.dir ?? '0,0').split(',').map(Number);
    const action: Action = dx === 0 && dy === 0 ? { type: 'wait' } : { type: 'move', dx, dy };
    let holdTimer: number | null = null;
    let repeatTimer: number | null = null;

    const stop = (): void => {
      if (holdTimer !== null) window.clearTimeout(holdTimer);
      if (repeatTimer !== null) window.clearInterval(repeatTimer);
      holdTimer = null;
      repeatTimer = null;
      btn.classList.remove('holding');
    };

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      stop();
      btn.setPointerCapture(e.pointerId);
      if (!onAction(action)) return;
      holdTimer = window.setTimeout(() => {
        btn.classList.add('holding');
        repeatTimer = window.setInterval(() => {
          if (!onAction(action)) stop();
        }, REPEAT_INTERVAL);
      }, HOLD_DELAY);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      btn.addEventListener(ev, stop);
    }
    // 長押しでコンテキストメニューやテキスト選択が出ないようにする
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

/** data-item="<ConsumableKind>" を持つスロットボタン。タップで即使用 */
export function bindSlots(root: HTMLElement, onUse: (kind: ConsumableKind) => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((btn) => {
    const kind = btn.dataset.item as ConsumableKind;
    btn.addEventListener('click', () => onUse(kind));
  });
}
