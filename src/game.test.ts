import { describe, expect, it } from 'vitest';
import { SPELLS, canCast, newGame, step, toViewModel, xpToNext, type Action, type GameState } from './game';
import { stackLimit, type Item } from './items';
import { Tile, isWalkable, tileAt } from './map';

function play(seed: string, actions: Action[]): GameState {
  const state = newGame(seed);
  for (const a of actions) step(state, a);
  return state;
}

const WAIT: Action = { type: 'wait' };

describe('newGame', () => {
  it('B1 から始まり、歩ける場所に立っている', () => {
    const s = newGame('START1');
    expect(s.depth).toBe(1);
    expect(s.level).toBe(1);
    expect(s.over).toBe(false);
    expect(isWalkable(s.map, s.player.x, s.player.y)).toBe(true);
  });

  it('同じ seed なら同じ初期状態になる', () => {
    expect(newGame('SAME')).toEqual(newGame('SAME'));
  });

  it('敵とアイテムが開始地点に重ならない', () => {
    for (let i = 0; i < 30; i++) {
      const s = newGame(`OVERLAP${i}`);
      const here = (o: { x: number; y: number }): boolean => o.x === s.player.x && o.y === s.player.y;
      expect(s.monsters.some(here)).toBe(false);
      expect(s.items.some(here)).toBe(false);
    }
  });
});

describe('step', () => {
  it('同じ seed と同じ手順なら同じ結果になる', () => {
    const actions: Action[] = Array.from({ length: 120 }, (_, i) =>
      i % 3 === 0 ? WAIT : { type: 'move', dx: (i % 2) * 2 - 1, dy: 0 },
    );
    expect(play('REPLAY', actions)).toEqual(play('REPLAY', actions));
  });

  it('壁に向かってもターンが進まない', () => {
    const s = newGame('WALL1');
    // 上下左右のどれかは壁のはず。壁の方向を 1 つ見つけて試す
    const dirs = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const wall = dirs.find(([dx, dy]) => tileAt(s.map, s.player.x + dx, s.player.y + dy) === Tile.Wall);
    if (!wall) return;
    const before = { turn: s.turn, x: s.player.x, y: s.player.y };
    const result = step(s, { type: 'move', dx: wall[0], dy: wall[1] });
    expect(result.acted).toBe(false);
    expect(s.turn).toBe(before.turn);
    expect(s.player.x).toBe(before.x);
    expect(s.player.y).toBe(before.y);
  });

  it('持っていない消耗品は使えない', () => {
    const s = newGame('NOITEM');
    s.inventory.potion = 0;
    const before = s.turn;
    expect(step(s, { type: 'use', item: 'potion' }).acted).toBe(false);
    expect(s.turn).toBe(before);
  });

  it('待機してもターンは進む', () => {
    const s = newGame('WAIT1');
    const before = s.turn;
    expect(step(s, WAIT).acted).toBe(true);
    expect(s.turn).toBe(before + 1);
  });

  it('死んだあとは何をしてもターンが進まない', () => {
    const s = newGame('DEAD1');
    s.player.hp = 0;
    s.over = true;
    const before = s.turn;
    expect(step(s, WAIT).acted).toBe(false);
    expect(s.turn).toBe(before);
  });

  it('HP は最大値を超えない', () => {
    const s = newGame('HEAL1');
    s.inventory.potion = 1;
    s.player.hp = s.player.maxHp - 1;
    step(s, { type: 'use', item: 'potion' });
    expect(s.player.hp).toBe(s.player.maxHp);
  });
});

describe('xpToNext', () => {
  it('レベルが上がるほど必要量が増える', () => {
    for (let lv = 1; lv < 40; lv++) {
      expect(xpToNext(lv + 1)).toBeGreaterThan(xpToNext(lv));
    }
  });

  it('線形ではなく、伸び幅そのものが増える', () => {
    for (let lv = 1; lv < 40; lv++) {
      const nearGap = xpToNext(lv + 1) - xpToNext(lv);
      const farGap = xpToNext(lv + 2) - xpToNext(lv + 1);
      expect(farGap).toBeGreaterThan(nearGap);
    }
  });

  it('具体値を固定する', () => {
    expect(xpToNext(1)).toBe(7);
    expect(xpToNext(5)).toBe(21);
    expect(xpToNext(10)).toBe(61);
  });

  it('整数を返す', () => {
    for (let lv = 1; lv < 60; lv++) expect(Number.isInteger(xpToNext(lv))).toBe(true);
  });
});

