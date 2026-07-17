# preview（旧Webミニ実行機）

HTML・CSS・JavaScriptを入力し、ブラウザ内のiframeで動作確認できる旧世代のスタンドアロンWebツールです。

## 現在の位置づけ

このリポジトリを、現在公開中の「PikaLab CodeStudio」の実装本体として扱ってはいけません。

現在公開されているPikaLab CodeStudioは、次の場所で管理・配信されています。

- 公開URL: `https://katakatalab.com/pikalab/code-studio/`
- 現行ソース: 非公開リポジトリ `katakata0522/KatakataLab` の `pikalab/.code-studio/`
- 現行データ保存キーの例: `pikalab_codestudio_tabs_v3`

この`preview`リポジトリは、それとは別の旧Webミニ実行機です。`codereader`へ改名するか、別サービスとして残すか、アーカイブするかは未確定です。

**製品名・公開先・リンク元を確認するまで、リポジトリの改名・削除・コード移植を行わないでください。**

## 主な機能

- HTML・CSS・JavaScript入力とiframeプレビュー
- 複数タブ、名称変更、追加・削除
- Undo / Redo
- JSON Export / Import
- 共有URL
- メモ、実行回数、最終実行日時
- エディタ幅変更、全画面、ナイト表示

## この旧ツールの保存データ

ブラウザのlocalStorageを使用します。

- タブデータ: `miniCodeTabs_v2.3`
- エディタ幅: `miniCodeTabs_editorWidth_v2.3`
- プレビューナイト設定: `miniCodeTabs_previewNight`

localStorageはURLのパス単位ではなく、原則として`プロトコル + ホスト + ポート`からなる**オリジン単位**で共有されます。

そのため、同じ`https://katakata0522.github.io`内でパスだけが変わる場合、同じ保存キーを引き続き参照できる可能性があります。一方、`github.io`から`katakatalab.com`へ移す場合や、プロトコル・ホスト・ポートが変わる場合は別の保存領域になります。

また、GitHubではリポジトリ改名時に通常のリポジトリURLは転送されますが、GitHub PagesのプロジェクトサイトURLは同じ扱いではありません。公開リンクの確認と移行対応が別途必要です。

## 変更前の安全確認

公開先や名称を変更する場合は、保存データの消失リスクが低い場合でもバックアップを取ります。

1. 対象となる旧Webミニ実行機を開く
2. サイドバーの`Export`から`miniCodeTabs.json`を保存する
3. 現在の公開URL、オリジン、GitHub Pages設定、外部リンクを記録する
4. 現行PikaLab CodeStudioと旧Webミニ実行機のどちらを変更するのか明確にする
5. 変更後に保存キー、Import、主要操作を確認する

## 現在のデフォルトブランチ

`refactor-split-html-css-js`

ブランチ名を`main`へ整理する場合も、公開設定や自動処理への参照を確認してから行ってください。
