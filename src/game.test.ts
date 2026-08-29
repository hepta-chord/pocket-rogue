import { describe, expect, it } from 'vitest';
import { createMonster } from './entity';
import {
  SPELLS,
  SPAWN_INTERVAL,
  canCast,
  STALKER_TURN,
  STALKER_WARN,
  isBossFloor,
  isClearFloor,
  isDisguised,
  newGame,
  step,
  toViewModel,
  xpToNext,
  type Action,
  type GameState,
} from './game';
import { CONSUMABLES, stackLimit, type Item } from './items';
import { Tile, isWalkable, tileAt } from './map';

function play(seed: string, actions: Action[]): GameState {
  const state = newGame(seed);
  for (const a of actions) step(state, a);
  return state;
}

const WAIT: Action = { type: 'wait' };

/**
 * 必中の武器。
 * 命中判定が入ったので、当たる前提のテストは運に左右される。
 * 韋駄天突きは命中 100% なので、これを持たせて結果を固定する。
 */
const SURE_HIT = { id: 'swiftSpear', power: 1 } as const;

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
    s.weapon = SURE_HIT;
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
    s.weapon = SURE_HIT;

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
    s.weapon = SURE_HIT;
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

  it('階段の上で戦っても確認は出ない', () => {
    const s = newGame('PROMPT8');
    if (!walkToStairs(s)) return;
    step(s, { type: 'cancel' });

    // 階段の上に立ったまま、隣に敵を置いて殴る
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    const m = createMonster('rat', 1, spot.x, spot.y, 99);
    m.hp = 99;
    m.maxHp = 99;
    s.monsters = [m];
    for (let i = 0; i < 3; i++) {
      step(s, { type: 'move', dx: m.x - s.player.x, dy: m.y - s.player.y });
      expect(s.prompt).toBeNull();
    }
  });

  it('階段の上でアイテムを使っても確認は出ない', () => {
    const s = newGame('PROMPT9');
    if (!walkToStairs(s)) return;
    step(s, { type: 'cancel' });
    s.inventory.potion = 1;
    s.player.hp = 1;
    step(s, { type: 'use', item: 'potion' });
    expect(s.prompt).toBeNull();
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
    const withGuard = (id: 'staminaGuard' | 'chain'): number => {
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
    expect(withGuard('staminaGuard')).toBeLessThan(withGuard('chain'));
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
    const kinds = vm.slots.map((x) => x.ref.kind);
    // 消耗品が先に並び、そのあとに魔法が来る
    expect(kinds.filter((k) => k === 'item').length).toBe(CONSUMABLES.length);
    expect(kinds.slice(CONSUMABLES.length).every((k) => k === 'spell')).toBe(true);
    // 持っていない消耗品は押せない
    expect(vm.slots[0].enabled).toBe(false);
    // スタミナが満タンなら魔法は押せる
    expect(vm.slots[CONSUMABLES.length].enabled).toBe(true);
  });

  it('単体では基礎威力のまま、複数を巻き込むと威力が上がる', () => {
    // 単体
    const solo = newGame('SP5');
    const soloSpot = neighborOf(solo, solo.player);
    if (!soloSpot) return;
    const soloTarget = solo.monsters[0];
    solo.monsters = [soloTarget];
    soloTarget.x = soloSpot.x;
    soloTarget.y = soloSpot.y;
    soloTarget.hp = 9999;
    const soloBefore = soloTarget.hp;
    step(solo, { type: 'cast', spell: 'thunder' });
    const soloDmg = soloBefore - soloTarget.hp;

    // 同じ深さで、2 体を巻き込む
    const group = newGame('SP5');
    const spotA = neighborOf(group, group.player);
    if (!spotA) return;
    const targets = group.monsters.slice(0, 2);
    if (targets.length < 2) return;
    for (const m of targets) {
      m.x = spotA.x;
      m.y = spotA.y;
      m.hp = 9999;
    }
    group.monsters = targets;
    const groupBefore = targets[0].hp;
    step(group, { type: 'cast', spell: 'thunder' });
    const groupDmg = groupBefore - targets[0].hp;

    expect(groupDmg).toBeGreaterThan(soloDmg);
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

describe('休憩床', () => {
  it('B1 は REST_SPAN の倍数ではないので置かれない', () => {
    // 配置そのものの網羅は floors.test.ts の spawnFloors 側で確かめる。
    // ここでは descend が実際の depth を渡していることだけを見る
    const s = newGame('FL1');
    expect(s.floors).toHaveLength(0);
  });

  it('HP を全回復し、スタミナも戻す', () => {
    const s = newGame('FL3');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    s.monsters = [];
    s.items = [];
    s.floors = [{ x: spot.x, y: spot.y }];
    s.player.maxHp = 40;
    s.player.hp = 5;
    s.stamina = 10;
    step(s, { type: 'move', dx: spot.x - s.player.x, dy: spot.y - s.player.y });
    expect(s.floors).toHaveLength(0);
    expect(s.player.hp).toBe(40);
    expect(s.stamina).toBeGreaterThan(10);
  });

  it('ViewModel にセルの種別が出る', () => {
    const s = newGame('FL4');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    s.floors = [{ x: spot.x, y: spot.y }];
    s.explored[spot.y * s.map.width + spot.x] = 1;
    const vm = toViewModel(s);
    expect(vm.cells[spot.y * vm.width + spot.x].kind).toBe('floorRest');
  });
});


describe('長居への対策', () => {
  /**
   * その場で待ち続ける。
   * 追う者の検証が目的なので、湧いた雑魚だけ消して追う者は残す。
   */
  function idleOnFloor(s: GameState, turns: number): void {
    for (let i = 0; i < turns; i++) {
      s.monsters = s.monsters.filter((m) => m.kind === 'stalker');
      s.stamina = s.staminaMax;
      s.player.hp = s.player.maxHp;
      step(s, WAIT);
      if (s.over) return;
    }
  }

  it('フロア内のターン数を数える', () => {
    const s = newGame('PR1');
    s.monsters = [];
    step(s, WAIT);
    step(s, WAIT);
    expect(s.floorTurn).toBe(2);
  });

  it('居座ると敵が湧く', () => {
    const s = newGame('PR2');
    s.monsters = [];
    // 湧きの間隔ちょうどまで待つ
    for (let i = 0; i < 45; i++) {
      s.stamina = s.staminaMax;
      step(s, WAIT);
    }
    expect(s.monsters.length).toBeGreaterThan(0);
    expect(s.monsters.every((m) => m.spawned)).toBe(true);
  });

  it('湧いた個体は見えない位置に出る', () => {
    const s = newGame('PR3');
    s.monsters = [];
    // 湧いた直後に見る。放っておくと寄ってきて視界に入るのは正しい挙動である
    for (let i = 0; i < SPAWN_INTERVAL; i++) {
      s.stamina = s.staminaMax;
      step(s, WAIT);
    }
    for (const m of s.monsters) {
      expect(s.visible[m.y * s.map.width + m.x]).not.toBe(1);
    }
  });

  it('湧いた個体は報酬が下がる', () => {
    const normal = newGame('PR4');
    const spawned = newGame('PR4');
    const spot = neighborOf(normal, normal.player);
    if (!spot) return;

    const kill = (s: GameState, mark: boolean): number => {
      const m = createMonster('goblin', 1, spot.x, spot.y, 90);
      m.hp = 1;
      m.def = 0;
      m.evasion = 0;
      m.spawned = mark;
      s.monsters = [m];
      s.weapon = SURE_HIT;
      const before = s.score;
      step(s, { type: 'move', dx: m.x - s.player.x, dy: m.y - s.player.y });
      return s.score - before;
    };
    expect(kill(spawned, true)).toBeLessThan(kill(normal, false));
  });

  it('予告が出るのは、普通の探索より十分あとである', () => {
    // 盤面の縮小、迷路の輪づくり、敵の予算削減で 1 階の滞在は 60〜110 ターンになった。
    // 長居の判定はそれに合わせてあり、深い階の滞在のおよそ 1.8 倍で予告が出る
    expect(STALKER_WARN).toBeGreaterThan(180);
    expect(STALKER_TURN).toBeGreaterThan(STALKER_WARN);
  });

  it('追う者は予告のあとに現れる', () => {
    const s = newGame('PR5');
    idleOnFloor(s, STALKER_WARN - 1);
    expect(s.log.some((l) => l.text.includes('地響き'))).toBe(false);
    expect(s.monsters.some((m) => m.kind === 'stalker')).toBe(false);

    idleOnFloor(s, 2);
    expect(s.log.some((l) => l.text.includes('地響き'))).toBe(true);
    expect(s.monsters.some((m) => m.kind === 'stalker')).toBe(false);

    idleOnFloor(s, STALKER_TURN - STALKER_WARN + 1);
    expect(s.stalkerCalled).toBe(true);
    expect(s.monsters.some((m) => m.kind === 'stalker')).toBe(true);
  });

  it('予告に階段の方角が入る', () => {
    const s = newGame('PR6');
    idleOnFloor(s, STALKER_WARN + 1);
    const warn = s.log.find((l) => l.text.includes('地響き'));
    expect(warn?.text).toMatch(/階段は.+にある/);
  });

  it('階を降りるとフロア内のターン数と追う者がリセットされる', () => {
    const s = newGame('PR7');
    idleOnFloor(s, STALKER_TURN + 5);
    expect(s.stalkerCalled).toBe(true);
    const stairs = s.map.tiles.indexOf(Tile.StairsDown);
    s.player.x = stairs % s.map.width;
    s.player.y = Math.floor(stairs / s.map.width);
    s.prompt = { kind: 'descend' };
    step(s, { type: 'confirm' });
    expect(s.floorTurn).toBe(1);
    expect(s.stalkerCalled).toBe(false);
    expect(s.monsters.some((m) => m.kind === 'stalker')).toBe(false);
  });
});

describe('擬態', () => {
  it('正体が割れるまで武器として見える', () => {
    const s = newGame('MI1');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    const m = createMonster('slimeMimic', 21, spot.x, spot.y, 90);
    s.monsters = [m];
    expect(isDisguised(m)).toBe(true);
    const vm = toViewModel(s);
    expect(vm.actors.find((a) => a.x === m.x && a.y === m.y)?.disguised).toBe(true);
  });

  it('殴ると正体が割れる', () => {
    const s = newGame('MI2');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    const m = createMonster('slimeMimic', 21, spot.x, spot.y, 90);
    m.hp = 999;
    m.maxHp = 999;
    s.monsters = [m];
    s.weapon = SURE_HIT;
    step(s, { type: 'move', dx: m.x - s.player.x, dy: m.y - s.player.y });
    expect(m.revealed).toBe(true);
    expect(isDisguised(m)).toBe(false);
  });

  it('離れている間は動かない', () => {
    const s = newGame('MI3');
    const m = createMonster('slimeMimic', 21, s.player.x, s.player.y, 90);
    // プレイヤーから離れた歩ける場所に置く
    const far = s.map.rooms[s.map.rooms.length - 1];
    m.x = far.x;
    m.y = far.y;
    s.monsters = [m];
    const before = { x: m.x, y: m.y };
    for (let i = 0; i < 10; i++) {
      s.stamina = s.staminaMax;
      step(s, WAIT);
    }
    expect(m.x).toBe(before.x);
    expect(m.y).toBe(before.y);
  });
});

describe('毒', () => {
  it('重ね掛けに上限がある', () => {
    const s = newGame('PO2');
    s.monsters = [];
    // 直接積んで、1 ターンで減ることだけ確かめる
    s.effects.poison = 999;
    step(s, WAIT);
    expect(s.effects.poison).toBeLessThan(999);
  });

  it('毎ターン HP が減り、やがて抜ける', () => {
    const s = newGame('PO1');
    s.monsters = [];
    s.player.maxHp = 99;
    s.player.hp = 99;
    s.effects.poison = 3;
    step(s, WAIT);
    expect(s.player.hp).toBe(98);
    step(s, WAIT);
    step(s, WAIT);
    expect(s.effects.poison).toBeUndefined();
    const settled = s.player.hp;
    step(s, WAIT);
    expect(s.player.hp).toBeGreaterThanOrEqual(settled);
  });
});

describe('フロアボスとクリア', () => {
  it('ボスは 10 階ごと、クリア階は 30 階ごと', () => {
    expect(isBossFloor(10)).toBe(true);
    expect(isBossFloor(20)).toBe(true);
    expect(isBossFloor(9)).toBe(false);
    expect(isClearFloor(30)).toBe(true);
    expect(isClearFloor(60)).toBe(true);
    expect(isClearFloor(10)).toBe(false);
  });

  /** 指定した階まで一気に降ろす */
  function toDepth(s: GameState, depth: number): void {
    while (s.depth < depth) {
      const stairs = s.map.tiles.indexOf(Tile.StairsDown);
      s.player.x = stairs % s.map.width;
      s.player.y = Math.floor(stairs / s.map.width);
      s.prompt = { kind: 'descend' };
      s.stamina = s.staminaMax;
      s.player.hp = s.player.maxHp;
      step(s, { type: 'confirm' });
    }
  }

  it('ボス階にドラゴンが 1 体だけ出る', () => {
    const s = newGame('BOSS1');
    toDepth(s, 10);
    expect(s.monsters.filter((m) => m.kind === 'dragon')).toHaveLength(1);
  });

  it('ボス階でない階にはドラゴンが出ない', () => {
    for (const seed of ['BOSS2', 'BOSS3', 'BOSS4']) {
      const s = newGame(seed);
      toDepth(s, 9);
      expect(s.monsters.some((m) => m.kind === 'dragon')).toBe(false);
    }
  });

  it('ボスを倒すと財宝を落とす', () => {
    const s = newGame('BOSS5');
    toDepth(s, 10);
    const boss = s.monsters.find((m) => m.kind === 'dragon');
    if (!boss) return;
    s.monsters = [boss];
    boss.hp = 1;
    boss.def = 0;
    boss.evasion = 0;
    boss.x = s.player.x + 1;
    boss.y = s.player.y;
    s.weapon = SURE_HIT;
    step(s, { type: 'move', dx: 1, dy: 0 });
    const treasure = s.items.find((it) => it.kind === 'treasure');
    expect(treasure).toBeDefined();
    expect(treasure?.power).toBeGreaterThan(0);
  });

  it('ボス階では下り階段が最初から出ている (倒さなくても降りられる)', () => {
    const s = newGame('BOSS6');
    toDepth(s, 10);
    expect(s.map.tiles.filter((t) => t === Tile.StairsDown)).toHaveLength(1);
    expect(s.map.tiles.some((t) => t === Tile.StairsUp)).toBe(false);
  });

  it('クリア階でボスを倒すと脱出階段が出る', () => {
    const s = newGame('BOSS7');
    toDepth(s, 30);
    const boss = s.monsters.find((m) => m.kind === 'dragon');
    if (!boss) return;
    s.monsters = [boss];
    boss.hp = 1;
    boss.def = 0;
    boss.evasion = 0;
    boss.x = s.player.x + 1;
    boss.y = s.player.y;
    s.weapon = SURE_HIT;
    step(s, { type: 'move', dx: 1, dy: 0 });
    expect(s.map.tiles.filter((t) => t === Tile.StairsUp)).toHaveLength(1);
  });

  it('脱出すると加点されて終わる', () => {
    const s = newGame('BOSS8');
    s.prompt = { kind: 'escape' };
    const before = s.score;
    const r = step(s, { type: 'confirm' });
    expect(r.acted).toBe(true);
    expect(s.cleared).toBe(true);
    expect(s.over).toBe(true);
    expect(s.score).toBeGreaterThan(before);
    expect(toViewModel(s).cleared).toBe(true);
  });

  it('脱出を断ればそのまま潜り続けられる', () => {
    const s = newGame('BOSS9');
    s.prompt = { kind: 'escape' };
    step(s, { type: 'cancel' });
    expect(s.over).toBe(false);
    expect(s.cleared).toBe(false);
  });

  it('財宝は拾うとスコアになる', () => {
    const s = newGame('TR1');
    const spot = neighborOf(s, s.player);
    if (!spot) return;
    s.monsters = [];
    s.items = [{ kind: 'treasure', power: 250, x: spot.x, y: spot.y }];
    const before = s.score;
    step(s, { type: 'move', dx: spot.x - s.player.x, dy: spot.y - s.player.y });
    expect(s.score).toBe(before + 250);
    expect(s.items).toHaveLength(0);
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
