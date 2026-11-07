# DevFest Hackathon 2026 提出用リポジトリ

論文や参考PPTXから、編集可能なスライドを作成・修正する自作skillと共通コードを開発しています。現在はローカル試作で、AI API・Cloud Runは未接続です。

第一版はローカルCLIと自作skillの開発者向けプレビューです。論文を渡すだけの自動生成サービス、任意テンプレートの完全編集、無修正で発表できる品質の保証は、現在の対応範囲に含みません。

## 最初に読むもの

- [現在の対応機能・残課題](docs/status.md)
- [フォルダ構成・文書案内](docs/README.md)
- [自作skill](skills/research-slides/SKILL.md)

Codexではこのリポジトリを作業フォルダにした新規セッションで、自作の `research-slides` を使えます。論文PDFと参考PPTXを渡し、「この論文の内容を10分で発表します．スライドの例と論文を送るのでこれをもとにスライドを作成してください．」のように依頼します。テンプレートを使うときの選択・検査・修正手順は[論文とテンプレート](skills/research-slides/references/paper-template.md)にあります。

## ローカル実行

Node.js 22以上が必要です。既存の出力名は再利用できません。

```powershell
npm ci
npm test
npm run smoke
node src/cli.mjs render examples/demo.deck.json out/my-demo.pptx
node src/cli.mjs read path/to/source.pptx out/read-v1/index.json
node src/cli.mjs edit path/to/source.pptx plan.json out/edited-v1.pptx
```

`npm run smoke`は同梱の架空データだけで5枚を生成し、索引取得、タイトルのXML編集、対象外ページの保持、構造検査、上書き拒否を確認します。成果物と編集計画は毎回新しい`out/smoke-*`へ保存します。PowerPointの表示・保存試験やPDF処理は含みません。まずこのコマンドを、取得後の動作確認に使ってください。

入力契約と手順は[新規生成](skills/research-slides/references/operations.md)、[PPTX読取](docs/pptx-reader.md)、[直接編集](docs/pptx-edit.md)。文字・段落・未結合表セル・ページ操作・ローカル書式/位置・通常画像差し替え・既存専用ノートの限定編集に対応します。完全なテンプレート継承や任意形式の編集を保証するものではありません。

PDFを使う場合は、Python 3.11以上の環境に依存を導入します。

```powershell
python -m pip install -r requirements-pdf-test.txt
python -m unittest discover -s test -p pdf_reader_test.py
node src/cli.mjs read-pdf path/to/source.pdf out/paper-read-v1
node src/cli.mjs render-paper out/paper-read-v1/index.json paper-plan.json out/paper-v1.pptx
```

実行用依存だけなら`requirements-pdf.txt`を使用します。`SLIDES_PYTHON`でPython実行ファイルを指定できます。PDFの準備と制限は[PDF入力仕様](docs/pdf-paper-pipeline.md)。`npm test`にはPython試験を含みません。

WindowsとPowerPointがある場合、最終出力を描画して表示を確認します。

```powershell
powershell -NoProfile -File scripts/preview.ps1 -InputPptx out/my-demo.pptx -OutputDirectory out/my-preview
```

`npm start`で新規生成用HTTPを起動します（既定8080、`PORT`で変更）。`GET /health`と`POST /render`に対応し、構成JSONからPPTXを返します。API自身はLLMを呼びません。DockerfileはこのHTTP向けで、PDF・PowerPoint描画を含む環境ではありません。

## 公開対象と作業ルール

`src/`・自作skill・合成fixture・仕様/検証記録を公開対象とします。原本資料、配布テンプレート、私有スライド、生成物、鍵は含めません。生成物は`out/`、削除保留は`_pending_delete/`へ置き、どちらもGit対象外です。PowerPoint/PDFファイルは既定で除外します。

開発ルールは[AGENTS.md](AGENTS.md)、利用物とライセンスの記録は[dependencies.md](docs/dependencies.md)。現在、コミット・push・PR・マージは行っていません。


---

  DevFest Hackathon 2026 のチームの **最終提出用** リポジトリです。提出期限までに、作品のコードと資料をこのリポジトリに置いてください。

  このリポジトリは **公開（public）** です。開催中も、運営・審査員・ほかの参加者が見られます。

  ## はじめに

  1. GitHub から届いた招待を受け入れてください（招待の期限は 7 日です）
  2. このリポジトリを clone して、提出物を置いてください

  招待の期限が切れたときや、メンバーが変わったときは、運営に連絡してください。

  ## 開発用のリポジトリは別に作ることをおすすめします

  このリポジトリでは **GitHub Actions と GitHub Pages が使えません**。CI やデプロイ、Pages での公開をしたいときは、チームで開発用のリポジトリを別に作ってください。

  - 開発用のリポジトリは、チームのメンバーのアカウントや、チームで作った Organization に作ってください
  - 開発はそちらで進めて、提出期限までに最終版のコードと資料をこのリポジトリに push してください
  - 審査はこのリポジトリの内容で行います。開発用のリポジトリにしかないものは、審査の対象になりません
  - デプロイした作品の URL があれば、この README に書いてください

  ## 秘密情報をコミットしない

  API キー・パスワード・サービスアカウントの鍵などは、**絶対にコミットしないでください**。公開リポジトリなので、push
  した時点で誰でも見られます。開発用のリポジトリから持ってくるときも、履歴ごと push すると、過去のコミットに含まれる秘密情報も公開されます。

  - 秘密情報は `.env` や `.dev.vars` などに書き、コミットしない（`.gitignore` に入れてあります）
  - 誤って push したら、すぐにキー（鍵）を無効にして作り直し、運営に連絡してください。履歴から消すだけでは不十分です
  - GitHub の push protection が、よく知られた形式のキーの push を止めることがあります。止められたら、そのキーをコミットから外してください

  ## 提出

  提出の方法と締切は、運営からの案内に従ってください。提出期限を過ぎると、このリポジトリは読み取り専用になり、push できなくなります。

  ## ライセンス

  [MIT License](LICENSE) です。ほかのライセンスにしたいときは、LICENSE を書き換えてください。
