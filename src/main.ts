import './style.css';
import { newGame, step, toViewModel, visibleMonsterCount, type Action, type GameState } from './game';
import { bindButtons, bindKeyboard } from './input';
import type { Renderer } from './render/renderer';
import { TextRenderer } from './render/text-renderer';
import { normalizeSeed, randomSeedString } from './rng';
import { loadGame, saveGame } from './save';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

const canvas = byId<HTMLCanvasElement>('game');
// 描画層はここで 1 つ選んで差し込む。タイル描画にするときはこの 1 行を替える
const renderer: Renderer = new TextRenderer(canvas);

let state: GameState = loadGame() ?? newGame(randomSeedString());

function render(): void {
  renderer.draw(toViewModel(state));
}

/**
 * 1 手進めて描画する。
 * 戻り値は「長押しの連続移動を続けてよいか」。
 * 壁にぶつかった・敵が見えている・ダメージを受けた・階を降りた・倒れた、のどれかで false。
 */
function act(action: Action): boolean {
  const hpBefore = state.player.hp;
  const depthBefore = state.depth;
  const result = step(state, action);
  saveGame(state);
  render();
  return (
    result.acted &&
    !state.over &&
    state.depth === depthBefore &&
    state.player.hp >= hpBefore &&
    visibleMonsterCount(state) === 0
  );
}

// --- メニュー (seed の表示・入力・新しいゲーム) ---
const menu = byId<HTMLDialogElement>('menu');
const seedInput = byId<HTMLInputElement>('seed-input');

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
  const seed = normalizeSeed(seedInput.value) || randomSeedString();
  state = newGame(seed);
  saveGame(state);
  render();
  menu.close();
});
byId('menu-close').addEventListener('click', () => menu.close());

// --- 入力 ---
bindKeyboard(act, () => menu.open);
bindButtons(byId('pad'), act);

// --- 画面サイズ ---
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
