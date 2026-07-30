const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace('<script src="script.js"></script>', '');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const STORAGE_KEY = 'miniCodeTabs_v2.3';
const BACKUP_KEY = 'miniCodeTabs_v2.3_backup';

function tab(overrides = {}) {
  return {
    name: 'タブ1',
    html: '',
    css: '',
    js: '',
    note: '',
    lastExec: null,
    execCount: 0,
    ...overrides
  };
}

function encodeShare(tabs) {
  return Buffer.from(JSON.stringify(tabs), 'utf8').toString('base64url');
}

async function createApp({
  url = 'https://katakata0522.github.io/preview/',
  beforeInit,
  confirmResult = true
} = {}) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  window.alert = () => {};
  window.promptCalls = [];
  window.prompt = (message, value) => {
    window.promptCalls.push({ message, value });
    return null;
  };
  window.confirm = () => confirmResult;
  if (beforeInit) await beforeInit(window);

  let initListener;
  const nativeAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = (type, listener, options) => {
    if (type === 'DOMContentLoaded') {
      initListener = listener;
      return;
    }
    return nativeAddEventListener(type, listener, options);
  };
  window.eval(script);
  window.addEventListener = nativeAddEventListener;
  initListener(new window.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dom;
}

function setEditor(window, values) {
  for (const [id, value] of Object.entries(values)) {
    const element = window.document.getElementById(id);
    element.value = value;
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
}

test('起動時に保存済みコードを実行せず、実行回数も増やさない', async () => {
  const original = [tab({ js: 'document.body.dataset.autoRun="yes"', execCount: 7 })];
  const dom = await createApp({
    beforeInit(window) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(original));
    }
  });
  const { window } = dom;

  assert.match(window.document.querySelector('#result').srcdoc, /自動実行されません/);
  assert.match(window.document.querySelector('#execInfo').textContent, /回数：7/);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(STORAGE_KEY)), original);
  dom.window.close();
});

test('共有URLは一時表示に留め、既存保存データを上書き・自動実行しない', async () => {
  const original = [tab({ name: 'ORIGINAL', html: '<p>original</p>' })];
  const shared = [tab({ name: 'SHARED', js: 'document.body.dataset.autoRun="yes"' })];
  const dom = await createApp({
    url: `https://katakata0522.github.io/preview/?data=${encodeShare(shared)}`,
    beforeInit(window) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(original));
    }
  });
  const { window } = dom;

  assert.equal(window.document.querySelector('.tab-name').textContent, 'SHARED');
  assert.match(window.document.querySelector('#result').srcdoc, /自動実行されません/);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(STORAGE_KEY)), original);
  assert.equal(window.location.search, '');
  assert.equal(window.document.querySelector('#systemNotice').hidden, false);

  window.document.querySelector('#systemNoticePrimary').click();
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].name, 'SHARED');
  const backup = JSON.parse(window.localStorage.getItem(BACKUP_KEY));
  assert.equal(JSON.parse(backup.raw)[0].name, 'ORIGINAL');
  dom.window.close();
});

test('壊れた保存データは起動時に上書きしない', async () => {
  const corrupt = '{"not":"tabs"}';
  const dom = await createApp({
    beforeInit(window) {
      window.localStorage.setItem(STORAGE_KEY, corrupt);
    }
  });
  const { window } = dom;

  assert.equal(window.localStorage.getItem(STORAGE_KEY), corrupt);
  assert.match(window.document.querySelector('#systemNoticeTitle').textContent, /読み込めません/);

  window.document.querySelector('#systemNoticeSecondary').click();
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].name, 'タブ1');
  assert.equal(JSON.parse(window.localStorage.getItem(BACKUP_KEY)).raw, corrupt);
  dom.window.close();
});

test('保存容量エラー時に成功表示を出さない', async () => {
  const dom = await createApp();
  const { window } = dom;
  const originalSetItem = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function (key, value) {
    if (key === STORAGE_KEY) throw new window.DOMException('Quota exceeded', 'QuotaExceededError');
    return originalSetItem.call(this, key, value);
  };

  setEditor(window, { html: '<h1>changed</h1>' });
  window.document.querySelector('#html').dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 's', ctrlKey: true, bubbles: true
  }));

  assert.match(window.document.querySelector('#saveNotice').textContent, /保存できませんでした/);
  assert.doesNotMatch(window.document.querySelector('#saveNotice').textContent, /^保存しました/);
  dom.window.close();
});

