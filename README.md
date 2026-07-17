# CodeReader

HTML・CSS・JavaScriptを入力し、ブラウザ内のiframeで動作確認できるWebツールです。

このリポジトリは現在 `preview` という名前ですが、**CodeReaderの実装本体**です。別リポジトリの `katakata0522/codereader` は、名称変更の途中で作成されたプレースホルダーです。

## 主な機能

- HTML・CSS・JavaScript入力とiframeプレビュー
- 複数タブ、名称変更、追加・削除
- Undo / Redo
- JSON Export / Import
- 共有URL
- メモ、実行回数、最終実行日時
- エディタ幅変更、全画面、ナイト表示

## 保存データ

ブラウザのlocalStorageを使用します。

- タブデータ: `miniCodeTabs_v2.3`
- エディタ幅: `miniCodeTabs_editorWidth_v2.3`
- プレビューナイト設定: `miniCodeTabs_previewNight`

localStorageは公開URLのオリジンごとに分かれます。リポジトリ名やGitHub PagesのURLを変更すると、旧URLの保存データを新URLから直接参照できない可能性があります。

## リポジトリ改名前の必須手順

1. 現在利用中の画面でサイドバーの `Export` を押す
2. `miniCodeTabs.json`が保存されたことを確認する
3. 現在の公開URLとGitHub Pages設定を記録する
4. その後に、このリポジトリ自体を`codereader`へ改名する
5. 新URLでJSONをImportし、タブ内容を確認する

コードを空の`codereader`へコピーして二重管理せず、このリポジトリの履歴・Issue・ブランチを保ったまま改名する方針です。

## 現在のデフォルトブランチ

`refactor-split-html-css-js`

正式統合時に、必要であればデフォルトブランチを`main`へ整理します。公開設定と参照先を確認する前に変更しないでください。