describe('レベルアップ', () => {
  it('HP が全快し、最大 HP が増える', () => {
    const s = newGame('LVUP1');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    // 邪魔が入らないように敵を 1 体だけ残す
    const m = s.monsters[0];
    s.monsters = [m];
    m.x = spot.x;
    m.y = spot.y;
    m.hp = 1;
    m.def = 0;

    s.xp = xpToNext(s.level) - 1;
    s.player.hp = 1;
    const maxBefore = s.player.maxHp;
    const levelBefore = s.level;

    step(s, { type: 'move', dx: m.x - s.player.x, dy: m.y - s.player.y });

    expect(s.level).toBe(levelBefore + 1);
    expect(s.player.maxHp).toBeGreaterThan(maxBefore);
    expect(s.player.hp).toBe(s.player.maxHp);
  });

  it('攻撃力はレベルでは伸びない', () => {
    const s = newGame('LVUP2');
    const atkBefore = s.player.atk;
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    const m = s.monsters[0];
    s.monsters = [m];
    m.x = spot.x;
    m.y = spot.y;
    m.hp = 1;
    m.def = 0;
    s.xp = xpToNext(s.level) - 1;

    step(s, { type: 'move', dx: m.x - s.player.x, dy: m.y - s.player.y });

    expect(s.level).toBeGreaterThan(1);
    expect(s.player.atk).toBe(atkBefore);
  });
});

describe('ログ', () => {
  it('行にその時のターンが入る', () => {
    const s = newGame('LOG1');
    step(s, WAIT);
    step(s, WAIT);
    const turns = s.log.map((l) => l.turn);
    expect(turns.every((t) => Number.isInteger(t) && t >= 0)).toBe(true);
    // 古い行のターンが新しい行を追い越さない
    expect([...turns].sort((a, b) => a - b)).toEqual(turns);
  });

  it('与ダメのログに敵の残り HP が出る', () => {
    const s = newGame('LOG2');
    const m = s.monsters[0];
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    m.x = spot.x;
    m.y = spot.y;
    m.hp = 999;
    m.maxHp = 999;
    step(s, { type: 'move', dx: m.x - s.player.x, dy: m.y - s.player.y });
    const hit = s.log.find((l) => l.kind === 'player' && l.text.includes('のダメージ'));
    expect(hit?.text).toMatch(/残り \d+/);
  });
});

describe('確認プロンプト', () => {
  /** 階段の上まで歩かせる。着いたら true */
  function walkToStairs(s: GameState): boolean {
    const stairs = s.map.tiles.indexOf(Tile.StairsDown);
    const sx = stairs % s.map.width;
    const sy = Math.floor(stairs / s.map.width);
    // 経路探索は要らない。テスト用に瞬間移動させて 1 歩だけ踏ませる
    const from = neighborOf(s, { x: sx, y: sy });
    if (!from) return false;
    s.player.x = from.x;
    s.player.y = from.y;
    s.monsters = [];
    step(s, { type: 'move', dx: sx - from.x, dy: sy - from.y });
    return true;
  }

  it('階段に乗っても即座には降りない', () => {
    const s = newGame('PROMPT1');
    if (!walkToStairs(s)) return;
    expect(s.prompt).toEqual({ kind: 'descend' });
    expect(s.depth).toBe(1);
  });

  it('確認するとターンを消費して降りる', () => {
    const s = newGame('PROMPT2');
    if (!walkToStairs(s)) return;
    const turnBefore = s.turn;
    const r = step(s, { type: 'confirm' });
    expect(r.acted).toBe(true);
    expect(s.depth).toBe(2);
    expect(s.prompt).toBeNull();
    expect(s.turn).toBe(turnBefore + 1);
  });

  it('取り消すとターンを消費せず、その階に留まる', () => {
    const s = newGame('PROMPT3');
    if (!walkToStairs(s)) return;
    const turnBefore = s.turn;
    const r = step(s, { type: 'cancel' });
    expect(r.acted).toBe(false);
    expect(s.depth).toBe(1);
    expect(s.prompt).toBeNull();
    expect(s.turn).toBe(turnBefore);
  });

  it('確認待ちの間は移動も待機も受け付けない', () => {
    const s = newGame('PROMPT4');
    if (!walkToStairs(s)) return;
    const before = { x: s.player.x, y: s.player.y, turn: s.turn };
    expect(step(s, WAIT).acted).toBe(false);
    expect(step(s, { type: 'move', dx: 1, dy: 0 }).acted).toBe(false);
    expect(s.player.x).toBe(before.x);
    expect(s.player.y).toBe(before.y);
    expect(s.turn).toBe(before.turn);
    expect(s.prompt).not.toBeNull();
  });

  it('取り消したあと、待機で確認をやり直せる', () => {
    const s = newGame('PROMPT5');
    if (!walkToStairs(s)) return;
    step(s, { type: 'cancel' });
    expect(s.prompt).toBeNull();
    step(s, WAIT);
    expect(s.prompt).toEqual({ kind: 'descend' });
  });

  it('確認が無いときの confirm と cancel は何も起こさない', () => {
    const s = newGame('PROMPT6');
    expect(step(s, { type: 'confirm' }).acted).toBe(false);
    expect(step(s, { type: 'cancel' }).acted).toBe(false);
    expect(s.turn).toBe(0);
  });

  it('ViewModel に文面が出る', () => {
    const s = newGame('PROMPT7');
    expect(toViewModel(s).prompt).toBeNull();
    if (!walkToStairs(s)) return;
    const vm = toViewModel(s);
    expect(vm.prompt?.text).toContain('B2');
    expect(vm.prompt?.confirm).toBeTruthy();
    expect(vm.prompt?.cancel).toBeTruthy();
  });
});

