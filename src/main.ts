import './style.css';
import { addLog, newGame, step, toViewModel, visibleMonsters, type Action, type GameState } from './game';
import { bestScore, loadScores, submitScore, today, type ScoreEntry } from './highscore';
import { bindButtons, bindKeyboard } from './input';
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
const confirm = byId<HTMLDialogElement>('confirm');
const seedInput = byId<HTMLInputElement>('seed-input');

const loaded = loadGame();
let state: GameState = loaded.state ?? newGame(randomSeedString());
if (loaded.discarded) addLog(state, 'info', '前のセーブは形式が古いので読めなかった。新しく始める。');

// ---------------------------------------------------------------------------
// 描画

/**
 * 画面下のスロットを ViewModel から組み立てる。
 * 何を並べるかはゲーム側が決めるので、消耗品が魔法に置き換わっても HTML は触らない。
 */
function renderSlots(vm: ViewModel): void {
  const root = byId('slots');
  // 並びが変わったときだけ作り直し、ふだんは中身の更新で済ませる
  const signature = vm.slots.map((s) => `${s.ref.kind}:${s.ref.id}`).join(',');
  if (root.dataset.signature !== signature) {
    root.innerHTML = '';
    root.dataset.signature = signature;
    for (const slot of vm.slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.append(
        span('glyph ' + (slot.ref.kind === 'spell' ? 'spell' : slot.ref.id), slot.ref.kind === 'spell' ? '*' : '!'),
        span('name', slot.label),
        span('badge ' + (slot.ref.kind === 'spell' ? 'cost' : 'count'), slot.badge),
      );
      btn.addEventListener('click', () => {
        act(slot.ref.kind === 'item' ? { type: 'use', item: slot.ref.id } : { type: 'cast', spell: slot.ref.id });
      });
      root.append(btn);
    }
  }

  const buttons = Array.from(root.querySelectorAll('button'));
  vm.slots.forEach((slot, i) => {
    const btn = buttons[i];
    if (!btn) return;
    btn.disabled = !slot.enabled;
    btn.setAttribute('aria-label', `${slot.label} を使う`);
    const badge = btn.querySelector('.badge');
    if (badge) badge.textContent = slot.badge;
  });
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * 確認プロンプトの表示を状態に合わせる。
 * 文面はゲーム側が組み立てたものをそのまま出す。
 */
function renderPrompt(vm: ViewModel): void {
  if (!vm.prompt) {
    if (confirm.open) confirm.close();
    return;
  }
  byId('confirm-text').textContent = vm.prompt.text;
  byId('confirm-yes').textContent = vm.prompt.confirm;
  byId('confirm-no').textContent = vm.prompt.cancel;
  if (!confirm.open) confirm.showModal();
}

function render(): void {
  const vm = toViewModel(state);
  renderer.draw(vm);
  renderSlots(vm);
  renderPrompt(vm);
}

let hitTimer: number | null = null;

/** 被弾を画面全体の短い赤で知らせる */
function flashHit(): void {
  const app = byId('app');
  app.classList.remove('hit');
  // クラスを外して付け直すだけでは同じアニメーションが再生されないので、レイアウトを 1 回読む
  void app.offsetWidth;
  app.classList.add('hit');
  if (hitTimer !== null) window.clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => app.classList.remove('hit'), 200);
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
  if (state.player.hp < hpBefore) flashHit();
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
  byId('go-title').textContent = state.cleared ? 'クリア' : 'ゲームオーバー';
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
  const vm = toViewModel(state);
  byId('menu-equip').textContent = `${vm.player.weaponDetail}
${vm.player.armorDetail}`;
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
byId('confirm-yes').addEventListener('click', () => act({ type: 'confirm' }));
byId('confirm-no').addEventListener('click', () => act({ type: 'cancel' }));
// Esc で閉じたときも取り消し扱いにする (プロンプトが残ったまま操作不能にならないようにする)
confirm.addEventListener('cancel', (e) => {
  e.preventDefault();
  act({ type: 'cancel' });
});

byId('go-close').addEventListener('click', () => gameover.close());
byId('scores-close').addEventListener('click', () => scores.close());

// ---------------------------------------------------------------------------
// 入力

const dialogOpen = (): boolean => menu.open || gameover.open || scores.open || confirm.open;

bindKeyboard(act, dialogOpen);
bindButtons(byId('pad'), act);

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
