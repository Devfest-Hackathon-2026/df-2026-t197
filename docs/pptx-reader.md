# PPTX読み取りエンジン v1

2026-11-06。既存資料の直接編集・テンプレート継承に先立つ、読み取り専用の索引作成機能。既存skillのコードや文章の転用は行わず、OOXMLの構造と公開ライブラリを使って実装した。既存資料を書き換える機能の完成を意味しない。

## フォルダと責務

```text
src/
  cli.mjs                  コマンド入口・新規ファイルへの保存
  pptx/
    xml.mjs                名前空間、属性、XML読み取り
    package.mjs            ZIP、OPC参照関係、上限、各パーツのハッシュ
    read/
      index.mjs            ページ順・マスター・レイアウト・テーマの統合
      shapes.mjs           要素ID、階層、画像、表、グラフ、ノート
      geometry.mjs         EMU座標・継承元・回転なしのグループ座標
      text.mjs             段落・ラン・選択した書式と継承元
test/
  pptx-reader.test.mjs      読み取りの回帰試験
  fixtures/pptx-package.mjs 自作の最小パッケージ。実資料を含まない
out/                       実資料の索引など。Git対象外
_pending_delete/           旧出力の削除保留。Git・コンテナ対象外
```

従来の `renderer.mjs`、`schema.mjs`、`patch.mjs` は新規生成用の試作として維持する。読み取ったPPTXを従来の狭い構成JSONに変換して上書きしない。今後の直接編集機能は `pptx/` の共通パッケージ処理を利用するが、現時点で編集用モジュールは未実装。

## 操作

リポジトリルートでNode.js 22以上と依存関係を用意する。

```text
node src/cli.mjs read path/to/source.pptx out/read-v1/index.json
```

出力は上書き不可。読み取りは入力を保存・変更せず、外部URLにもアクセスしない。索引には本文・ノート・参照先が含まれるため、私有資料の場合は `out/` 以下に保存する。標準出力は件数と状態のみ。`read` の終了コードは0が読取完了（警告を含み得る）、2が部分読取、1が処理失敗。JSONの `status` と `issues` を必ず確認する。

## 入力・出力契約

- PPTXのZIPパッケージを対象とする。旧PPT・暗号化・ZIP64・複数ディスクZIPは対象外。
- ファイル名の数字順ではなく、presentationのページ一覧とRelationshipから実順序を得る。非表示ページも含め、読めないページの位置も保持する。
- 要素はページ内IDとグループ内の親ID、XMLパーツ名を併記する。IDは資料全体で一意とは限らない。
- 座標はEMU。新規生成用JSONのインチと混同しない。未解決値はnull。回転・反転を伴うグループのページ座標は推定しない。
- プレースホルダーはslide→layoutをidx、layout→masterをtypeで照合し、候補が複数ならエラーにする。
- 本文・段落・ラン・フィールド・改行、宣言された書式、選択した継承元を記録する。画像は埋め込み/外部参照・切り取り、表はセル文字と結合属性、グラフは式とキャッシュ値、ノートは本文を収集する。
- 入力全体と各ZIPパーツのSHA-256、コンテンツタイプ、参照先の存在を記録する。後の編集で変更範囲を検査する基盤にする。
- 既定上限は入力64MiB、展開合計128MiB、パーツ64MiB、XML8MiB、ZIPエントリ10,000。DTD・不正パス・重複ZIP名などは拒否する。

## 限界

Officeの完全な書式計算や描画器ではない。テーマ色の変換、themeOverride、フォント代替、表スタイル、各種効果、ノートの全書式継承を再現しない。書式の `resolved` は記載された範囲の宣言値の解決であり、画面上の実測値ではない。

互換表示用の `mc:AlternateContent` は選択分岐を解釈せず、`unsupported-element` と警告を出す。内容の復元や全文抽出の完了とは扱わない。数式の解読、OCR、埋め込みブックとの値照合、XSD検証、PowerPointでの表示確認も未実施。UTF-8 XMLを前提とする。外部参照は取得しない。

## 検証

自作fixtureで実ページ順、Strict名前空間・別prefix、継承と明示false、空白保持、グループ座標、非表示、ノート、外部画像、不明要素、破損参照、重複ID、曖昧な照合、XML/ZIP拒否、サイズ上限を検査する。生成試作との統合でネイティブ表・グラフ・画像・ノートも検査する。空の `r:id` を持つ動画再生アクションは、画像参照の欠落と区別する。

私有の参考PPTXで30ページ・マスター1・レイアウト11・ノート30を確認。Python標準ライブラリによる独立照合で、ページ順・ID・本文・ノート要素・表62セル・レイアウト参照・全216パーツのハッシュが一致した。照合した要素は2,874、本文を持つ要素は1,790。互換表示用の未解釈要素35件は警告として残る。私有の本文・原本パスはこの文書に収録しない。独立照合も書式計算や描画の正しさは保証しない。

## 参照仕様

- [Microsoft: PresentationMLの構造](https://learn.microsoft.com/en-us/office/open-xml/presentation/structure-of-a-presentationml-document)
- [Microsoft: プレースホルダーの継承](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/8b5c01b6-a623-4952-a8ab-e6a5177e47ec)
- [python-pptx: プレースホルダーの照合](https://python-pptx.readthedocs.io/en/latest/user/placeholders-understanding.html)
- [Microsoft: クリックアクション](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/a65b76db-6abc-4989-8cd1-baa9a3500f6f)
