import { describe, expect, it } from 'vitest';
import { newGame, step, toViewModel, type GameState } from './game';
import { Tile } from './map';
import { ROOT_TURNS, TRAP_NAMES, spawnTraps, trapCount, type TrapKind } from './traps';
import { Rng, hashSeed } from './rng';
import { generateMap } from './map';

/** 開けた部屋を作り、中央のプレイヤーの隣に罠を 1 つ置く */
function withTrap(seed: string, kind: TrapKind): GameState {
  const W = 9;
  const H = 9;
  const state = newGame(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      tiles.push(edge ? Tile.Wall : Tile.Floor);
    }
  }
  state.map = { kind: 'rooms', width: W, height: H, tiles, rooms: [], start: { x: 4, y: 4 }, links: [], stairsRoom: -1 };
  state.player.x = 4;
  state.player.y = 4;
  state.player.maxHp = 40;
  state.player.hp = 40;
  state.items = [];
  state.floors = [];
  state.monsters = [];
  state.traps = [{ kind, x: 5, y: 4, found: false }];
  state.visible = new Array<number>(W * H).fill(1);
  state.explored = new Array<number>(W * H).fill(1);
  state.prompt = null;
  return state;
}

const stepRight = (s: GameState) => step(s, { type: 'move', dx: 1, dy: 0 });

describe('罠', () => {
  it('踏むと発動して消える', () => {
    const s = withTrap('TRAP1', 'halveStamina');
    stepRight(s);
    expect(s.traps).toHaveLength(0);
    expect(s.log.some((l) => l.text.includes(TRAP_NAMES.halveStamina))).toBe(true);
  });

  it('HP 半減でも死なない', () => {
    const s = withTrap('TRAP2', 'halveHp');
    s.player.hp = 1;
    stepRight(s);
    expect(s.player.hp).toBeGreaterThan(0);
    expect(s.over).toBe(false);
  });

  it('スタミナ半減でも 0 にはならない', () => {
    const s = withTrap('TRAP3', 'halveStamina');
    const before = s.stamina;
    stepRight(s);
    expect(s.stamina).toBe(before - Math.floor(before / 2));
  });

  it('足止めのあいだは動けず、いずれ解ける', () => {
    const s = withTrap('TRAP4', 'root');
    stepRight(s);
    // ログに出した数だけ動けない (踏んだターンの分は差し引き済み)
    expect(s.effects.root).toBe(ROOT_TURNS);

    const at = { x: s.player.x, y: s.player.y };
    step(s, { type: 'move', dx: 1, dy: 0 });
    expect(s.player.x).toBe(at.x);

    for (let i = 0; i < ROOT_TURNS + 2; i++) step(s, { type: 'wait' });
    expect(s.effects.root).toBeUndefined();
    step(s, { type: 'move', dx: 1, dy: 0 });
    expect(s.player.x).toBe(at.x + 1);
  });

  it('落とし穴で次の階へ落ちる', () => {
    const s = withTrap('TRAP5', 'pit');
    const before = s.depth;
    stepRight(s);
    expect(s.depth).toBe(before + 1);
  });

  it('呼び寄せで敵が湧く', () => {
    const s = withTrap('TRAP6', 'summon');
    stepRight(s);
    expect(s.monsters.length).toBeGreaterThan(0);
    // 湧いた個体は報酬が下がる扱いにする
    expect(s.monsters.every((m) => m.spawned)).toBe(true);
  });

  it('見つかるまで表示されない', () => {
    const s = withTrap('TRAP7', 'corrode');
    const i = 4 * s.map.width + 5;
    expect(toViewModel(s).cells[i].kind).not.toBe('trap');
    s.traps[0].found = true;
    expect(toViewModel(s).cells[i].kind).toBe('trap');
  });

  describe('腐食の罠', () => {
    it('装備の強さが 1 下がる。深いほうから減る', () => {
      const s = withTrap('CO1', 'corrode');
      s.weapon = { id: 'sword', power: 5 };
      s.armor = { id: 'chain', power: 2 };
      stepRight(s);
      expect(s.weapon?.power).toBe(4);
      expect(s.armor?.power).toBe(2);
    });

    it('護符を着ていると防げる', () => {
      const s = withTrap('CO2', 'corrode');
      s.weapon = { id: 'sword', power: 5 };
      s.armor = { id: 'wardCharm', power: 3 };
      stepRight(s);
      expect(s.weapon?.power).toBe(5);
      expect(s.armor?.power).toBe(3);
    });

    it('強さ 0 の装備はそれ以上腐食しない', () => {
      const s = withTrap('CO3', 'corrode');
      s.weapon = { id: 'sword', power: 0 };
      s.armor = null;
      stepRight(s);
      expect(s.weapon?.power).toBe(0);
    });

    it('腐食すると床の「断った」印が外れる', () => {
      const s = withTrap('CO4', 'corrode');
      s.weapon = { id: 'sword', power: 5 };
      s.items = [{ kind: 'weapon', power: 4, equip: 'axe', x: 1, y: 1, declined: true }];
      stepRight(s);
      expect(s.items[0].declined).toBeUndefined();
    });
  });
});

describe('地図', () => {
  it('使うと地形と罠が分かる', () => {
    const s = withTrap('MAP1', 'corrode');
    s.inventory.map = 1;
    s.explored = new Array<number>(s.map.width * s.map.height).fill(0);

    step(s, { type: 'use', item: 'map' });
    expect(s.traps[0].found).toBe(true);
    expect(s.explored.some((v) => v === 1)).toBe(true);
    expect(s.inventory.map).toBe(0);
  });

  it('スタミナを消費する', () => {
    const s = withTrap('MAP2', 'corrode');
    s.inventory.map = 1;
    const before = s.stamina;
    step(s, { type: 'use', item: 'map' });
    expect(s.stamina).toBeLessThan(before);
  });

  it('スタミナが足りないと使えない', () => {
    const s = withTrap('MAP3', 'corrode');
    s.inventory.map = 1;
    s.stamina = 1;
    const r = step(s, { type: 'use', item: 'map' });
    expect(r.acted).toBe(false);
    expect(s.inventory.map).toBe(1);
    expect(s.traps[0].found).toBe(false);
  });
});

describe('罠の配置', () => {
  it('深いほど数が増える', () => {
    const rng = new Rng(hashSeed('COUNT'));
    let shallow = 0;
    let deep = 0;
    for (let i = 0; i < 200; i++) {
      shallow += trapCount(rng, 1);
      deep += trapCount(rng, 20);
    }
    expect(deep).toBeGreaterThan(shallow);
  });

  it('開始地点と、ふさがっているマスには置かない', () => {
    const rng = new Rng(hashSeed('PLACE'));
    const map = generateMap(rng, 32, 24, 'rooms');
    const taken = [{ x: map.start.x + 1, y: map.start.y }];
    const traps = spawnTraps(rng, map, 10, map.start, taken);
    for (const t of traps) {
      expect(t.x === map.start.x && t.y === map.start.y).toBe(false);
      expect(taken.some((k) => k.x === t.x && k.y === t.y)).toBe(false);
      expect(map.tiles[t.y * map.width + t.x]).toBe(Tile.Floor);
    }
  });
});
