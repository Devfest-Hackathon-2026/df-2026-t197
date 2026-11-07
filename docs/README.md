# リポジトリ案内

## フォルダの役割

```text
src/                 実行コード
  cli.mjs            コマンド入口
  server.mjs         新規生成HTTPの入口
  pptx/read/         PPTX索引
  pptx/edit/         XMLの限定編集と保存
  pdf/               PDF抽出と根拠付き生成
skills/research-slides/  自作skillと用途別の操作案内
.agents/skills/      Codexが自作skillを見つける入口
test/                自作の合成資料による回帰試験
examples/            公開可能な架空データ
scripts/
  smoke.mjs          公開用の合成データだけでCLIの一連の操作を確認
  preview.ps1        PowerPointによる描画
out/                 ローカル入力索引・生成結果（Git対象外）
_pending_delete/     不要になった途中版の削除保留（Git対象外）
node_modules/        ローカル依存（Git対象外）
```

コードは公開可能な実行処理と自作fixtureに限定する。論文原本、配布テンプレート、私有資料、生成したPPTX/画像、機密情報、API鍵は公開対象に含めない。

## 文書の読み方

1. [status.md](status.md): 最新の実装範囲と残課題。
2. 実装の契約: [読取](pptx-reader.md)、[直接編集](pptx-edit.md)、[PDF](pdf-paper-pipeline.md)。
3. 設計上の目標: [全体設計](replacement-design.md)、[受入試験案](replacement-acceptance.md)。全項目が合格した一覧ではない。
4. 初期試作: [仕様](specification.md)、[受入条件](acceptance.md)。初期範囲の記録として保持。
5. 調査: [機能対応表](source-capability-map.md)、[前提整理](replacement-planning.md)、[利用物](dependencies.md)。
6. [実験記録の雛形](experiment-template.md)。

AGENTS.mdから参照される文書を含むため、既存の仕様ファイル名は維持する。古い記録の「当時未実装」と現在の状態はstatus.mdで区別する。

## 開発・確認

Node.js 22以上で`npm ci`、`npm test`。PDF試験はPython環境へ`requirements-pdf-test.txt`を導入し、別途実行する。

`npm run smoke`で、外部の論文・テンプレートなしに新規生成と直接編集を試せる。

```powershell
python -m unittest discover -s test -p pdf_reader_test.py
node src/cli.mjs render examples/demo.deck.json out/my-demo.pptx
powershell -NoProfile -File scripts/preview.ps1 -InputPptx out/my-demo.pptx -OutputDirectory out/my-preview
```


## 公開時の扱い

公開候補は実行コード、skillとその入口、試験用の自作データ、導入に必要な設定と文書。比較用の原本・画像・PPTXとローカルの作業ログは `out/` に置く。退避した試行ファイルの移動元と移動先は `_pending_delete/` 内のmanifest.jsonに記録する。
