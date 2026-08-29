import { FAMILY_NAMES, MONSTERS, type MonsterFamily } from '../entity';
import { ITEM_NAMES } from '../items';
import { TRAP_NAMES } from '../traps';
import { ACTOR_GLYPHS, CELL_GLYPHS, ITEM_GLYPHS, COLORS, type Glyph } from './glyphs';

// 画面に出ている文字が何を指すのかの一覧。
//
// 文字と色を知っているのは描画層だけなので、対応表もここに置く。
// 名前は entity.ts / items.ts / traps.ts の定義から引くので、
// 敵や罠を足したときに説明だけ古くなることはない。

export interface HelpRow {
  glyph: Glyph;
  /** 名前。太字で出す */
  name: string;
  /** 1 行の説明 */
  note: string;
}

export interface HelpSection {
  title: string;
  rows: HelpRow[];
  /** 表のあとに添える文。文字と結び付かない決まりごとを書く */
  notes?: string[];
}

/** 系統ごとの代表。グレード 1 の文字と色で出す */
const FAMILY_SAMPLE: Record<Exclude<MonsterFamily, 'boss'>, { kind: keyof typeof MONSTERS; note: string }> = {
  swarm: { kind: 'rat', note: '1 体は弱いが数で押す。囲まれると一気に削られる' },
  swift: { kind: 'bat', note: '1 ターンに 2 回動く。逃げ切れない' },
  ranged: { kind: 'koboldSpear', note: '直線上なら離れていても届く。通路に下がっても無駄' },
  warrior: { kind: 'goblin', note: '素直に強い。連撃を持つ' },
  heavy: { kind: 'troll', note: '硬くて鈍い。2 ターンに 1 回しか動かない' },
  odd: { kind: 'slime', note: '分裂・壁抜け・擬態。普通の戦い方が通じない' },
};

const FAMILY_ORDER = Object.keys(FAMILY_SAMPLE) as (keyof typeof FAMILY_SAMPLE)[];

export const HELP: HelpSection[] = [
  {
    title: '地形',
    rows: [
      { glyph: CELL_GLYPHS.wall, name: '壁', note: '通れない' },
      { glyph: CELL_GLYPHS.floor, name: '床', note: '通れる' },
      { glyph: CELL_GLYPHS.stairs, name: '下り階段', note: '乗ると降りるか聞かれる。断れば階段の上で休める' },
      { glyph: CELL_GLYPHS.stairsUp, name: '脱出階段', note: '30F のボスを倒すと出る。上ればクリア' },
      { glyph: CELL_GLYPHS.floorRest, name: '休憩床', note: 'HP が全快しスタミナも戻る。5 階ごとに 1 つだけ' },
      { glyph: CELL_GLYPHS.trap, name: '罠', note: '踏むまで見えない。地図を使うと分かる。一度踏むと消える' },
      { glyph: CELL_GLYPHS.trapPit, name: TRAP_NAMES.pit, note: '踏むと次の階へ落ちる。得になることもある' },
    ],
    notes: [
      `罠の種類: ${Object.values(TRAP_NAMES).join('・')}。どれも即死はしない`,
    ],
  },
  {
    title: 'アイテム',
    rows: [
      { glyph: ITEM_GLYPHS.potion, name: ITEM_NAMES.potion, note: '最大 HP の半分が戻る。5 個まで' },
      { glyph: ITEM_GLYPHS.elixir, name: ITEM_NAMES.elixir, note: 'スタミナが 40 戻る。3 個まで' },
      { glyph: ITEM_GLYPHS.map, name: ITEM_NAMES.map, note: '地形と罠が分かる。スタミナを 20 使う。2 個まで' },
      { glyph: ITEM_GLYPHS.weapon, name: ITEM_NAMES.weapon, note: '踏むと持ち替えるか聞かれる。性能は確認画面に全部出る' },
      { glyph: ITEM_GLYPHS.armor, name: ITEM_NAMES.armor, note: '同じく踏むと聞かれる。断ったものは二度聞かれない' },
      { glyph: ITEM_GLYPHS.treasure, name: ITEM_NAMES.treasure, note: 'ボスが落とす。拾うとスコアになる' },
    ],
    notes: ['雷はアイテムではなく魔法。スタミナを 15 使い、見えている敵すべてに当たる。まとめて巻き込むほど 1 体あたりが痛い'],
  },
  {
    title: '敵',
    rows: [
      ...FAMILY_ORDER.map((f) => ({
        glyph: ACTOR_GLYPHS[FAMILY_SAMPLE[f].kind],
        name: FAMILY_NAMES[f],
        note: FAMILY_SAMPLE[f].note,
      })),
      { glyph: ACTOR_GLYPHS.dragon, name: MONSTERS.dragon.name, note: '10 階ごとのボス。炎を吐き、雷が効かない。倒すと財宝' },
      { glyph: ACTOR_GLYPHS.stalker, name: MONSTERS.stalker.name, note: '同じ階に長居すると出る。勝てないので階段へ逃げる' },
    ],
    notes: [
      '同じ文字のまま色と名前が変わると、その系統の上位である',
      '傷つくほど赤に寄る。半分以下で橙、1/4 以下で赤',
      '系統ごとに出る階が決まっていて、2〜3 階ごとに顔ぶれが入れ替わる',
    ],
  },
  {
    title: '戦い方',
    rows: [],
    notes: [
      '壁の角越しには攻撃が届かない。通路の入口に立てば、部屋にいる敵とは 1 対 1 で戦える',
      'ただし遠隔 (k) には通じない。見えたら間合いを詰めて倒す',
      '方向ボタンの長押しで連続移動。壁・敵の出現・被弾・階段で止まる',
      '「待つ」の長押しでターンを送れる。スタミナが HP に変わるので、降りる前に使う',
      'スタミナがある間だけ HP が自然回復する。尽きると毎ターン HP が減る',
      'レベルが「階数 + 6」を超えると入る経験値が減り、追う者も早く出る。潜るのが最大の成長',
    ],
  },
];

export const HELP_COLORS = { name: COLORS.hud, note: COLORS.hudDim };
