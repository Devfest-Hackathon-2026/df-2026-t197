# 既存ファイル・機能・現行試作の対応表

作成: 2026-11-06。実装前の調査資料。既存ファイルの文章・実装を複製するための表ではなく、必要な独立機能を特定するための表。

## 調査範囲と読み方

- A: Anthropicのpptx skill。ファイル一覧はリビジョン `ca45fc496a3436251f191354091d557da31c15b5` で確認。処理の説明は以前に閲覧したmainのコード断面と調査記録に基づく。固定版の全コードを精読・実行したとは扱わない。今回の固定URLのコード再取得は一部失敗したため、固定版との差分確認は未完了。
- O: この環境のPresentations skill、26.1026.10807。主要MDは本文確認、コードは一部本文・説明・関数一覧を確認。表の「要精読」は実装詳細の確認が残ることを示す。
- C: このリポジトリの現行試作。列挙したコードは現物を確認した。現在の対応範囲は `status.md`。
- 「設計意図」は明記された目的または処理からの解釈。作者の未記載の意図を断定しない。

## A. Anthropic側

| ID | ファイル・資料 | 確認した役割 | 独自実装で必要なもの・確認残 |
| --- | --- | --- | --- |
| A01 | SKILL.md | 依頼に応じた作成・編集・読解と、確認の指示 | 操作の振り分け、AI判断、失敗時の手順。指示だけで実装済みとは判定しない |
| A02 | scripts/add_slide.py | 既存ページの複製、レイアウトを参照した追加、全体への登録 | ページ操作と参照管理。複製した変更可能な部品の独立性を試験する |
| A03 | scripts/clean.py | 不要になったページや関連部品、登録の整理 | 到達可能な部品を壊さない整理。全削除などの誤判定を避ける条件 |
| A04 | scripts/thumbnail.py | 描画結果をページに対応付け、一覧画像へまとめる | ページ順・非表示状態・画像の対応、描画失敗の検出 |
| A05 | scripts/office/soffice.py | LibreOffice変換の実行環境を調整 | ローカル/クラウド別の描画手段、フォント、タイムアウト、失敗情報 |
| A06 | scripts/office/validate.py | 形式に応じた検査の入口 | 検査の実行契約、原本との比較、結果の分類 |
| A07 | scripts/office/validators/base.py | XML、ID、参照、種類、スキーマなどの共通検査 | 検査結果と未検査の区別。全関数の精読は未完了 |
| A08 | scripts/office/validators/pptx.py | PPTXのレイアウト・ノート・テーマ・グラフ等の検査 | PPTX固有の整合性と既知不具合を扱う検査 |
| A09 | scripts/office/helpers/__init__.py | 部品参照の解決、展開・保存の補助 | 正規化、範囲外参照の拒否、原本を保つ保存 |
| A10 | scripts/office/helpers/pptx_chart.py | グラフのラベル位置や軸参照に関する検査 | 生成・編集対象の形式ごとに、データと参照の整合を確認 |
| A11 | scripts/office/helpers/pptx_slide.py | 既知の重大なXMLエラーの分類 | 構造上の失敗と見た目の問題を分離 |
| A12 | scripts/office/helpers/pptx_theme.py | テーマ共有に関する検査の補助 | ファイル一覧・呼び出し元で役割を確認。本文の詳細は要精読 |
| A13 | scripts/office/schemas/ | 規格に沿うXMLか調べるためのデータ群 | 適切な規格・検証器の採用可否を確認。39ファイルを自作するという意味ではない |
| A14 | validators/docx.py、redlining.py | Word系検査の共有部品 | PPTXに関係する依存だけを整理。Word変更履歴は今回の必須要件に含めない |
| A15 | LICENSE.txt、__init__.py類 | 利用条件、モジュール構成 | ライセンス記録と実行可能な配置。既存パッケージを転載しない |

ここでいうファイル一覧は、PptxGenJS・MarkItDown・LibreOffice等の外部ツール本体まで含んだ一覧ではない。独立環境を作るには外部依存も別に管理する。

## O. この環境の付属版

