# Pocket Rogue

文字だけのカジュアルローグライク。
スマートフォンのブラウザで遊ぶ前提で、GitHub Pages に置いて URL で配る。
ホーム画面に追加すればアプリのように起動し、オフラインでも動く。

## 遊び方

- 画面下のボタンで 8 方向に移動。中央は待機
- ボタンを長押しすると連続移動。壁・敵の出現・被弾・階段で止まる
- 敵に向かって移動すると攻撃
- ログは自分の行動が青、敵の行動が赤、情報が灰、警告が黄
- アイテムは踏むと拾う。武器 `)` と防具 `[` は今より強ければ自動で持ち替える
- 消耗品は方向ボタンの上のスロットをタップして使う (対象指定は無い)
  - 回復薬 `!`: HP を最大値の半分 (最低 8) 回復する
  - 雷の巻物 `?` (黄): 見えている敵全員にダメージ
  - 地図の巻物 `?` (水色): その階の地形をすべて表示する
- `>` に乗ると次の階へ。階が深いほど敵が強い

### 敵

特徴は「パッシブ (常に働く性質)」と「アクション (条件が揃ったとき確率で使う技)」に分かれる。
定義は `src/entity.ts` の `MONSTERS` にあり、1 行足せば新しい敵が出る。

| 敵 | 階 | パッシブ | アクション |
|---|---|---|---|
| ネズミ `r` | B1〜B4 | なし (2〜3 匹の群れ) | なし |
| コウモリ `b` | B1〜B6 | 俊敏 (1 ターン 2 回行動)、ふらつき | なし |
| ゴブリン `g` | B2〜B8 | なし | 連撃 30%: 2 回攻撃 |
| スライム `s` | B3〜B7 | 分裂: 近接攻撃を受けて生き残ると 2 匹に (4 匹まで) | なし |
| オーク `o` | B4〜 | なし | なし |
| 幽霊 `G` | B5〜 | 壁抜け | なし |
| トロル `T` | B6〜 | 再生 (毎ターン HP 1)、鈍重 (2 ターンに 1 回) | 強打 25%: 防具を無視 |
| 狼 `w` | B7〜 | 俊敏 | 跳びかかり 40%: 距離 2 から一気に隣接して攻撃 |
| ドラゴン `D` | B9〜 (1 体) | なし | 火炎 30%: 距離 2〜4 で炎 (攻撃力の半分 + 階数、防具で軽減) |
- 5 ターンごとに HP が 1 回復。階を降りると 5 回復
- 右上の ≡ から seed を確認・入力できる。同じ seed なら同じダンジョンになる
- PC はカーソルキー・テンキー・hjklyubn で移動、`.` か Space で待機

## 開発

Node.js はビルドに使うだけで、遊ぶ側には不要である。

```sh
npm install
npm run dev       # http://localhost:5173/
npm run build     # dist/ に出力
npm run preview   # dist/ を配信して確認
npm run icons     # public/icon-*.png を作り直す
```

## 構成

```
src/
  main.ts            起動。Renderer の選択、入力とループの接続
  game.ts            状態遷移 (1 ターン進める、戦闘、階層移動、死亡)。ViewModel を返す
  view.ts            描画層に渡すデータの型。見た目を含まない
  map.ts             部屋 + 通路の生成
  fov.ts             視界 (シャドウキャスティング)
  entity.ts          プレイヤー・敵の定義と配置
  rng.ts             シード付き乱数
  input.ts           キーボードと画面ボタンを同じ Action に揃える
  save.ts            localStorage の保存と復元
  render/
    renderer.ts      Renderer インターフェース
    text-renderer.ts Canvas に文字グリッドを描く
    glyphs.ts        種類 → 文字・色の対応表
public/
  sw.js              オフライン用 Service Worker
  manifest.webmanifest
  icon-*.png
```

見た目をタイル画像に替えたいときは、`Renderer` を実装した `TileRenderer` を `src/render/` に足し、
`src/main.ts` で差し込む。`game.ts` と `view.ts` は `render/` を import しない。

## 公開

`main` に push すると `.github/workflows/pages.yml` がビルドして GitHub Pages に配信する。
リポジトリの Settings → Pages で Source を「GitHub Actions」にしておく。