test('Importの保存に失敗した場合は画面と保存データを置き換えない', async () => {
  const original = [tab({ name: 'ORIGINAL' })];
  const dom = await createApp({
    beforeInit(window) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(original));
    }
  });
  const { window } = dom;
  const originalSetItem = window.Storage.prototype.setItem;
  window.Storage.prototype.setItem = function (key, value) {
    if (key === STORAGE_KEY) throw new window.DOMException('Quota exceeded', 'QuotaExceededError');
    return originalSetItem.call(this, key, value);
  };

  const input = window.document.querySelector('#importFile');
  const file = new window.File(
    [JSON.stringify([tab({ name: 'IMPORTED' })])],
    'tabs.json',
    { type: 'application/json' }
  );
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(window.document.querySelector('.tab-name').textContent, 'ORIGINAL');
  assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY))[0].name, 'ORIGINAL');
  assert.match(window.document.querySelector('#saveNotice').textContent, /保存できませんでした/);
  dom.window.close();
});

test('JavaScript内のscript終了文字列を壊さず実行できる', async () => {
  const dom = await createApp();
  const { window } = dom;
  setEditor(window, {
    html: '<main>test</main>',
    js: "document.body.dataset.ran='yes'; document.body.dataset.value='</script>';"
  });
  window.document.querySelector('#runBtn').click();
  const generated = window.document.querySelector('#result').srcdoc;
  const preview = new JSDOM(generated, { runScripts: 'dangerously' });

  assert.match(generated, /<\\\/script>/);
  assert.equal(preview.window.document.body.dataset.ran, 'yes');
  assert.equal(preview.window.document.body.dataset.value, '</script>');
  preview.window.close();
  dom.window.close();
});

test('1枚HTMLモードでも別欄のCSSとJavaScriptを反映する', async () => {
  const dom = await createApp();
  const { window } = dom;
  setEditor(window, {
    html: '<html><head><title>x</title></head><body><p>full</p></body></html>',
    css: 'body{outline:3px solid red}',
    js: 'document.body.dataset.separateJs="yes"'
  });
  window.document.querySelector('#runBtn').click();
  const generated = window.document.querySelector('#result').srcdoc;

  assert.match(generated, /outline:3px solid red/);
  assert.match(generated, /separateJs/);
  assert.ok(generated.indexOf('data-mini-code-style') < generated.indexOf('</head>'));
  assert.ok(generated.indexOf('data-mini-code-script') < generated.indexOf('</body>'));
  dom.window.close();
});

test('Shareは現在のタブだけを含める', async () => {
  const dom = await createApp();
  const { window } = dom;
  for (let index = 0; index < 3; index += 1) {
    window.document.querySelector('#addTabBtn').click();
  }
  setEditor(window, { html: '<p>CURRENT_FOURTH</p>' });
  window.document.querySelector('#shareBtn').click();

  const shareUrl = new URL(window.promptCalls.at(-1).value);
  const shared = JSON.parse(Buffer.from(shareUrl.searchParams.get('data'), 'base64url').toString());
  assert.equal(shared.length, 1);
  assert.match(shared[0].html, /CURRENT_FOURTH/);
  dom.window.close();
});

test('編集とタブ追加をUndo・Redoできる', async () => {
  const dom = await createApp();
  const { window } = dom;
  setEditor(window, { html: '<p>edited</p>' });
  window.document.querySelector('#undoBtn').click();
  assert.equal(window.document.querySelector('#html').value, '');
  window.document.querySelector('#redoBtn').click();
  assert.equal(window.document.querySelector('#html').value, '<p>edited</p>');

  window.document.querySelector('#addTabBtn').click();
  assert.equal(window.document.querySelectorAll('.tab-item').length, 2);
  window.document.querySelector('#undoBtn').click();
  assert.equal(window.document.querySelectorAll('.tab-item').length, 1);
  dom.window.close();
});

test('Importボタンとモーダルにキーボード・ARIA対応がある', async () => {
  const dom = await createApp();
  const { window } = dom;
  const importButton = window.document.querySelector('#importBtn');
  assert.equal(importButton.tagName, 'BUTTON');

  const helpButton = window.document.querySelector('#cheatBtn');
  helpButton.focus();
  helpButton.click();
  const modal = window.document.querySelector('#cheatModal');
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(window.document.activeElement.id, 'cheatModalCloseBtn');
  window.document.querySelector('#cheatModalCloseBtn').click();
  assert.equal(window.document.activeElement.id, 'cheatBtn');
  dom.window.close();
});

test('入力上限、iframe隔離、基本メタデータを維持する', async () => {
  const dom = await createApp();
  const { window } = dom;
  assert.equal(window.document.querySelector('#html').maxLength, 500000);
  assert.equal(window.document.querySelector('#note').maxLength, 500000);
  assert.equal(window.document.querySelector('#result').getAttribute('sandbox'), 'allow-scripts');
  assert.ok(window.document.querySelector('meta[name="description"]'));
  assert.ok(window.document.querySelector('h1'));
  dom.window.close();
});
