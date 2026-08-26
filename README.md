# Pocket Rogue

文字だけのカジュアルローグライク。
スマートフォンのブラウザで遊ぶ前提で、GitHub Pages に置いて URL で配る。
ホーム画面に追加すればアプリのように起動し、オフラインでも動く。

## 遊び方

- 画面下のボタンで 8 方向に移動。中央は待機
- ボタンを長押しすると連続移動。壁・敵の出現・被弾・階段で止まる
- 敵に向かって移動すると攻撃
- ログは自分の行動が青、敵の行動が赤、情報が灰、警告が黄
- `>` に乗ると次の階へ。階が深いほど敵が強い
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
