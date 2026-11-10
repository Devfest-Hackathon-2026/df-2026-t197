# MCPサーバー

共通の生成・検査・編集コードを、MCP（Model Context Protocol）のツールとして公開する。判断（構成・説明・出典）は呼び出し側のAIとskillが行い、サーバーは決まった処理だけを行う。Claude Code・Gemini CLI・Codexなど、Streamable HTTPに対応したクライアントから同じサーバーを使える。

実装: `src/mcp.mjs`（ツール）、`src/server.mjs`（HTTP）、`src/files.mjs`（一時ファイル）。試験: `test/mcp.test.mjs`。

## エンドポイント

| メソッド・パス | 内容 | 認証（`ACCESS_TOKEN`設定時） |
| --- | --- | --- |
| `GET /health` | 稼働確認 | 不要 |
| `POST /mcp` | MCP（Streamable HTTP、セッションなし、JSON応答） | 必要 |
| `POST /render` | 従来のREST。本文deck.json → PPTX | 必要 |
| `POST /files` | PPTXを登録。本文はPPTXそのもの、`X-File-Name`で名前 | 必要 |
| `GET /files/<fileId>` | 生成・登録したPPTXの取得 | 不要（推測できないIDが鍵） |

`ACCESS_TOKEN`環境変数を設定すると、`Authorization: Bearer <token>`が必要になる。未設定ならトークン検査をしない（Cloud RunのIAM認証で守る前提）。

## ツール

| ツール | 入力 | 出力 |
| --- | --- | --- |
| `validate_deck` | `deck` | 検査結果と警告 |
| `render_deck` | `deck`（入力スキーマは`src/schema.mjs`そのもの） | `fileId`・`downloadUrl`・`sha256`・報告（警告、構造検査、ページ対応） |
| `patch_deck` | `deck`、`operations` | 修正後のdeckと警告 |
| `upload_pptx` | `base64`、`name` | `fileId`・`sha256`。大きいファイルは`POST /files` |
| `inspect_pptx` | `fileId` | 構造検査 |
| `read_pptx` | `fileId`、`detail`（`summary`/`full`）、`pages` | 既定は段落の文字・位置・プレースホルダー・レイアウト一覧の要約。`full`は継承情報まで含み大きい |
| `edit_pptx` | `fileId`、`plan`（入力スキーマは`src/pptx/edit/plan.mjs`） | 新しい`fileId`と変更報告。原本は残る |

入力の誤りは`isError`付きの結果で返し、AIが直して再実行できるようにする。メッセージから絶対パスを除き、長さを制限する。

## 一時ファイルの制約

- ファイルはメモリに置き、既定30分で消える。1ファイル32MiB、合計256MiBまで。上限を超えると古いものから消す。
- インスタンス間で共有しない。Cloud Runでは`--max-instances 1`で動かす。複数インスタンスにするときはGCSの署名付きURLへ置き換える。
- サーバーの再起動で消える。利用者の資料をリポジトリやログに保存しない。

## ローカルでの確認

```bash
npm start
```

```bash
claude mcp add --transport http research-slides http://localhost:8080/mcp
```

## Cloud Runへのデプロイ

GCPプロジェクトの権限を持つメンバーが行う。別の案件のgcloud設定と混ざらないよう、構成（configuration）を分けるとよい。

```bash
gcloud config configurations create devfest
```

```bash
gcloud auth login
```

```bash
gcloud config set project <プロジェクトID>
```

```bash
gcloud run deploy research-slides --source . --region asia-northeast1 --max-instances 1 --set-env-vars ACCESS_TOKEN=<共有するトークン>
```

- トークンはチャットなど非公開の場で共有し、リポジトリに書かない。
- 未認証アクセスを許可するか（`--allow-unauthenticated`）は、公開範囲と費用を決めてから選ぶ。IAM認証のままなら、クライアントからは`gcloud run services proxy`を経由する。
- デプロイ後のURLはREADME.mdに書く。

接続（Claude Codeの例）:

```bash
claude mcp add --transport http research-slides https://<サービスURL>/mcp --header "Authorization: Bearer <トークン>"
```

## 未確認・未対応

- Cloud Run上での稼働、コンテナの実ビルド（2026-11-10時点で未実施）
- PDFの読み取り（Pythonが必要でコンテナに未収録）と論文からの生成のツール化
- LibreOfficeによる描画とスライド画像の返却
- GCSを使ったファイル受け渡し、利用回数の制限