describe('スタミナ', () => {
  /** 敵を消して、指定ターン待つ */
  function idle(s: GameState, turns: number): void {
    s.monsters = [];
    for (let i = 0; i < turns; i++) step(s, WAIT);
  }

  it('最初は満タンで始まる', () => {
    const s = newGame('ST1');
    expect(s.stamina).toBe(s.staminaMax);
    expect(s.staminaMax).toBeGreaterThan(0);
  });

  it('時間で減る', () => {
    const s = newGame('ST2');
    idle(s, 30);
    expect(s.stamina).toBeLessThan(s.staminaMax);
    // 1 ターン 1 ずつは減らない (数ターンに 1)
    expect(s.stamina).toBeGreaterThan(s.staminaMax - 30);
  });

  it('ある間は HP が自然回復する', () => {
    const s = newGame('ST3');
    s.player.hp = 5;
    idle(s, 30);
    expect(s.player.hp).toBeGreaterThan(5);
    expect(s.player.hp).toBeLessThanOrEqual(s.player.maxHp);
  });

  it('自然回復で最大値を超えない', () => {
    const s = newGame('ST4');
    idle(s, 60);
    expect(s.player.hp).toBeLessThanOrEqual(s.player.maxHp);
  });

  it('尽きると毎ターン HP が減る', () => {
    const s = newGame('ST5');
    s.stamina = 0;
    s.player.hp = 20;
    s.player.maxHp = 20;
    idle(s, 5);
    expect(s.player.hp).toBe(15);
  });

  it('尽きて HP を削り切ると倒れる', () => {
    const s = newGame('ST6');
    s.stamina = 0;
    s.player.hp = 3;
    idle(s, 10);
    expect(s.over).toBe(true);
  });

  it('被弾するとスタミナが減る', () => {
    const s = newGame('ST7');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    const m = s.monsters[0];
    s.monsters = [m];
    m.x = spot.x;
    m.y = spot.y;
    m.evasion = 0;
    m.atk = 1;
    s.player.maxHp = 999;
    s.player.hp = 999;
    const before = s.stamina;
    // 相手に殴らせる。回避で外れることがあるので数ターン回す
    for (let i = 0; i < 6; i++) step(s, WAIT);
    expect(s.stamina).toBeLessThan(before);
  });

  it('群れよけの盾を着ていると被弾でスタミナが減らない', () => {
    const withGuard = (id: 'swarmGuard' | 'chain'): number => {
      const s = newGame('ST8');
      s.armor = { id, power: 1 };
      const spot = neighborOf(s, s.player);
      if (!spot) return 0;
      const m = s.monsters[0];
      s.monsters = [m];
      m.x = spot.x;
      m.y = spot.y;
      m.evasion = 0;
      m.atk = 1;
      s.player.maxHp = 999;
      s.player.hp = 999;
      const before = s.stamina;
      for (let i = 0; i < 6; i++) step(s, WAIT);
      return before - s.stamina;
    };
    // 時間による減りは同じなので、差が出るのは被弾ぶんだけ
    expect(withGuard('swarmGuard')).toBeLessThan(withGuard('chain'));
  });

  it('スタミナ薬で戻り、最大値を超えない', () => {
    const s = newGame('ST9');
    s.stamina = 10;
    s.inventory.elixir = 1;
    step(s, { type: 'use', item: 'elixir' });
    expect(s.stamina).toBeGreaterThan(10);

    s.stamina = s.staminaMax - 1;
    s.inventory.elixir = 1;
    step(s, { type: 'use', item: 'elixir' });
    expect(s.stamina).toBe(s.staminaMax);
  });
});