| ID | ファイル・資料 | 確認した役割 | 独自実装で必要なもの・確認残 |
| --- | --- | --- | --- |
| O01 | SKILL.md | 作業・出力先の振り分け、文章・生成・確認・納品 | 自作の対象範囲に必要な操作と判断 |
| O02 | style_guidelines.md | 内容・指定デザインに合わせた配置と表示確認 | 独自の用途別デザイン判断、読める文字・図表 |
| O03 | references/template_following.md | 元資料の役割判断、構造再利用、前後比較 | 参考利用と直接編集の区別、保持条件 |
| O04 | references/implementation.md | 実行環境、パス、フォント、ライブラリの利用 | 導入手順と依存を独立して再現可能にする |
| O05 | references/finalization.md | 要求に応じた検査条件、最終化、全ページ確認 | 合格条件を要求に結び付ける仕組み |
| O06 | references/native_evidence.md、native_bullets.md | 表・グラフ・箇条書きの作り方への案内 | 個別仕様を精読し、必要な操作・保持条件を抽出する |
| O07 | references/cover_art_direction.md、template-elicitation.md | 表紙とデザイン選択への案内 | 用途とユーザー指定を優先。本文の詳細は追加確認 |
| O08 | references/artifact_sessions.md、routing/google_slides.md | 接続中の資料やGoogle Slidesでの作業 | 独立PPTX機能とアプリ固有の接続を分離する。必須採用はしない |
| O09 | template_following_scripts/inspect_template_deck.mjs | テンプレートを調査する入口 | ページ・部品・配置・継承情報の索引。説明・関数一覧の確認まで |
| O10 | validate_template_plan.mjs、prepare_template_starter_deck.mjs | 対応計画の検査、元ページを使った開始処理 | 使用する元ページ/レイアウトと内容の対応。詳細は要精読 |
| O11 | check_template_fidelity.mjs、template_source_fidelity_gate.py | 元資料との保持状況を確認する処理 | 見た目だけでなく構造と必要要素も比較。全判定条件は未抽出 |
| O12 | inspect_presentation_package_integrity.py | PPTXパッケージの整合性検査 | 必須部品・順序・参照・グラフ等。詳細の対応表は今後作成 |
| O13 | inspect_presentation_layout_geometry.py | 配置、文字、フォント等の検査 | 領域外・文字組み・箇条書き・図表など。大きな実装であり要精読 |
| O14 | native_quantitative_chart_gate.py | 編集可能なグラフとデータの検査 | グラフと埋め込みデータの対応、参照範囲、表示用値。要精読 |
| O15 | native_chart_title_gate.py、native_table_arithmetic_gate.py | グラフ題名・表の計算等の検査 | ユーザーが要求した対象と計算契約の確認。詳細未精読 |
| O16 | materialize_literal_chart_workbooks.py | グラフのワークブック作成の補助 | 新規作成と、既存の計算式・元データ保持を区別。詳細未精読 |
| O17 | render_slides.py、render_presentation.mjs | スライドの描画 | 実際の最終出力から描画し、ページと対応させる |
| O18 | create_montage.py、make_contact_sheet.py | 一覧画像の作成 | 全体の流れと個々のページの確認を分離 |
| O19 | rasterize_svg.mjs、ensure_raster_image.py | 画像形式の変換 | 対応形式、原本保持、寸法・透明度・解像度の検査。詳細未精読 |
| O20 | slides_test.py、artifact_tool_utils.mjs、runtime_helpers.* | 検査の統合と実行環境 | 何を実行したか、外部ツールが失敗した場合の報告。全体は要精読 |
| O21 | artifact_tool_docs/ | 専用ライブラリAPIの説明 | 機能を使える条件を確認。API文書の存在をライブラリ再実装と混同しない |

## C. 現行試作の再利用判断

| ID | 現在のファイル | 現在できること | 再利用判断・不足 |
| --- | --- | --- | --- |
| C01 | skills/research-slides/SKILL.md | 輪講の構成・確認・JSON生成への指示 | 用途別の補足候補。汎用の作成/編集/継承を振り分ける本体としては不足 |
| C02 | references/operations.md | 現行CLIと制限の案内 | 実装済み機能の操作説明として保持 |
| C03 | src/schema.mjs | 限られた新規生成データの型、ID、枠外、密度の検査 | 新規生成用契約として再利用。既存PPTX全体の表現形式に強制しない |
| C04 | src/renderer.mjs | 自作レイアウトと基本要素の新規作成 | 新規生成の実行部として再利用。既存資料の編集器ではない |
| C05 | src/inheritance.mjs | 自作出力の決まった枠の個別書式・座標を除去 | 自作生成物専用で保持。既存PPTXに一律適用してはならない |
| C06 | src/inspect.mjs | ZIP/CRC/XML・内部参照の基本検査、部品数 | 基本検査として拡張。実ページ順・要素索引・継承の解析・XSD・グラフデータ照合は不足 |
| C07 | src/patch.mjs | 構成JSONのページ差し替え・追加・削除・順序変更 | JSON専用。PPTXの編集APIへ転用したと扱わない |
| C08 | src/cli.mjs | 生成・JSON修正・検査の呼び出し、レポート | コマンド入口と保存保護を再利用。編集とテンプレート操作は追加設計 |
| C09 | scripts/preview.ps1 | PowerPointのPNG出力 | Windows描画の一経路として保持。PDF・一覧・非表示・Linuxは不足 |
| C10 | test/ | 特定fixtureでの回帰確認 | 既存結果を保ち、未知の資料・編集・複製・継承のfixtureを追加する |
| C11 | server.mjs、Dockerfile | 構成JSONから生成するローカルAPIとコンテナ定義 | 後で独立エンジンへ接続する入口。AI接続/描画/クラウド稼働は未検証 |
| C12 | src/pptx/package.mjs、xml.mjs、read/ | 読み取り専用索引：実ページ順・ID・本文・ノート・参照・選択した継承情報 | `docs/pptx-reader.md`。直接編集・全書式計算・互換表示要素の解釈は未実装。C06とは別の機能 |
| C13 | src/pptx/edit/ | 通常ラン/対応段落/未結合表セル内段落の編集・図形内段落追加/削除・ページ複製/追加/限定削除/並べ替え・通常文字枠追加・ノート/グラフ/ブック分離・p14セクション登録・保持検査 | `docs/pptx-edit.md`。通常画像の差し替え・ローカル書式/位置・図形削除・既存専用ノート本文も限定対応（2026-11-07）。結合セル・グラフ値・補助枠の自動生成・完全なテンプレート継承は未実装。削除は安全な全データ消去ではない |
| C14 | src/pdf/ | PDFのページ本文/語の座標/指定図表のPNG取得と、ページ根拠・図ハッシュを確認した新規生成 | `docs/pdf-paper-pipeline.md`。OCR・自動図表認識・数式解読・表セル復元・意味の自動検証・外部AI APIは未実装 |

## 設計への引き継ぎ

この表の各領域を `replacement-design.md` の機能契約へ結び付ける。試験は `replacement-acceptance.md`。未読を「対応不要」、指示を「実装済み」、ダミー試験を「任意PPTXで保証」と読み替えない。

主な参照: [Anthropicの対象フォルダ](https://github.com/anthropics/skills/tree/ca45fc496a3436251f191354091d557da31c15b5/skills/pptx)、ローカルの付属skillと関連ファイル。
