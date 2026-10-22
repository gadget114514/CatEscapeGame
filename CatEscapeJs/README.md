# Cat Escape（ねこにげ)

「ねこをつかまえる」（Trap the Cat / Chat Noir）と、その逆ゲーム「ねこからにげる」を両方収録した
六角マスボードゲームです。Babylon.js による 3D 描画、Electron でデスクトップアプリとしても、
GitHub Pages でも動きます。

## 遊び方

- **ねこをつかまえる**（トラッパーモード）: あなたがマスにブロックを置いて、AI が動くねこを捕まえます。
- **ねことしてにげる**（エスケープモード）: あなたがねこを操作して、AI が置くブロックをかわして外周に到達すれば勝ちです。
- 難易度は **やさしい / ふつう / むずかしい** の 3 段階。ゲーム開始時の初期ブロック数と AI の強さが変わります。
- ねこが外周マスに到達するとねこ勝ち、ねこの番のはじめに動けるマスが無いとプレイヤー勝ちです。
- 「ルートを表示」にチェックすると、ねこの最短脱出路（最短ルート）がオレンジ色で表示されます。
- 画面上のマスをドラッグするとカメラを回転、ホイール／ピンチでズームできます。

## 開発

プロジェクトはリポジトリの `CatEscapeJs/` フォルダにあります。

```bash
cd CatEscapeJs
npm install
npm test          # vitest（純粋ロジックのユニットテスト）
npm run dev       # Vite 開発サーバー
npm run build     # dist/ 生成（相対パスで出力）
npm run preview   # dist/ をプレビュー
npm run electron  # build して Electron で起動
npm run electron:dev   # 開発サーバー + Electron
npm run electron:build # Windows インストーラ（nsis）生成
```

- シード付き乱数なので、HUD に表示されるシード値で同じゲームを再現できます。
- モード・難易度・ルート表示の設定は `localStorage` に保存されます。

## GitHub Pages へのデプロイ

`.github/workflows/pages.yml` がテスト・ビルド・デプロイを行います。**手動実行のみ**です（Actions タブ → Deploy to GitHub Pages → Run workflow）。
非公開リポジトリでは、無料プランだと GitHub Pages を使えません。

**注意: リポジトリの Settings → Pages → Source を「GitHub Actions」に設定してください。**
設定しないとデプロイワークフローが実行されません。

ビルドは `base: './'` なので、サブパス（`https://<user>.github.io/<repo>/`）でも相対パスで動作します。

## Electron

`electron/main.cjs` は `contextIsolation: true` / `nodeIntegration: false` で起動します。
`npm run electron` は `dist/index.html` を読み込み、`npm run electron:dev` は開発サーバー
（`VITE_DEV_SERVER_URL`）を読み込みます。

---

# Cat Escape (English)

A hex-board game that includes both classic "Trap the Cat" (Chat Noir) and its
reverse, where you play the cat and escape. Rendered in 3D with Babylon.js;
runs as a desktop app via Electron and on GitHub Pages from the same build.

## How to play

- **Trap the Cat (trapper mode)**: you place blocks, the AI moves the cat. Trap it so it cannot move.
- **Cat Escape (escape mode)**: you move the cat, the AI places blocks. Reach any edge cell to win.
- Three difficulties — **Easy / Normal / Hard** — change both the number of
  initial blocks and the strength of the AI (see `doc/gamedesign.md`).
- The cat wins by reaching an edge cell; you win when the cat has no empty
  neighbor at the start of its turn.
- Tick "Show path hint" to highlight the cat's shortest route to the edge.
- Drag to rotate the camera, scroll / pinch to zoom.

## Development

The project lives in the repository's `CatEscapeJs/` folder.

```bash
cd CatEscapeJs
npm install
npm test          # vitest (pure-logic unit tests)
npm run dev       # Vite dev server
npm run build     # build dist/ (relative paths)
npm run preview   # preview dist/
npm run electron  # build, then launch Electron
npm run electron:dev   # dev server + Electron
npm run electron:build # Windows installer (nsis)
```

- The RNG is seeded: the seed shown in the HUD reproduces the same game.
- Mode / difficulty / hint settings are saved to `localStorage`.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` tests, builds and deploys. It runs **manually only** (Actions tab → Deploy to GitHub Pages → Run workflow).
GitHub Pages is not available for private repositories on the free plan.

**Note: set the repository's Settings → Pages → Source to "GitHub Actions".**
The workflow will not deploy until the source is set.

The build uses `base: './'`, so it also works from a sub-path
(`https://<user>.github.io/<repo>/`) via relative paths.

## Electron

`electron/main.cjs` runs with `contextIsolation: true` / `nodeIntegration: false`.
`npm run electron` loads `dist/index.html`; `npm run electron:dev` loads the dev
server via `VITE_DEV_SERVER_URL`.
