import './style.css';
import { newGame, step, toViewModel, visibleMonsters, type Action, type GameState } from './game';
import { bestScore, loadScores, submitScore, today, type ScoreEntry } from './highscore';
import { bindButtons, bindKeyboard, bindSlots } from './input';
import type { Renderer } from './render/renderer';
import { TextRenderer } from './render/text-renderer';
import { normalizeSeed, randomSeedString } from './rng';
import { loadGame, saveGame } from './save';
import type { ViewModel } from './view';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('game');
// 描画層はここで 1 つ選んで差し込む。タイル描画にするときはこの 1 行を替える
const renderer: Renderer = new TextRenderer(canvas);

const menu = byId<HTMLDialogElement>('menu');
const gameover = byId<HTMLDialogElement>('gameover');
const scores = byId<HTMLDialogElement>('scores');
const seedInput = byId<HTMLInputElement>('seed-input');
const slotButtons = Array.from(byId('slots').querySelectorAll<HTMLButtonElement>('[data-item]'));

let state: GameState = loadGame() ?? newGame(randomSeedString());

// ---------------------------------------------------------------------------
// 描画

function renderSlots(vm: ViewModel): void {
  for (const btn of slotButtons) {
    const entry = vm.inventory.find((e) => e.kind === btn.dataset.item);
    const count = entry?.count ?? 0;
    const countEl = btn.querySelector('.count');
    if (countEl) countEl.textContent = String(count);
    btn.disabled = count === 0 || vm.gameOver;
  }
}

function render(): void {
  const vm = toViewModel(state);
  renderer.draw(vm);
  renderSlots(vm);
}

// ---------------------------------------------------------------------------
// 進行

/**
 * 1 手進めて描画する。
 * 戻り値は「長押しの連続移動を続けてよいか」。
 * 壁にぶつかった・敵が見えている・ダメージを受けた・アイテムを拾った・階を降りた・倒れた、のどれかで false。
 */
function act(action: Action): boolean {
  const hpBefore = state.player.hp;
  const result = step(state, action);
  if (state.over && !state.recorded) finishRun();
  saveGame(state);
  render();
  return (
    result.acted &&
    !result.interrupt &&
    !state.over &&
    state.player.hp >= hpBefore &&
    visibleMonsters(state).length === 0
  );
}

function startGame(seed: string): void {
  state = newGame(seed);
  saveGame(state);
  render();
}

/** 死んだときに 1 回だけ呼ぶ。記録して結果を出す */
function finishRun(): void {
  state.recorded = true;
  const entry: ScoreEntry = {
    score: state.score,
    depth: state.depth,
    kills: state.kills,
    level: state.level,
    seed: state.seed,
    date: today(),
  };
  const best = bestScore();
  const { rank } = submitScore(entry);

  byId('go-score').textContent = String(entry.score);
  byId('go-detail').innerHTML = '';
  const detail = [
    `到達 B${entry.depth}`,
    `レベル ${entry.level}`,
    `${entry.kills} 体撃破`,
    `seed ${entry.seed}`,
    `自己最高 ${Math.max(best, entry.score)} 点`,
  ];
  for (const text of detail) {
    const li = document.createElement('li');
    li.textContent = text;
    byId('go-detail').append(li);
  }

  const rankEl = byId('go-rank');
  if (rank === 1 && entry.score > best) rankEl.textContent = '新記録です';
  else if (rank !== null) rankEl.textContent = `ハイスコア ${rank} 位に入りました`;
  else rankEl.textContent = '';

  gameover.showModal();
}

// ---------------------------------------------------------------------------
// ハイスコア一覧

function showScores(): void {
  const list = byId('score-list');
  list.innerHTML = '';
  const entries = loadScores();

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'まだ記録がありません。';
    list.append(li);
  }

  entries.forEach((e, i) => {
    const li = document.createElement('li');

    const no = document.createElement('span');
    no.className = 'no';
    no.textContent = `${i + 1}`;

    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = String(e.score);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `B${e.depth} LV${e.level} ${e.kills}体 ${e.date}`;

    const seed = document.createElement('button');
    seed.type = 'button';
    seed.className = 'seed';
    seed.textContent = e.seed;
    seed.addEventListener('click', () => {
      startGame(e.seed);
      scores.close();
      gameover.close();
      menu.close();
    });

    li.append(no, pts, meta, seed);
    list.append(li);
  });

  scores.showModal();
}

// ---------------------------------------------------------------------------
// メニュー

byId('menu-btn').addEventListener('click', () => {
  seedInput.value = state.seed;
  menu.showModal();
});
byId('seed-random').addEventListener('click', () => {
  seedInput.value = randomSeedString();
});
byId('seed-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(seedInput.value);
  } catch {
    seedInput.select();
  }
});
byId('new-game').addEventListener('click', () => {
  startGame(normalizeSeed(seedInput.value) || randomSeedString());
  menu.close();
});
byId('menu-scores').addEventListener('click', () => {
  menu.close();
  showScores();
});
byId('menu-close').addEventListener('click', () => menu.close());

byId('go-retry').addEventListener('click', () => {
  startGame(state.seed);
  gameover.close();
});
byId('go-new').addEventListener('click', () => {
  startGame(randomSeedString());
  gameover.close();
});
byId('go-scores').addEventListener('click', () => {
  gameover.close();
  showScores();
});
byId('go-close').addEventListener('click', () => gameover.close());
byId('scores-close').addEventListener('click', () => scores.close());

// ---------------------------------------------------------------------------
// 入力

const dialogOpen = (): boolean => menu.open || gameover.open || scores.open;

bindKeyboard(act, dialogOpen);
bindButtons(byId('pad'), act);
bindSlots(byId('slots'), (item) => act({ type: 'use', item }));

// ---------------------------------------------------------------------------
// 画面サイズ

window.addEventListener('resize', () => renderer.resize());
window.visualViewport?.addEventListener('resize', () => renderer.resize());

render();

// --- オフライン対応 (本番ビルドのみ) ---
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 登録できなくてもオンラインでは遊べる */
    });
  });
}
