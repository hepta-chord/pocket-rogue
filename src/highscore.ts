// ハイスコアの記録。
// ゲームの状態 (GameState) とは別の localStorage キーに持つ。
// 日付を含むためゲームロジックからは切り離してあり、書き込むのは main.ts だけである
// (game.ts に Date を持ち込むと seed からの再現性が崩れる)。

export interface ScoreEntry {
  score: number;
  depth: number;
  kills: number;
  level: number;
  seed: string;
  /** YYYY-MM-DD */
  date: string;
}

const KEY = 'pocket-rogue/highscores/v1';
export const MAX_ENTRIES = 5;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** 上位 5 件に入れば保存する。戻り値の rank は 1 始まり。入らなければ null */
export function submitScore(entry: ScoreEntry): { rank: number | null; scores: ScoreEntry[] } {
  const scores = loadScores();
  // 同点なら既存の記録を上に置く (後から並んだものが上に来ないように)
  const merged = [...scores, entry].sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
  const index = merged.indexOf(entry);
  if (index >= 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* 保存できなくても結果の表示は続ける */
    }
  }
  return { rank: index >= 0 ? index + 1 : null, scores: merged };
}

export function bestScore(): number {
  return loadScores()[0]?.score ?? 0;
}

/** 今日の日付を YYYY-MM-DD で返す (ローカル時刻) */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isEntry(v: unknown): v is ScoreEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<ScoreEntry>;
  return typeof e.score === 'number' && typeof e.depth === 'number' && typeof e.seed === 'string';
}
