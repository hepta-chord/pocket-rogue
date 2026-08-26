import type { Action } from './game';

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

/** data-dir="dx,dy" を持つボタンを Action に変換する。"0,0" は待機 */
export function bindButtons(root: HTMLElement, onAction: (a: Action) => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach((btn) => {
    const [dx, dy] = (btn.dataset.dir ?? '0,0').split(',').map(Number);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (dx === 0 && dy === 0) onAction({ type: 'wait' });
      else onAction({ type: 'move', dx, dy });
    });
  });
}
