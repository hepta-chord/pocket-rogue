import { describe, expect, it } from 'vitest';
import { MONSTERS, createMonster, type MonsterKind } from './entity';
import { newGame, step, type GameState } from './game';
import { Tile } from './map';

/**
 * 好きな地形を並べた盤面を作る。
 *
 * `P` がプレイヤー、`.` が床、`#` が壁である。
 * 敵は呼び出し側が座標を指定して置く。
 */
function board(seed: string, layout: string[]): GameState {
  const width = layout[0].length;
  const height = layout.length;
  const tiles: Tile[] = [];
  let start = { x: 1, y: 1 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = layout[y][x];
      tiles.push(c === '#' ? Tile.Wall : Tile.Floor);
      if (c === 'P') start = { x, y };
    }
  }

  const state = newGame(seed);
  state.map = { kind: 'rooms', width, height, tiles, rooms: [], start, links: [], stairsRoom: -1 };
  state.player.x = start.x;
  state.player.y = start.y;
  // 数ターン待って観察するので、途中で死なないだけの HP を持たせる
  state.player.maxHp = 200;
  state.player.hp = 200;
  state.items = [];
  state.floors = [];
  state.traps = [];
  state.monsters = [];
  state.visible = new Array<number>(width * height).fill(1);
  state.explored = new Array<number>(width * height).fill(1);
  state.prompt = null;
  return state;
}

function put(state: GameState, kind: MonsterKind, x: number, y: number, id: number): void {
  state.monsters.push(createMonster(kind, 5, x, y, id));
}

/** 何ターンか待って、プレイヤーが削られたか見る。技は確率なので 1 ターンでは決まらない */
function hitWithin(state: GameState, turns: number): boolean {
  const before = state.player.hp;
  for (let i = 0; i < turns; i++) {
    step(state, { type: 'wait' });
    if (state.player.hp < before) return true;
  }
  return false;
}

describe('槍 (射程 2 の直線)', () => {
  const corridor = ['########', '#P.....#', '########'];

  it('2 マス先から突いてくる', () => {
    const s = board('SPEAR1', corridor);
    put(s, 'koboldSpear', 3, 1, 100);
    expect(hitWithin(s, 6)).toBe(true);
    // 突いただけで、間合いは詰めていない
    expect(s.monsters[0].x).toBe(3);
  });

  it('壁で遮られていれば届かない', () => {
    const s = board('SPEAR2', ['#####', '#P#M#', '#####']);
    put(s, 'koboldSpear', 3, 1, 100);
    expect(hitWithin(s, 20)).toBe(false);
  });

  it('斜めでも直線なら届く', () => {
    const s = board('SPEAR3', ['#####', '#P..#', '#...#', '#..M#', '#####']);
    put(s, 'koboldSpear', 3, 3, 100);
    expect(hitWithin(s, 6)).toBe(true);
  });
});

describe('射撃 (直線上の遠距離攻撃)', () => {
  it('直線上に並んでいなければ撃たない', () => {
    // (1,1) と (3,2) は直交でも 45 度でもないので射線が通らない。
    // 詰められる前の 1 ターンだけを見る
    const s = board('SHOOT1', ['#####', '#P..#', '#...#', '#####']);
    put(s, 'koboldBow', 3, 2, 100);
    const before = s.player.hp;
    step(s, { type: 'wait' });
    expect(s.player.hp).toBe(before);
  });

  it('直線上なら離れていても撃ってくる', () => {
    const s = board('SHOOT2', ['########', '#P.....#', '########']);
    put(s, 'koboldBow', 5, 1, 100);
    expect(hitWithin(s, 10)).toBe(true);
  });

  it('撃てる位置に着いたら詰めてこない', () => {
    const s = board('SHOOT3', ['########', '#P.....#', '########']);
    put(s, 'koboldBow', 5, 1, 100);
    for (let i = 0; i < 10; i++) step(s, { type: 'wait' });
    expect(s.monsters[0].x).toBe(5);
  });
});

describe('同士討ち', () => {
  /** 射線上に味方が挟まった配置。手番は射手が先に来るように並べる */
  function crossFire(seed: string): GameState {
    const s = board(seed, ['########', '#P.....#', '########']);
    put(s, 'koboldBow', 5, 1, 100);
    put(s, 'rat', 2, 1, 101);
    // 前に出た 1 体を確実に落とせるように、瀕死にしておく
    s.monsters[1].hp = 1;
    return s;
  }

  it('射線上の味方に当たる', () => {
    const s = crossFire('CROSS1');
    for (let i = 0; i < 10 && s.monsters.length === 2; i++) step(s, { type: 'wait' });
    expect(s.monsters.some((m) => m.kind === 'rat')).toBe(false);
  });

  it('味方を倒してもプレイヤーの経験値と撃破数は増えない', () => {
    const s = crossFire('CROSS2');
    const xp = s.xp;
    const kills = s.kills;
    for (let i = 0; i < 10 && s.monsters.length === 2; i++) step(s, { type: 'wait' });
    expect(s.monsters.some((m) => m.kind === 'rat')).toBe(false);
    expect(s.xp).toBe(xp);
    expect(s.kills).toBe(kills);
  });

  it('倒した側はグレードが上がり、HP も上がった先の値になる', () => {
    const s = crossFire('CROSS3');
    for (let i = 0; i < 10 && s.monsters.length === 2; i++) step(s, { type: 'wait' });
    const grown = s.monsters[0];
    expect(grown.kind).toBe('koboldSniper');
    expect(grown.maxHp).toBe(createMonster('koboldSniper', s.depth, 0, 0, 0).maxHp);
    expect(grown.hp).toBe(grown.maxHp);
  });
});

describe('重装の再生', () => {
  it('グレード 1 と 2 は再生しない', () => {
    expect(MONSTERS.troll.passives).not.toContain('regen');
    expect(MONSTERS.trollRock.passives).not.toContain('regen');
  });

  it('グレード 3 だけが再生する', () => {
    expect(MONSTERS.trollIron.passives).toContain('regen');
  });

  it('殴って下がると、再生しない重装は削れたままになる', () => {
    const s = board('HEAVY1', ['########', '#P.....#', '########']);
    put(s, 'troll', 2, 1, 100);
    s.weapon = { id: 'swiftSpear', power: 3 };
    step(s, { type: 'move', dx: 1, dy: 0 });
    const dented = s.monsters[0].hp;
    expect(dented).toBeLessThan(s.monsters[0].maxHp);
    // 鈍足なので離れれば追いつかれない。待っても HP は戻らない
    for (let i = 0; i < 5; i++) step(s, { type: 'wait' });
    expect(s.monsters[0].hp).toBeLessThanOrEqual(dented);
  });
});

describe('回復薬', () => {
  it('最大 HP の半分が戻る', () => {
    const s = board('POTION1', ['#####', '#P..#', '#####']);
    s.player.maxHp = 40;
    s.player.hp = 10;
    s.inventory.potion = 1;
    step(s, { type: 'use', item: 'potion' });
    expect(s.player.hp).toBe(30);
  });

  it('最大 HP は超えない', () => {
    const s = board('POTION2', ['#####', '#P..#', '#####']);
    s.player.maxHp = 40;
    s.player.hp = 35;
    s.inventory.potion = 1;
    step(s, { type: 'use', item: 'potion' });
    expect(s.player.hp).toBe(40);
  });
});
