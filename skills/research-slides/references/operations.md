# 共通コードの使い方

リポジトリルートから実行する。Node.js 22以上と `npm ci` が必要。ライブラリを同梱せずpackage-lock.jsonから取得する。CLIとHTTPの生成器はLLMを呼び出さず、AIが決めた構成をPPTXにする。

## 1. 入力作成

論文PDFは `read-pdf` で本文・語の座標をページ別に取得し、原本で読解・照合する。図表の切り出し計画と論文からの生成には[PDF入力の手順](pdf-input.md)を読む。抽出順序と意味理解、出典検査と事実確認を区別する。

参考PPTXは `node src/cli.mjs read path/to/source.pptx out/read-v1/index.json` で読み取り専用の索引を作れる。`issues` と `limitations` を読み、未解釈要素がある状態を全文抽出・書式再現の完了として扱わない。詳細は `docs/pptx-reader.md`。このコマンドは既存資料を編集しない。

`src/schema.mjs`を読み、同じ契約で構成JSONを作る。`examples/demo.deck.json`は機能試験用の架空データであり、研究内容や実験値の根拠にしない。

- 各ページと要素に安定IDを付ける。修正時はIDを維持する。
- `body`は共通本文プレースホルダー。`elements`は自由配置で、文字・画像・図形・表・グラフを指定する。
- 自由配置にはインチ単位の座標・寸法を指定する。
- 自由配置のテキストは個別書式となる。本文プレースホルダーの継承と混同しない。
- 出典は各ページの`sources`、詳しい補足は`notes`へ記録する。
- `provenance`には実際のAIとモデル・依頼文を記録する。推測したモデル名を書かない。
- 画像のパスは構成JSONと同じフォルダ以下に置く。外部URLの取得は未対応。HTTPではPNG/JPEGのdata URLだけを使う。

## 2. 検査・生成

```text
node src/cli.mjs validate path/to/deck.json
node src/cli.mjs render path/to/deck.json out/deck-v1.pptx
node src/cli.mjs inspect out/deck-v1.pptx
```

生成時にレポートも作成する。既存出力は上書きしない。レポートの構造検査・過密警告と、実際の表示を分けて判断する。`inspect`はXSD検証やOfficeでの動作保証ではない。

## 3. 構成修正

```text
node src/cli.mjs patch path/to/deck.json path/to/patch.json out/deck-v2.json
node src/cli.mjs render out/deck-v2.json out/deck-v2.pptx
```

操作は`replace`、`insert`、`remove`、`reorder`。例は`examples/demo.patch.json`。相対パスの画像を使う構成を別フォルダへ移す場合、画像も新しい構成フォルダ以下へ配置するかdata URLへ変換する。

これは構成からの再生成。人がPowerPointで修正したPPTXをこのJSON経路で作り直すと人の変更を失う。既存PPTXは[限定した直接編集](editing.md)へ振り分ける。直接編集でも未対応の操作は、黙って再生成へ置き換えない。

## 4. 表示確認

WindowsとPowerPointがある場合:

```text
powershell -NoProfile -File scripts/preview.ps1 -InputPptx out/deck-v1.pptx -OutputDirectory out/preview-v1
```

全ページのPNGを開いて確認する。修正後は別の出力先へ再描画する。Linuxでの画像化はまだ実装していない。画像化できない場合は未確認と報告する。

## 5. 実験履歴

`docs/experiment-template.md`の項目を作業用の非公開フォルダへ記録する。CLIのskillハッシュは版の記録であり、AIによる読み込みの証拠ではない。実際のファイル読み取りと実行履歴を併記する。

## 6. HTTP

`npm start`で8080番ポート、`PORT`で変更可能。`GET /health`、`POST /render`。本文はdeck.json、戻り値はPPTX。APIは構成生成AIの機能を持たず、healthにも未接続と表示する。公開・デプロイ・課金を伴うAI API接続は別工程。