describe('魔法', () => {
  it('スタミナが足りないと唱えられない', () => {
    const s = newGame('SP1');
    s.stamina = 0;
    expect(canCast(s, 'thunder')).toBe(false);
    const before = s.turn;
    expect(step(s, { type: 'cast', spell: 'thunder' }).acted).toBe(false);
    expect(s.turn).toBe(before);
  });

  it('唱えるとスタミナを支払う', () => {
    const s = newGame('SP2');
    s.monsters = [];
    const before = s.stamina;
    expect(step(s, { type: 'cast', spell: 'thunder' }).acted).toBe(true);
    expect(s.stamina).toBeLessThanOrEqual(before - SPELLS.thunder.cost);
  });

  it('見えている敵に当たる', () => {
    const s = newGame('SP3');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    const m = s.monsters[0];
    s.monsters = [m];
    m.x = spot.x;
    m.y = spot.y;
    m.hp = 1;
    step(s, { type: 'cast', spell: 'thunder' });
    expect(s.monsters).toHaveLength(0);
    expect(s.kills).toBe(1);
  });

  it('スロットに消耗品と魔法が並ぶ', () => {
    const s = newGame('SP4');
    const vm = toViewModel(s);
    expect(vm.slots.map((x) => x.ref.kind)).toEqual(['item', 'item', 'spell']);
    // 持っていない消耗品は押せない
    expect(vm.slots[0].enabled).toBe(false);
    // スタミナが満タンなら魔法は押せる
    expect(vm.slots[2].enabled).toBe(true);
  });
});

describe('消耗品の所持上限', () => {
  it('種類ごとに違う', () => {
    expect(stackLimit('potion')).toBeGreaterThan(stackLimit('elixir'));
  });

  it('上限に達すると拾わない', () => {
    const s = newGame('LIMIT1');
    s.inventory.elixir = stackLimit('elixir');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    s.monsters = [];
    s.items = [{ kind: 'elixir', power: 0, x: spot.x, y: spot.y }];
    step(s, { type: 'move', dx: spot.x - s.player.x, dy: spot.y - s.player.y });
    expect(s.inventory.elixir).toBe(stackLimit('elixir'));
    expect(s.items).toHaveLength(1);
  });
});

