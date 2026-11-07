# PDFの取り込みから論文スライド生成まで

2026-11-06。ローカルでの最初の一連の動作。PDF抽出コード、AIによる読解・構成、出典検査、PPTX生成、表示・編集確認を分離する。既存のPPTX skillのコード・文章や専用ライブラリには依存しない。

## フォルダ構成

```text
src/pdf/
  read.py       PDFのページ別本文・語の座標・指定範囲のPNG取得
  bridge.mjs    Node CLIからPythonを呼ぶ。外部AI APIは呼ばない
  paper.mjs     ページ根拠・図のハッシュ検査と既存生成器への接続
requirements-pdf.txt        実行用Python依存の直接版固定
requirements-pdf-test.txt   自作PDF fixture生成用のテスト依存
test/pdf_reader_test.py     自作PDFでの抽出・切り出し・失敗試験
test/paper.test.mjs         根拠・画像保持と生成の接続試験
out/                       本文・図表・構成・出力・レビュー。Git対象外
```

## 操作

Python 3.11以上とNode.js 22以上を使う。Python環境に `python -m pip install -r requirements-pdf.txt` で依存を用意する。CLIは既定で `python` を起動する。別のPythonを使う場合はPowerShellで `$env:SLIDES_PYTHON='使用するpython.exeの絶対パス'` を設定する。環境付属のPythonパスは他のPCへ移植する設定としてハードコードしない。

```text
node src/cli.mjs read-pdf source.pdf out/paper-read-v1
node src/cli.mjs read-pdf source.pdf out/paper-read-v2 regions.json
node src/cli.mjs render-paper out/paper-read-v2/index.json paper-plan.json out/paper-slides-v1.pptx
```

出力ディレクトリ/ファイルは新しい名前にする。原本は変更しない。本文の抽出後、AIが原本と抽出結果を確認して領域指定・構成・根拠を作る。`render-paper` はPDFから自動的に説明を考えるコマンドではない。

## PDF索引と範囲指定

索引は入力SHA-256・ページ別本文とそのSHA-256・語の座標・物理ページ番号とページラベル・使用ライブラリ版を持つ。本文がない場合はOCR未実施と記録し、「空のページ」とは判定しない。ページ番号は1始まり、座標は表示ページ左上からのPDFポイント（1/72インチ）。複数段・数式・下付き文字などの抽出順序は保証しない。

範囲指定の形:

```json
{
  "version":1,
  "sourceSha256":"索引に記録された64桁のSHA-256",
  "regions":[
    {"id":"figure-one","page":3,"box":[190,65,423,398],"label":"Figure 1","kind":"figure"}
  ]
}
```

`box` は `[left, top, right, bottom]`。`kind` は `figure` / `table` / `page` / `other`。図表の自動検出結果ではなく、AIまたは利用者が指定した範囲である。表の切り出しも画像であり、セル構造の復元ではない。PNGと出典ページ・範囲・ハッシュを記録する。

既定144dpi。Python CLIには `--dpi`（72–300）を指定できる。入力64MiB・300ページ・抽出本文800万文字・1ページ10万語・切り出し50件・1画像2,000万画素の上限を持つ。Nodeからの実行は180秒でタイムアウトする。暗号化PDF、範囲外、古い入力ハッシュ、パスに使えない領域IDなどは拒否する。描画と抽出の座標系が合わないPDFでは領域取得を拒否する。任意のCropBox・回転・UserUnitへの対応を保証しない。

PDFはデータとして読み、添付の命令・JavaScript・リンクを実行しない。フォーム外観の完全再現は対象外。OCR、数式解読、自動節分け、図表認識、表セルの自動復元は未実装。

## 論文からの生成計画

```json
{
  "version":1,
  "sourceSha256":"PDF索引のSHA-256",
  "deck":{"version":1,"title":"資料の題名","slides":[]},
  "evidence":[
    {"id":"claim-one","slideId":"slide-one","page":2,"anchor":"抽出本文中の語句","statement":"この箇所を根拠に説明する内容"}
  ],
  "assetBindings":[
    {"slideId":"appendix","elementId":"source-figure","assetId":"figure-one"}
  ]
}
```

`deck` は既存の `src/schema.mjs` の契約を使い、1枚以上が必要。各ページに少なくとも1つの根拠を求める。`anchor` は空白だけを取り除いて、指定PDFページの抽出本文に存在するか検査する。本文ハッシュや図のハッシュも検査し、出典をノートへ追記する。図のパスは索引ディレクトリ内へ制限する。`assetBindings` の指定画像は索引のPNGへ差し替え、縦横比を維持して配置する。

この検査は出典への追跡であり、主張・数値・翻訳の意味が正しいことを自動証明しない。数式や表の値は原本を目視で照合する。画像内文字は編集できない。生成AI APIは呼ばず、この会話のCodexが計画を作成した。

## 最初の実論文デモ

利用者提供のAttention Is All You Need（arXiv v7）15ページから35,511文字と指定4領域を取得。本編5枚＋原図の付録1枚を作成した。参考PPTXは白背景・黒文字・紺の区切り線を外観参考として扱い、マスターをインポートした資料ではない。過去資料の別研究の主張・人物名は流用していない。発表時間・聴衆未確定のため、輪講全体の完成版ではなく、仕組みと主要結果の抜粋である。

- 本編: 動機、Encoder/Decoder、Attention、Multi-Head/位置情報/マスク、英独翻訳結果。
- 付録: 出典のモデル図。原図は画像で、投影時の小さいラベルは拡大確認が必要。
- 表2の英独値26.36・27.3・28.4と、bigの8 P100・3.5日を目視照合。
- 英仏の41.8（表2/要旨）と41.0（§6.1）の不一致を注記し、英仏比較は採用しない。
- Attentionの式は編集可能な通常テキスト。ネイティブ数式オブジェクトではない。
- 本編の独自図は省略を含む。Residual/LayerNorm等はノートと付録へ案内した。

全6ページをPowerPointで描画し、文字切れ・不要な重なりを目視確認した。過密推定の警告は実描画で確認した範囲では問題なし。小さい文字の警告は引用/補足に使う18–20ptで、本編の主要本文は24–32pt。自由配置の個別書式警告は残し、全要素がマスターから一括変更できるとは扱わない。

本文・ネイティブ表セルをPowerPointで変更できた。ラスタ画像は原図の1枚だけ。タイトルのレイアウト34→42pt変更が反映され、同レイアウトでの後日の追加も42ptとなった。試験変更は保存していない。全マスター・他アプリ・Cloudでの表示まで検証した結果ではない。

出力は `out/paper-demo-v2/attention.pptx`、全ページ画像は同じフォルダの `preview/`、原本索引は `out/paper-read-v2/`。本文・計画・図・成果物はGit対象外。

## 試験

```text
python -m pip install -r requirements-pdf-test.txt
python -m unittest discover -s test -p pdf_reader_test.py -v
npm test
```

Pythonの6項目と、Nodeの48項目が成功（Node表示はfixture読込を含め49件）。自作PDFで本文・座標・空ページ・切り出しの向き/画素・暗号化・古い入力・不正範囲・重複ID・上書き防止・失敗時の一時出力整理を確認した。私有原本を公開fixtureには使わない。

## 参照

- [pdfplumberの本文・座標API](https://github.com/jsvine/pdfplumber)
- [pypdfium2の描画・切り出しAPI](https://pypdfium2-team.github.io/pypdfium2/python_api.html)
- [pypdf](https://pypdf.readthedocs.io/)
