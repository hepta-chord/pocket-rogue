import { SAVE_VERSION, type GameState } from './game';
import { emptyInventory } from './items';
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
    const parsed = JSON.parse(raw) as RawSave;
    if (!parsed.map || !parsed.player) return null;
    migrate(parsed);
    if (parsed.version !== SAVE_VERSION) return null;
    return parsed as unknown as GameState;
  } catch {
    return null;
  }
}

/** 形式を問わず読み込むための緩い型。migrate で現在の形式に揃える */
interface RawSave {
  version?: number;
  map?: unknown;
  player?: unknown;
  log?: unknown[];
  items?: unknown;
  inventory?: unknown;
  weapon?: unknown;
  armor?: unknown;
  level?: unknown;
  xp?: unknown;
  score?: unknown;
  recorded?: unknown;
  depth?: unknown;
}

/** 古い形式のセーブを現在の形式に直す。直せないものは version を変えずに返し、呼び出し側で捨てる */
function migrate(data: RawSave): void {
  if (data.version === 1) {
    // v1: log は string[] だった。分類なしの info として読み込む
    data.log = (data.log ?? []).map((l): LogEntry => (typeof l === 'string' ? { text: l, kind: 'info' } : (l as LogEntry)));
    data.version = 2;
  }
  if (data.version === 2) {
    // v2: アイテムが無かった。空の状態で足す (その階の床アイテムは次の階から出る)
    data.items = [];
    data.inventory = emptyInventory();
    data.weapon = 0;
    data.armor = 0;
    data.version = 3;
  }
  if (data.version === 3) {
    // v3: 経験値とスコアが無かった。レベル 1 から始め、到達済みの階ぶんだけスコアを与える
    const depth = typeof data.depth === 'number' ? data.depth : 1;
    data.level = 1;
    data.xp = 0;
    data.score = ((depth * (depth + 1)) / 2) * 20;
    data.recorded = false;
    data.version = 4;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 無視 */
  }
}