describe('装備の持ち替え', () => {
  /** プレイヤーの隣に装備を置き、踏ませる */
  function stepOntoEquip(s: GameState, item: Omit<Item, 'x' | 'y'>): boolean {
    const spot = neighborOf(s, s.player);
    if (!spot) return false;
    s.monsters = [];
    s.items = [{ ...item, x: spot.x, y: spot.y }];
    step(s, { type: 'move', dx: spot.x - s.player.x, dy: spot.y - s.player.y });
    return true;
  }

  const sword: Omit<Item, 'x' | 'y'> = { kind: 'weapon', power: 3, equip: 'sword' };

  it('自動では持ち替えず、確認が出る', () => {
    const s = newGame('EQ1');
    if (!stepOntoEquip(s, sword)) return;
    expect(s.prompt?.kind).toBe('equip');
    expect(s.weapon).toBeNull();
    // 確認の間、床からは取り上げてある
    expect(s.items).toHaveLength(0);
  });

  it('持ち替えると装備され、ターンは消費しない', () => {
    const s = newGame('EQ2');
    if (!stepOntoEquip(s, sword)) return;
    const turnBefore = s.turn;
    const r = step(s, { type: 'confirm' });
    expect(r.acted).toBe(false);
    expect(s.turn).toBe(turnBefore);
    expect(s.weapon).toEqual({ id: 'sword', power: 3 });
    expect(s.prompt).toBeNull();
  });

  it('今の装備は足元に落ちる', () => {
    const s = newGame('EQ3');
    s.weapon = { id: 'dagger', power: 2 };
    if (!stepOntoEquip(s, sword)) return;
    step(s, { type: 'confirm' });
    const dropped = s.items.find((it) => it.equip === 'dagger');
    expect(dropped).toBeDefined();
    expect(dropped?.x).toBe(s.player.x);
    expect(dropped?.y).toBe(s.player.y);
  });

  it('断ると床に戻り、印が付く', () => {
    const s = newGame('EQ4');
    if (!stepOntoEquip(s, sword)) return;
    step(s, { type: 'cancel' });
    expect(s.weapon).toBeNull();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].declined).toBe(true);
  });

  it('断ったものを踏み直しても確認は出ない', () => {
    const s = newGame('EQ5');
    if (!stepOntoEquip(s, sword)) return;
    step(s, { type: 'cancel' });
    const item = s.items[0];
    // 一度離れて、もう一度踏む
    const away = neighborOf(s, s.player);
    if (!away) return;
    s.player.x = away.x;
    s.player.y = away.y;
    step(s, { type: 'move', dx: item.x - s.player.x, dy: item.y - s.player.y });
    expect(s.prompt).toBeNull();
  });

  it('同じ部位を装備し直すと、床の印が外れる', () => {
    const s = newGame('EQ6');
    if (!stepOntoEquip(s, sword)) return;
    step(s, { type: 'cancel' });
    expect(s.items[0].declined).toBe(true);

    // 別の武器を装備すると、断った印は外れる
    s.items.push({ kind: 'weapon', power: 9, equip: 'axe', x: s.player.x, y: s.player.y });
    const axe = s.items[s.items.length - 1];
    s.items = s.items.filter((it) => it !== axe);
    s.prompt = { kind: 'equip', item: axe };
    step(s, { type: 'confirm' });

    expect(s.weapon).toEqual({ id: 'axe', power: 9 });
    expect(s.items.some((it) => it.equip === 'sword' && it.declined)).toBe(false);
  });

  it('ViewModel に装備の名前が出る', () => {
    const s = newGame('EQ7');
    expect(toViewModel(s).player.weapon).toBeNull();
    s.weapon = { id: 'axe', power: 4 };
    s.armor = { id: 'plate', power: 2 };
    const vm = toViewModel(s);
    expect(vm.player.weapon).toBe('斧 +4');
    expect(vm.player.armor).toBe('板金鎧 +2');
    // 攻撃力と防御力に補正が乗っている
    expect(vm.player.atk).toBe(s.player.atk + 6);
    expect(vm.player.def).toBe(4);
  });
});

describe('toViewModel', () => {
  it('セルの数がマップの広さと一致する', () => {
    const s = newGame('VM1');
    const vm = toViewModel(s);
    expect(vm.cells).toHaveLength(vm.width * vm.height);
  });

  it('プレイヤーが必ず actors に入っている', () => {
    const s = newGame('VM2');
    const vm = toViewModel(s);
    expect(vm.actors.filter((a) => a.kind === 'player')).toHaveLength(1);
  });

  it('見えていない敵は actors に出ない', () => {
    const s = newGame('VM3');
    const vm = toViewModel(s);
    const shown = vm.actors.filter((a) => a.kind !== 'player').length;
    expect(shown).toBeLessThanOrEqual(s.monsters.length);
  });

  it('HP の帯が残量に応じて変わる', () => {
    const s = newGame('VM4');
    const m = s.monsters[0];
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    m.x = spot.x;
    m.y = spot.y;
    m.maxHp = 20;

    const bandAt = (hp: number): string | undefined => {
      m.hp = hp;
      return toViewModel(s).actors.find((a) => a.x === m.x && a.y === m.y)?.health;
    };
    expect(bandAt(20)).toBe('healthy');
    expect(bandAt(11)).toBe('healthy');
    expect(bandAt(10)).toBe('hurt');
    expect(bandAt(6)).toBe('hurt');
    expect(bandAt(5)).toBe('critical');
    expect(bandAt(1)).toBe('critical');
  });
});

/** プレイヤーの隣で歩けるマスを 1 つ返す */
function neighborOf(s: GameState, p: { x: number; y: number }): { x: number; y: number } | null {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (isWalkable(s.map, p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
    }
  }
  return null;
}
