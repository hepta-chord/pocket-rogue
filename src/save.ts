import { SAVE_VERSION, type GameState } from './game';
import type { LogEntry } from './view';

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
    const parsed = JSON.parse(raw) as Partial<GameState> & { version?: number; log?: unknown[] };
    if (!parsed.map || !parsed.player) return null;
    migrate(parsed);
    if (parsed.version !== SAVE_VERSION) return null;
    return parsed as GameState;
  } catch {
    return null;
  }
}

/** 古い形式のセーブを現在の形式に直す。直せないものは version を変えずに返し、呼び出し側で捨てる */
function migrate(data: { version?: number; log?: unknown[] }): void {
  if (data.version === 1) {
    // v1: log は string[] だった。分類なしの info として読み込む
    data.log = (data.log ?? []).map((l): LogEntry => (typeof l === 'string' ? { text: l, kind: 'info' } : (l as LogEntry)));
    data.version = 2;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 無視 */
  }
}
