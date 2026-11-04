# AGENTS.md

このリポジトリで開発するメンバー（人と AI エージェント）向けの、共通認識と開発ルールです。

- AI エージェントは、このファイルに従って作業してください
- 方針が決まったり変わったりしたら、その変更と同じ PR でこのファイルも更新してください

## プロジェクト概要

- **作るもの**: 人の手で直さなくてもそのまま使えるスライド（.pptx）を、AI で作れるようにするプロダクト
- **背景**: Claude Code に Anthropic 公式の pptx skill を読み込ませても、作られたスライドはまだ完璧ではなく、人の手で直す必要がある
- **ゴール**: 人の手で直す必要のない、良いスライドを作れるようにする。そのための形（skill / Python ツール / それ以外）は問わない

## ハッカソンの前提

| 項目 | 内容 |
| --- | --- |
| イベント | DevFest Hackathon 2026（GDGoC Japan） |
| Product category | **クリエイティブ**（カテゴリ外は審査の対象外） |
| 実行基盤 | **Cloud Run**。必須条件「アプリの実行に App Engine / Compute Engine / GKE / Cloud Run / Firebase App Hosting / Firebase Hosting のうち 1 つ以上を使う」を Cloud Run で満たす |
| 審査 | このリポジトリ（公開）の内容で審査される。デプロイした URL は README.md に書く |
| 提出 | 提出方法と締切は運営の案内に従う。締切を過ぎると push できなくなる |

## 進め方

1. **既存の pptx skill を読む**
   - 場所: https://github.com/anthropics/skills/tree/main/skills/pptx
   - 特に見ること: テンプレート（スライドマスター・レイアウト・プレースホルダー）をどう扱っているか。作ったスライドの見た目をどう確認しているか
2. **普段作っているようなスライドを、各メンバーが AI に作らせる**
   - Claude Code と既存の pptx skill で作る。これを改善前の基準にする
   - 直したくなった箇所と、その原因（skill のどこが悪いか）を `docs/findings/` に記録する（書き方は後述）
3. **集まった問題点を分類して、何を作るか決める**
   - 成果物の形と、Cloud Run で何を動かすかもここで決める
4. **作ったら、手順 2 と同じお題で作り直して比べる**
   - 人の手で直す箇所が減ったか（なくなったか）で評価する
   - 改善前と改善後の比較は、そのままデモや発表に使う

### 今の仮説（未検証）

- 既存の skill には「スライドマスターを元にスライドを作る」仕組みが足りないのではないか（チーム内の指摘。skill をまだ読んでいないので予想）
- 確かめたら、結果をここに書く

### まだ決まっていないこと

- **成果物の形**: skill / Python ツール / それ以外（Web アプリ、MCP サーバーなど）
- **Cloud Run で何を動かすか**: skill や手元で動く Python ツールだけだと、アプリの実行に Cloud Run を使っていないので必須条件を満たせない。処理の一部を Cloud Run 上のサービスにする必要がある（例: スライドを作る・確かめる API、リモート MCP サーバー、Web 画面）

## 既存の pptx skill の扱い（重要）

Anthropic の pptx skill はオープンソースではありません。同じフォルダの LICENSE.txt で、複製・派生物の作成・再配布などが禁止されています。このリポジトリは公開（MIT License）なので、次を守ってください。

- pptx skill の SKILL.md・スクリプト・文章を、このリポジトリにコピーしない
- pptx skill に手を入れたもの（派生物）をコミットしない。改善版は、自分たちのコードとプロンプトとして一から書く
- 読んで仕組みを理解する、Claude で使って出力を比べる、問題点を自分の言葉でまとめる、はしてよい
- 迷ったら、コミットする前にチームに相談する

## 公開リポジトリなので気をつけること

このリポジトリは、開催中も運営・審査員・ほかの参加者が見られます（詳しくは README.md）。

- API キー・パスワード・サービスアカウントの鍵などは、絶対にコミットしない（`.env` などに書く。`.gitignore` に入れてある）
- 業務の実際のスライド、社外秘の情報、顧客の情報、会社のテンプレート（ロゴ入りのスライドマスターなど）はコミットしない。検証に使うお題やテンプレートは、ダミーや自作のものにする
- このリポジトリでは GitHub Actions と GitHub Pages が使えない

## チーム開発ルール

- **main に直接コミット・push しない**。作業は必ずブランチを切って行う
- **PR を作って、自分でマージする**。ほかのメンバーの承認は要らない（見てほしいときだけ PR で声をかける）
- **マージしたら、ブランチを削除する**（リモートとローカルの両方）
- マージは squash で行う（1 つの PR が main の 1 コミットになる）
- コミットメッセージと PR のタイトルは Conventional Commits 形式にする（例: `feat: ...`、`fix(api): ...`、`docs: ...`）。説明は日本語で書く

### 手順

```bash
# 1. main を最新にして、ブランチを切る（名前は <種類>/<内容>）
git switch main && git pull
git switch -c feat/xxx

# 2. 作業してコミットしたら、push して PR を作る
git push -u origin HEAD
gh pr create --title "feat: ..." --body "何を、なぜ変えたか"

# 3. 自分でマージして、ブランチを消す（--delete-branch でリモートとローカルの両方が消える）
gh pr merge --squash --delete-branch

# 4. main を最新にする
git switch main && git pull --prune
```

- main とコンフリクトしたら、`git fetch origin && git merge origin/main` で取り込み、解消して push してからマージする
- GitHub の画面でマージしたときは、PR の画面の「Delete branch」でリモートのブランチを消し、ローカルでは `git switch main && git pull --prune && git branch -D <ブランチ名>` を実行する

## 調査結果の書き方（`docs/findings/`）

お題 1 つにつき 1 ファイル（例: `docs/findings/<名前>-<お題>.md`）。

```markdown
# <お題>

- 作った人:
- 依頼内容（プロンプト）:
- 使ったテンプレート: （なし / 自作 / ダミー など）
- 作られたスライド: （スクリーンショット）
- 直したくなった箇所とその理由:
- 原因の予想（skill のどこが悪いか）:
```

## AI ツールの設定

- **Claude Code**: このリポジトリの `CLAUDE.md` が AGENTS.md を読み込むので、設定は要らない
- **Codex など AGENTS.md に対応したツール**: そのまま読まれる
- **Gemini CLI**: 標準では `GEMINI.md` しか読まないので、settings.json に `"context": {"fileName": ["AGENTS.md", "GEMINI.md"]}` を追加する
