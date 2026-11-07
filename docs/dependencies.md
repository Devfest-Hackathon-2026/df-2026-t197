# 利用物・技術選定記録

## 初期実装

| 利用物 | 用途 | ライセンス | 選定理由・代替案 |
| --- | --- | --- | --- |
| PptxGenJS | PPTXの生成 | MIT（インストール版も確認する） | Nodeから文字・図形・表・グラフを生成できる。XMLを全て自作する負担を避ける |
| Ajv | JSON Schemaによる入力検査 | MIT | AIが生成した不正な構成を生成前に検出する |
| JSZip | PPTX内部の読み取り | MIT または GPL-3.0-or-later。MITを選択 | ZIP内の部品確認に使用 |
| @xmldom/xmldom | XML参照の解析 | MIT | 正規表現だけでPPTX構造を判定しないため |
| image-size | 画像寸法の取得、生成ライブラリの間接依存 | MIT | 既知の脆弱性を避けるため2.0.4をoverride。PNG/JPEGの縦横比を維持するため直接も利用 |
| Node.js | CLI・HTTPサービス | 配布物のライセンスに従う | ローカルとCloud Runでコードを共有できる |

実際の版はpackage-lock.jsonを正本とする。ライセンス表記はインストール後にパッケージのメタデータと同梱ライセンスで確認する。

2026-11-06確認版: PptxGenJS 4.0.0、Ajv 8.20.0、JSZip 3.10.2、@xmldom/xmldom 0.9.12、image-size 2.0.4。npmのインストール監査は脆弱性0件。画像は実寸を取得してcontain相当の配置を計算する。ライブラリの`sizing`指定だけではPowerPoint上の縦横比が保たれなかったため、配置を独自に計算して試験する。

## 調査対象

Anthropicのpptx skillと、この環境付属のPresentations skillは調査対象。ファイル・文章・コードを配布物へコピーしない。実行時の依存物としても同梱しない。

## 代替案と未決事項

- 環境付属Artifact Tool: このチャットで利用可能だが、他AIやCloud Runでの配布・利用条件は別途確認が必要なため、独立プロジェクトの必須依存にしない。
- PythonによるPPTX処理: 既存ファイルの検査・編集に適する可能性があるが、初期の生成コードはNodeへ揃える。
- マスターの完全な継承、ネイティブ数式、既存PPTXの編集は、実物の検証後に実装方式を決める。
- PDF抽出・描画のローカル依存は下記に追加した。Linux/Cloudの日本語フォントとGemini APIの接続は未完了。

## PDF取り込みで追加した依存

直接版は `requirements-pdf.txt`。Python 3.11以上。確認環境は付属ランタイムであり、利用者のPCやCloudへ自動インストール済みという意味ではない。

| パッケージ | 版 | 用途 | 利用条件の識別 |
| --- | --- | --- | --- |
| pypdf | 6.10.0 | 暗号化判定・ページラベル・メタデータ | BSD-3-Clause（インストールメタデータ） |
| pdfplumber | 0.11.9 | 本文・語の座標 | MIT（公式配布） |
| pypdfium2 | 5.14.0 | 指定範囲のラスタ描画 | BSD-3-Clause / Apache-2.0とPDFium依存ライセンス。配布時に同梱noticeを確認 |
| Pillow | 12.3.0 | 描画PNGの保存 | MIT-CMU（インストールメタデータ） |
| reportlab | 4.4.9 | 自作PDFの試験fixture作成のみ | BSD系。実行用ではなく `requirements-pdf-test.txt` |

追加インストールは行わず、この環境付属の既存パッケージで試験した。Pythonの間接依存の完全ロック・Cloudコンテナへの導入・全ライセンスnoticeの配布は別工程。PDF自体と抽出図の利用条件はライブラリのライセンスとは別に記録する。

## 公式参照

- https://gitbrent.github.io/PptxGenJS/
- https://gitbrent.github.io/PptxGenJS/docs/masters/
- https://ajv.js.org/
- https://stuk.github.io/jszip/
- https://github.com/xmldom/xmldom

提出時には実際に使用した素材・データ・API・ライブラリを、運営の著作物利用シートへ整理する。
