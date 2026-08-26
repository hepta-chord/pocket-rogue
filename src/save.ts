import type { GameState } from './game';

const KEY = 'pocket-rogue/save/v1';

// localStorage が使えない環境 (プライベートブラウズなど) でも落ちないように、失敗は握りつぶす。

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 保存できなくてもゲームは続ける */
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (parsed.version !== 1 || !parsed.map || !parsed.player) return null;
    return parsed as GameState;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 無視 */
  }
}
