(function() { // IIFE Start
  'use strict';

  // --- 定数 ---
  const STORAGE_KEY = 'miniCodeTabs_v2.3';
  const WIDTH_KEY = 'miniCodeTabs_editorWidth_v2.3';
  const PREVIEW_NIGHT_KEY = 'miniCodeTabs_previewNight';
  const MAX_UNDO_STACK = 50;
  const MAX_UNDO_BYTES = 5 * 1024 * 1024;
  const INPUT_UNDO_GROUP_MS = 800;
  const DEFAULT_TAB_NAME = '無題';
  const MAX_TABS = 50;
  const MAX_TAB_NAME_LENGTH = 100;
  const MAX_TAB_CONTENT_LENGTH = 500000;
  const MAX_TOTAL_CONTENT_LENGTH = 1500000;
  const MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024;
  const MAX_SHARE_URL_LENGTH = 12000;

  // --- 状態 ---
  let tabs = [];
  let current = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartWidth = 0;
  let fullscreenMode = false;
  let previewNight = getStorageItemSafe(PREVIEW_NIGHT_KEY) === '1';
  let sidebarOpen = true;
  let undoStack = [], redoStack = [];
  let lockStack = false;
  let inputUndoGroup = { key: null, lastAt: 0, timerId: null };
  let pendingSharedTabs = null;
  let sharedPreviewUncommitted = false;
  let storageWriteBlocked = false;
  let invalidSavedData = null;
  let noticeTimerId = null;
  let lastFocusedBeforeModal = null;

  // --- DOM要素キャッシュ ---
  let sidebarEl, sidebarToggleBtnEl, tabButtonsEl, editorColEl, editorAreaEl,
      noteTextareaEl, runBtnEl, execInfoEl, saveNoticeEl, dividerEl,
      resultIframeEl, fullscreenBtnEl, fullscreenCloseBtnEl, nightBtnEl,
      cheatModalEl, cheatModalCloseBtnEl, returnToPreviewBtnEl,
      sharedDataModalEl, sharedDataSummaryEl, sharedDataOpenBtnEl,
      sharedDataCancelBtnEl;

  function cacheDOMElements() {
    sidebarEl = document.getElementById('sidebar');
    sidebarToggleBtnEl = document.getElementById('sidebarToggleBtn');
    tabButtonsEl = document.getElementById('tabButtons');
    editorColEl = document.getElementById('editorCol');
    editorAreaEl = document.getElementById('editorArea');
    noteTextareaEl = document.getElementById('note');
    runBtnEl = document.getElementById('runBtn');
    execInfoEl = document.getElementById('execInfo');
    saveNoticeEl = document.getElementById('saveNotice');
    dividerEl = document.getElementById('divider');
    resultIframeEl = document.getElementById('result');
    fullscreenBtnEl = document.getElementById('fullscreenBtn');
    fullscreenCloseBtnEl = document.getElementById('fullscreenCloseBtn');
    nightBtnEl = document.getElementById('nightBtn');
    cheatModalEl = document.getElementById('cheatModal');
    cheatModalCloseBtnEl = document.getElementById('cheatModalCloseBtn');
    returnToPreviewBtnEl = document.getElementById('returnToPreviewBtn');
    sharedDataModalEl = document.getElementById('sharedDataModal');
    sharedDataSummaryEl = document.getElementById('sharedDataSummary');
    sharedDataOpenBtnEl = document.getElementById('sharedDataOpenBtn');
    sharedDataCancelBtnEl = document.getElementById('sharedDataCancelBtn');
  }

  // --- Helper Functions ---
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, function(m) {
    switch(m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return m;
    }
  });
}

  function getStorageItemSafe(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error(`Failed to read localStorage key "${key}":`, error);
      return null;
    }
  }

  function setStorageItemSafe(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.error(`Failed to write localStorage key "${key}":`, error);
      if (saveNoticeEl) {
        showSaveNotice('ブラウザの保存領域へ設定を書き込めませんでした。', { error: true });
      }
      return false;
    }
  }

  function formatDate(iso) {
    if (!iso) return 'なし';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function stringToUint8Array(str) {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  function uint8ArrayToString(uint8Array) {
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
  }

  function toBase64(str) {
    const uint8Array = stringToUint8Array(str);
    let binaryString = '';
    uint8Array.forEach((byte) => {
      binaryString += String.fromCharCode(byte);
    });
    return btoa(binaryString);
  }

  function fromBase64(base64Str) {
    const binaryString = atob(base64Str);
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }
    return uint8ArrayToString(uint8Array);
  }

  function toBase64Url(str) {
    return toBase64(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  function fromBase64Url(base64UrlStr) {
    const normalized = base64UrlStr
      .replace(/ /g, '+')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padding = '='.repeat((4 - normalized.length % 4) % 4);
    return fromBase64(normalized + padding);
  }

  function validateTabsData(data) {
    if (!Array.isArray(data) || data.length === 0 || data.length > MAX_TABS) {
      throw new Error(`タブ数は1〜${MAX_TABS}件である必要があります。`);
    }

    let totalLength = 0;
    return data.map((tab, index) => {
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
        throw new Error(`タブ${index + 1}の形式が正しくありません。`);
      }

      const readText = (key, fallback = '') => {
        const value = tab[key];
        if (value === undefined || value === null) return fallback;
        if (typeof value !== 'string') {
          throw new Error(`タブ${index + 1}の${key}は文字列である必要があります。`);
        }
        return value;
      };

      const name = readText('name', `${DEFAULT_TAB_NAME}${index + 1}`);
      const html = readText('html');
      const css = readText('css');
      const js = readText('js');
      const note = readText('note');

      if (name.length === 0 || name.length > MAX_TAB_NAME_LENGTH) {
        throw new Error(`タブ${index + 1}の名前が長すぎるか空です。`);
      }
      for (const [key, value] of Object.entries({ html, css, js, note })) {
        if (value.length > MAX_TAB_CONTENT_LENGTH) {
          throw new Error(`タブ${index + 1}の${key}が大きすぎます。`);
        }
      }

      totalLength += name.length + html.length + css.length + js.length + note.length;
      if (totalLength > MAX_TOTAL_CONTENT_LENGTH) {
        throw new Error('インポートデータ全体が大きすぎます。');
      }

      const lastExec = tab.lastExec === null || tab.lastExec === undefined
        ? null
        : readText('lastExec');
      if (lastExec !== null && Number.isNaN(Date.parse(lastExec))) {
        throw new Error(`タブ${index + 1}の最終実行日時が正しくありません。`);
      }
      const execCount = Number.isSafeInteger(tab.execCount) && tab.execCount >= 0
        ? tab.execCount
        : 0;

      return { name, html, css, js, note, lastExec, execCount };
    });
  }

  // --- サイドバーUI構築 ---
  function buildSidebar() {
    sidebarEl.innerHTML = `
      <button type="button" class="sidebar-btn" id="exportBtn" title="JSONでエクスポート" aria-label="JSONでエクスポート">
        <span>⇩</span>
        <span>Export</span>
        <span class="sidebar-tooltip">タブ全体をJSON保存</span>
      </button>
      <label class="sidebar-btn" for="importFile" tabindex="0" title="JSONでインポート" aria-label="JSONでインポート">
        <span>⇧</span>
        <span>Import</span>
        <input type="file" id="importFile" accept="application/json">
        <span class="sidebar-tooltip">JSONファイルから復元</span>
      </label>
      <button type="button" class="sidebar-btn" id="shareBtn" title="共有URL生成" aria-label="共有URL生成">
        <span>🔗</span>
        <span>Share</span>
        <span class="sidebar-tooltip">短い内容をURLで共有</span>
      </button>
      <button type="button" class="sidebar-btn" id="undoBtn" title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
        <span>↶</span>
        <span>Undo</span>
        <span class="sidebar-tooltip">ひとつ前に戻す</span>
      </button>
      <button type="button" class="sidebar-btn" id="redoBtn" title="やり直し (Ctrl+Y)" aria-label="やり直し">
        <span>↷</span>
        <span>Redo</span>
        <span class="sidebar-tooltip">やり直し</span>
      </button>
      <button type="button" class="sidebar-btn" id="cheatBtn" title="ショートカット一覧" aria-label="ショートカット一覧表示">
        <span>？</span>
        <span>Help</span>
        <span class="sidebar-tooltip">ショートカット・使い方</span>
      </button>
      <button type="button" class="sidebar-btn" id="clearBtn" title="全クリア" aria-label="現在のタブの内容を全クリア">
        <span>✖</span>
        <span>Clear</span>
        <span class="sidebar-tooltip">全入力を消去</span>
      </button>
    `;
  }

  // --- ヘッダー・サイドバー制御 ---
  function handleSidebarToggle() {
    sidebarOpen = !sidebarOpen;
    sidebarEl.classList.toggle('closed', !sidebarOpen);
    sidebarToggleBtnEl.textContent = sidebarOpen ? '×' : '≡';
    sidebarToggleBtnEl.setAttribute('aria-label', sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く');
    sidebarToggleBtnEl.setAttribute('aria-expanded', String(sidebarOpen));
  }

  // --- タブ処理 ---
  function loadTabs() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('data')) {
      try {
        const sharedDataParam = urlParams.get('data');
        if (sharedDataParam.length > MAX_SHARE_URL_LENGTH) {
          throw new Error('共有データが大きすぎます。');
        }
        const json = fromBase64Url(sharedDataParam);
        const arr = JSON.parse(json);
        pendingSharedTabs = validateTabsData(arr);
      } catch (e) {
        console.error("Failed to load tabs from URL:", e);
        clearSharedDataFromAddress();
        showSaveNotice('共有URLを読み込めませんでした。URLが途中で切れている可能性があります。', { error: true, sticky: true });
      }
    }

    const saved = getStorageItemSafe(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        tabs = validateTabsData(data);
        current = Math.min(current, tabs.length - 1);
        return;
      } catch (e) {
        console.error("Failed to load tabs from localStorage:", e);
        invalidSavedData = saved;
        storageWriteBlocked = true;
      }
    }
    tabs = [{name: 'タブ1', html: '', css: '', js: '', note: '', lastExec: null, execCount: 0}];
    current = 0;
  }

  function saveTabs({ force = false } = {}) {
    if (storageWriteBlocked && !force) {
      showSaveNotice('破損した保存データの自動上書きを停止しています。ImportまたはCtrl+Sで復旧方法を選んでください。', { error: true, sticky: true });
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
      storageWriteBlocked = false;
      invalidSavedData = null;
      sharedPreviewUncommitted = false;
      return true;
    } catch (error) {
      console.error('Failed to save tabs to localStorage:', error);
      if (saveNoticeEl) showSaveNotice('保存容量を超えたため保存できませんでした。Exportでバックアップしてください。', { error: true, sticky: true });
      return false;
    }
  }

  function downloadTextFile(content, filename, type = 'application/json') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function confirmRecoveryReplacement() {
    if (!storageWriteBlocked) return true;
    const shouldReplace = confirm(
      '以前の保存データを正常に読み込めませんでした。\n\n' +
      '「OK」：破損データをバックアップとしてダウンロードし、現在の内容で保存し直す\n' +
      '「キャンセル」：以前の保存データをそのまま保持する'
    );
    if (!shouldReplace) return false;
    if (invalidSavedData) {
      downloadTextFile(invalidSavedData, 'miniCodeTabs-recovery.json');
    }
    return true;
  }

  function saveFromUser(successMessage = '保存しました') {
    if (!saveCurrentTabData()) return false;
    if (!confirmRecoveryReplacement()) {
      showSaveNotice('保存をキャンセルしました。以前の保存データは変更されていません。', { error: true });
      return false;
    }
    const saved = saveTabs({ force: storageWriteBlocked });
    if (saved) showSaveNotice(successMessage);
    return saved;
  }

  function renderTabs() {
    tabButtonsEl.innerHTML = tabs.map((t, i) => `
      <div class="tab-item${i === current ? ' active' : ''}" data-index="${i}">
        <button type="button"
                class="tab-btn${i === current ? ' active' : ''}"
                role="tab"
                aria-selected="${i === current}"
                tabindex="${i === current ? '0' : '-1'}"
                title="ダブルクリックまたはF2で名前変更">
          <span class="tab-name">${escapeHtml(t.name)}</span>
        </button>
        ${tabs.length > 1 ? `<button type="button" class="tab-close" aria-label="${escapeHtml(t.name)}を削除">×</button>` : ''}
      </div>
    `).join('') + '<button type="button" class="add-btn">＋追加</button>';

    tabButtonsEl.querySelectorAll('.tab-item').forEach((item) => {
      const index = Number(item.dataset.index);
      const tabButton = item.querySelector('.tab-btn');
      const closeButton = item.querySelector('.tab-close');
      tabButton.addEventListener('click', () => switchTab(index));
      tabButton.addEventListener('dblclick', () => editTabName(index));
      tabButton.addEventListener('keydown', (event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          editTabName(index);
        }
      });
      closeButton?.addEventListener('click', () => removeTab(index));
    });
    tabButtonsEl.querySelector('.add-btn').addEventListener('click', addTab);
    renderEditor();
  }

  function switchTab(i) {
    if (i === current && tabs[i]) return;
    saveCurrentTabData();
    current = i;
    renderTabs();
    if (sharedPreviewUncommitted) {
      resetPreview();
    } else {
      runCode();
    }
  }

  function addTab() {
    saveCurrentTabData();
    if (tabs.length >= MAX_TABS) {
      showSaveNotice(`タブは最大${MAX_TABS}件です`);
      return;
    }
    pushUndo();
    tabs.push({name: `タブ${tabs.length + 1}`, html: '', css: '', js: '', note: '', lastExec: null, execCount: 0});
    current = tabs.length - 1;
    renderTabs();
    if (sharedPreviewUncommitted) {
      resetPreview();
      showSaveNotice('共有内容はまだ保存も実行もしていません。', { sticky: true });
    } else {
      runCode();
    }
  }

  function removeTab(idx) {
    if (tabs.length === 1) return;
    saveCurrentTabData();
    pushUndo();
    const wasCurrent = idx === current;
    tabs.splice(idx, 1);
    if (idx < current) {
      current--;
    } else if (current >= tabs.length) {
      current = tabs.length - 1;
    }
    renderTabs();
    if (sharedPreviewUncommitted) {
      resetPreview();
      showSaveNotice('共有内容はまだ保存も実行もしていません。', { sticky: true });
    } else if (wasCurrent) {
      runCode();
    } else {
      saveTabs();
    }
  }

  function editTabName(idx) {
    const item = tabButtonsEl.querySelector(`.tab-item[data-index="${idx}"]`);
    const button = item?.querySelector('.tab-btn');
    if (!item || !button) return;

    const oldName = tabs[idx].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-name-input';
    input.maxLength = MAX_TAB_NAME_LENGTH;
    input.value = oldName;
    input.setAttribute('aria-label', 'タブ名');

    let finished = false;
    const finishEditing = (cancelled = false) => {
      if (finished) return;
      finished = true;
      const newName = cancelled ? oldName : input.value.trim();
      if (newName && newName !== oldName) {
        saveCurrentTabData();
        pushUndo();
        tabs[idx].name = newName;
      }
      renderTabs();
      if (!sharedPreviewUncommitted) {
        saveTabs();
      } else {
        showSaveNotice('共有内容はまだ保存も実行もしていません。', { sticky: true });
      }
      const restoredButton = tabButtonsEl.querySelector(`.tab-item[data-index="${idx}"] .tab-btn`);
      restoredButton?.focus();
    };

    input.addEventListener('blur', () => finishEditing(false));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finishEditing(false);
      else if (e.key === 'Escape') {
        e.preventDefault();
        finishEditing(true);
      }
    });

    button.replaceWith(input);
    input.focus();
    input.select();
  }

  // --- Undo/Redo機能 ---
  function endInputUndoGroup() {
    if (inputUndoGroup.timerId) {
      clearTimeout(inputUndoGroup.timerId);
    }
    inputUndoGroup = { key: null, lastAt: 0, timerId: null };
  }

  function trimHistoryStack(stack) {
    while (stack.length > MAX_UNDO_STACK) stack.shift();
    let totalBytes = stack.reduce((sum, item) => sum + item.length * 2, 0);
    while (stack.length > 1 && totalBytes > MAX_UNDO_BYTES) {
      totalBytes -= stack.shift().length * 2;
    }
  }

  function pushUndo(serializedState = JSON.stringify(tabs), { fromInput = false } = {}) {
    if (lockStack) return;
    if (!fromInput) endInputUndoGroup();
    const data = serializedState;
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === data) return;

    undoStack.push(data);
    trimHistoryStack(undoStack);
    redoStack = [];
  }

  function recordInputUndo(fieldKey) {
    const now = Date.now();
    const shouldStartGroup =
      inputUndoGroup.key !== fieldKey ||
      now - inputUndoGroup.lastAt > INPUT_UNDO_GROUP_MS;

    if (shouldStartGroup) {
      pushUndo(JSON.stringify(tabs), { fromInput: true });
    }
    if (inputUndoGroup.timerId) clearTimeout(inputUndoGroup.timerId);
    inputUndoGroup = {
      key: fieldKey,
      lastAt: now,
      timerId: setTimeout(endInputUndoGroup, INPUT_UNDO_GROUP_MS)
    };
  }

  function undo() {
    endInputUndoGroup();
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(tabs));
    trimHistoryStack(redoStack);
    const lastState = undoStack.pop();
    tabs = JSON.parse(lastState);
    current = Math.min(current, tabs.length - 1);
    renderTabs();
    resetPreview();
    saveTabs();
  }

  function redo() {
    endInputUndoGroup();
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(tabs));
    trimHistoryStack(undoStack);
    const nextState = redoStack.pop();
    tabs = JSON.parse(nextState);
    current = Math.min(current, tabs.length - 1);
    renderTabs();
    resetPreview();
    saveTabs();
  }

  // --- エディタ ---
  function renderEditor() {
    if (!tabs[current]) {
      if (tabs.length > 0) {
        current = 0;
      } else {
        editorAreaEl.innerHTML = '<p>エラー: 表示できるタブがありません。</p>';
        noteTextareaEl.value = '';
        return;
      }
    }
    const t = tabs[current];
    editorAreaEl.innerHTML = `
      <div class="editor-field">
        <div class="editor-field-header">
          <label for="html">HTML（1枚HTMLコピペ可）</label>
          <button type="button" class="view-code-btn" data-target="html" aria-label="HTMLコードをプレビュー欄に表示">コード表示</button>
        </div>
        <textarea id="html" maxlength="${MAX_TAB_CONTENT_LENGTH}" placeholder="HTMLや丸ごと1枚のHTMLコードも貼れます">${escapeHtml(t.html)}</textarea>
      </div>
      <div class="editor-field">
        <div class="editor-field-header">
          <label for="css">CSS</label>
          <button type="button" class="view-code-btn" data-target="css" aria-label="CSSコードをプレビュー欄に表示">コード表示</button>
        </div>
        <textarea id="css" maxlength="${MAX_TAB_CONTENT_LENGTH}">${escapeHtml(t.css)}</textarea>
      </div>
      <div class="editor-field">
        <div class="editor-field-header">
          <label for="js">JavaScript</label>
          <button type="button" class="view-code-btn" data-target="js" aria-label="JavaScriptコードをプレビュー欄に表示">コード表示</button>
        </div>
        <textarea id="js" maxlength="${MAX_TAB_CONTENT_LENGTH}">${escapeHtml(t.js)}</textarea>
      </div>
    `;
    noteTextareaEl.value = t.note || "";

    ['html', 'css', 'js'].forEach(id => {
      const textarea = document.getElementById(id);
      if (textarea) {
        textarea.addEventListener('keydown', handleEditorKeyDown);
        textarea.addEventListener('input', handleEditorInput);
      }
    });

    editorAreaEl.querySelectorAll('.view-code-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        viewCodeInPreview(this.dataset.target);
      });
    });
  }

  function handleEditorKeyDown(e) {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'enter':
          runCode();
          e.preventDefault();
          break;
        case 's':
          saveFromUser('保存しました（Ctrl+S）');
          e.preventDefault();
          break;
        case 'z':
          if (e.shiftKey) { redo(); } else { undo(); }
          e.preventDefault();
          break;
        case 'y':
          redo();
          e.preventDefault();
          break;
      }
    }
  }

  function getTotalContentLength() {
    return tabs.reduce((total, tab) => (
      total +
      tab.name.length +
      tab.html.length +
      tab.css.length +
      tab.js.length +
      tab.note.length
    ), 0);
  }

  function handleTextInput(field, value, sourceElement) {
    if (!tabs[current]) return;
    const previousValue = tabs[current][field] || '';
    const nextTotalLength = getTotalContentLength() - previousValue.length + value.length;

    if (value.length > MAX_TAB_CONTENT_LENGTH || nextTotalLength > MAX_TOTAL_CONTENT_LENGTH) {
      sourceElement.value = previousValue;
      showSaveNotice('入力できるデータ容量の上限に達しました。Exportで分けて保存してください。', { error: true, sticky: true });
      return;
    }

    if (value === previousValue) return;
    recordInputUndo(`${current}:${field}`);
    tabs[current][field] = value;
  }

  function handleEditorInput(event) {
    const field = event.currentTarget.id;
    handleTextInput(field, event.currentTarget.value, event.currentTarget);
  }

  function saveCurrentTabData() {
    if (!tabs[current]) return false;
    const candidateTabs = tabs.map((tab, index) => index === current ? {
      ...tab,
      html: document.getElementById('html')?.value || '',
      css: document.getElementById('css')?.value || '',
      js: document.getElementById('js')?.value || '',
      note: noteTextareaEl.value || ''
    } : tab);
    try {
      tabs = validateTabsData(candidateTabs);
      return true;
    } catch (error) {
      showSaveNotice(`保存できません：${error.message}`, { error: true, sticky: true });
      return false;
    }
  }

  // --- View Code in Preview Function ---
  function viewCodeInPreview(type) {
    if (!tabs[current]) return;
    let codeToView = '';
    if (type === 'html') {
      codeToView = document.getElementById('html')?.value || '';
    } else if (type === 'css') {
      codeToView = document.getElementById('css')?.value || '';
    } else if (type === 'js') {
      codeToView = document.getElementById('js')?.value || '';
    }

    const escapedCode = escapeHtml(codeToView);
    const codeViewStyles = `
      body { margin: 0; background-color: #282c34; color: #abb2bf; font-family: 'Fira Mono', monospace; font-size: 14px; line-height: 1.5; }
      pre { margin: 0; padding: 1em; white-space: pre-wrap; word-wrap: break-word; }
    `;
    
    resultIframeEl.srcdoc = `
      <html>
        <head><style>${codeViewStyles}</style></head>
        <body><pre><code>${escapedCode}</code></pre></body>
      </html>
    `;
    if (returnToPreviewBtnEl) {
      returnToPreviewBtnEl.hidden = false;
    }
  }

  function escapeRawTextEndTag(content, tagName) {
    return content.replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);
  }

  function injectBeforeClosingTag(documentHtml, tagName, content) {
    if (!content) return documentHtml;
    const closingTag = new RegExp(`</${tagName}\\s*>`, 'i');
    if (closingTag.test(documentHtml)) {
      return documentHtml.replace(closingTag, `${content}\n$&`);
    }
    if (/<\/html\s*>/i.test(documentHtml)) {
      return documentHtml.replace(/<\/html\s*>/i, `${content}\n$&`);
    }
    return `${documentHtml}\n${content}`;
  }

  // --- コード実行 ---
  function runCode({ recordExecution = true } = {}) {
    if (returnToPreviewBtnEl) {
      returnToPreviewBtnEl.hidden = true;
    }
    if (!saveCurrentTabData()) return;
    saveTabs();

    if (!tabs[current]) {
      resetPreview();
      return;
    }
    const t = tabs[current];
    const htmlInput = t.html.trim();
    let code;
    let nightModeStyles = '';

    if (previewNight) {
      nightModeStyles = `
        <style>
          html,body{background:#141922!important;color:#e2e7f2!important;}
          a{color:#84aaff!important;}
          button,input[type="button"],input[type="submit"],select,textarea,.btn{background:#223760!important;color:#d4e2ff!important;border-color:#4664aa!important;}
          h1,h2,h3,h4,h5,h6{color:#fff!important;}
          table{background:#1a202a!important;color:#e2e7f2!important;}
          th,td{border-color:#364263!important;}
          ::selection{background:#364263!important;}
        </style>
      `;
    }

    const safeCss = escapeRawTextEndTag(t.css, 'style');
    const safeJs = escapeRawTextEndTag(t.js, 'script');
    const customStyle = safeCss ? `<style data-web-mini-user-style>${safeCss}</style>` : '';
    const customScript = safeJs ? `<script data-web-mini-user-script>${safeJs}<\/script>` : '';
    const isFullDocument = /<!doctype\s+html|<html(?:\s|>)/i.test(htmlInput);

    if (isFullDocument) {
      code = htmlInput;
      const headAdditions = `${nightModeStyles}${customStyle}`;
      if (headAdditions) {
        if (/<head[^>]*>/i.test(code)) {
          code = code.replace(/<head[^>]*>/i, `$&${headAdditions}`);
        } else if (/<html[^>]*>/i.test(code)) {
          code = code.replace(/<html[^>]*>/i, `$&<head>${headAdditions}</head>`);
        } else {
          code = `<head>${headAdditions}</head>${code}`;
        }
      }
      code = injectBeforeClosingTag(code, 'body', customScript);
    } else {
      code = `
        <!doctype html>
        <html lang="ja">
        <head>
          <meta charset="UTF-8">
          ${nightModeStyles}
          ${customStyle}
        </head>
        <body>
          ${t.html}
          ${customScript}
        </body>
        </html>
      `;
    }
    resultIframeEl.srcdoc = code;
    if (recordExecution) {
      t.lastExec = new Date().toISOString();
      t.execCount = (t.execCount || 0) + 1;
    }
    showExecInfo();
  }

  function showExecInfo() {
    if (!tabs[current]) {
        execInfoEl.innerHTML = `(Ctrl+Enterで実行／Ctrl+Sで保存)`;
        return;
    }
    const t = tabs[current];
    const dateStr = formatDate(t.lastExec);
    execInfoEl.innerHTML =
      `(Ctrl+Enterで実行／Ctrl+Sで保存)　|　最終実行：${dateStr}　|　回数：${t.execCount || 0}`;
  }

  function showSaveNotice(msg, { error = false, sticky = false } = {}) {
    if (!saveNoticeEl) return;
    if (noticeTimerId) clearTimeout(noticeTimerId);
    saveNoticeEl.textContent = msg;
    saveNoticeEl.classList.toggle('error', error);
    if (!sticky) {
      noticeTimerId = setTimeout(() => {
        saveNoticeEl.textContent = '';
        saveNoticeEl.classList.remove('error');
      }, 2600);
    }
  }

  function resetPreview() {
    resultIframeEl.srcdoc = '<html><body style="background:#222;color:#888;text-align:center;padding:2em;font-family:sans-serif;"><span style="font-size:1.3em;">（プレビューなし）</span></body></html>';
    execInfoEl.innerHTML = `(Ctrl+Enterで実行／Ctrl+Sで保存)`;
  }

  // --- クリア ---
  function clearAllTabData() {
    if (!confirm("現在のタブの内容をすべてクリアしますか？ (HTML/CSS/JS/メモ)")) return;
    pushUndo();
    if (tabs[current]) {
      tabs[current].html = '';
      tabs[current].css = '';
      tabs[current].js = '';
      tabs[current].note = '';
      tabs[current].lastExec = null;
      tabs[current].execCount = 0;
      renderEditor();
      resetPreview();
      if (!sharedPreviewUncommitted) {
        saveTabs();
      }
    }
  }

  // --- 分割線・スナップ ---
  function setupDivider() {
    const minW = 220, maxW = 900;
    const storedWidth = parseInt(getStorageItemSafe(WIDTH_KEY));
    if (!isNaN(storedWidth)) {
      editorColEl.style.width = `${Math.min(maxW, Math.max(minW, storedWidth))}px`;
    }

    dividerEl.addEventListener('mousedown', function(e) {
      if (window.innerWidth < 900) return;
      isDragging = true;
      dividerEl.classList.add('active');
      dragStartX = e.clientX;
      dragStartWidth = editorColEl.offsetWidth;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
    });

    document.addEventListener('mousemove', function(e) {
      if (!isDragging) return;
      let delta = e.clientX - dragStartX;
      let newW = Math.min(maxW, Math.max(minW, dragStartWidth + delta));
      editorColEl.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!isDragging) return;
      isDragging = false;
      dividerEl.classList.remove('active');
      setStorageItemSafe(WIDTH_KEY, editorColEl.offsetWidth);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    });

    dividerEl.addEventListener('dblclick', function(e) {
      if (window.innerWidth < 900) return;
      const mainAreaRect = dividerEl.parentElement.getBoundingClientRect();
      let clickXInMainArea = e.clientX - mainAreaRect.left;
      let newW = Math.min(maxW, Math.max(minW, clickXInMainArea));
      editorColEl.style.width = newW + 'px';
      setStorageItemSafe(WIDTH_KEY, newW);
    });

    dividerEl.querySelectorAll('.snap-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        if (window.innerWidth < 900) return;
        const mainAreaWidth = dividerEl.parentElement.offsetWidth;
        let percent = parseFloat(this.dataset.snap);
        let newW = Math.round(Math.max(minW, Math.min(maxW, mainAreaWidth * percent)));
        editorColEl.style.width = newW + 'px';
        setStorageItemSafe(WIDTH_KEY, newW);
      });
    });
  }

  // --- チートシート ---
  const handleCheatModalKeydown = (e) => {
    if (e.key === 'Escape') {
      hideCheatModal();
    }
  };

  function showCheatModal() {
    lastFocusedBeforeModal = document.activeElement;
    cheatModalEl.hidden = false;
    cheatModalCloseBtnEl.focus();
    document.addEventListener('keydown', handleCheatModalKeydown); 
  }
  function hideCheatModal() {
    cheatModalEl.hidden = true;
    document.removeEventListener('keydown', handleCheatModalKeydown); 
    lastFocusedBeforeModal?.focus?.();
    lastFocusedBeforeModal = null;
  }

  // --- プレビュー全画面 ---
  function setupFullscreen() {
    fullscreenBtnEl.addEventListener('click', () => {
      if (fullscreenMode) return;
      resultIframeEl.classList.add('fullscreen-iframe');
      fullscreenCloseBtnEl.classList.add('show');
      document.body.classList.add('fullscreen-mode');
      fullscreenMode = true;
    });

    fullscreenCloseBtnEl.addEventListener('click', () => {
      if (!fullscreenMode) return;
      resultIframeEl.classList.remove('fullscreen-iframe');
      fullscreenCloseBtnEl.classList.remove('show');
      document.body.classList.remove('fullscreen-mode');
      fullscreenMode = false;
    });
  }

  // --- プレビュー ナイトモード ---
  function setupNightBtn() {
    function updateNightButtonState() {
      nightBtnEl.classList.toggle('active', previewNight);
      nightBtnEl.textContent = previewNight ? '🌚' : '🌝';
      nightBtnEl.title = previewNight ? "ナイトモード中／解除" : "プレビューナイトモード";
      nightBtnEl.setAttribute('aria-label', previewNight ? "プレビューナイトモードを解除" : "プレビューナイトモードを有効化");
    }

    nightBtnEl.addEventListener('click', () => {
      previewNight = !previewNight;
      setStorageItemSafe(PREVIEW_NIGHT_KEY, previewNight ? '1' : '0');
      updateNightButtonState();
      if (sharedPreviewUncommitted) {
        resetPreview();
      } else {
        runCode();
      }
    });
    updateNightButtonState();
  }

  // --- JSONエクスポート ---
  function exportTabs() {
    if (!saveCurrentTabData()) return;
    downloadTextFile(JSON.stringify(tabs, null, 2), 'miniCodeTabs.json');
  }

  // --- JSONインポート ---
  function importTabs(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      alert('インポート失敗：ファイルサイズは2MB以下にしてください。');
      e.target.value = null;
      return;
    }
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const importedData = JSON.parse(ev.target.result);
        const validatedTabs = validateTabsData(importedData);
        if (!confirmRecoveryReplacement()) {
          showSaveNotice('Importをキャンセルしました。以前の保存データは変更されていません。', { error: true });
          return;
        }
        pushUndo();
        tabs = validatedTabs;
        current = 0;
        renderTabs();
        resetPreview();
        const saved = saveTabs({ force: storageWriteBlocked });
        if (!saved) return;
        alert("タブデータをインポートしました。安全のため自動実行はしていません。内容を確認してから「実行」を押してください。");
      } catch (err) {
        alert(`インポート失敗：JSONの解析中にエラーが発生しました。
${err.message}`);
        console.error("Import error:", err);
      } finally {
        e.target.value = null;
      }
    };
    reader.readAsText(file);
  }

  // --- 共有用URL ---
  function shareTabs() {
    if (!saveCurrentTabData()) return;
    try {
      const dataToShare = validateTabsData(tabs);
      const jsonString = JSON.stringify(dataToShare);
      const base64Param = toBase64Url(jsonString);
      const shareUrl = new URL(location.href);
      shareUrl.search = '';
      shareUrl.hash = '';
      shareUrl.searchParams.set('data', base64Param);
      const urlString = shareUrl.toString();
      if (urlString.length > MAX_SHARE_URL_LENGTH) {
        alert('共有URLが長くなりすぎるため生成を中止しました。タブを減らすか、ExportしたJSONファイルを共有してください。');
        return;
      }
      prompt(
        `このURLには全${dataToShare.length}タブのコードとメモが含まれます。URLを知っている人には内容が見えるため、秘密情報がないことを確認して共有してください。`,
        urlString
      );
    } catch (err) {
      alert("共有URLの生成に失敗しました。データが大きすぎる可能性があります。");
      console.error("Share URL generation error:", err);
    }
  }

  function clearSharedDataFromAddress() {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('data');
    history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }

  function closeSharedDataModal() {
    sharedDataModalEl.hidden = true;
    lastFocusedBeforeModal?.focus?.();
    lastFocusedBeforeModal = null;
  }

  function showPendingSharedData() {
    if (!pendingSharedTabs) return;
    lastFocusedBeforeModal = document.activeElement;
    const names = pendingSharedTabs.slice(0, 3).map((tab) => tab.name).join('、');
    const remaining = Math.max(0, pendingSharedTabs.length - 3);
    sharedDataSummaryEl.textContent =
      `${pendingSharedTabs.length}タブ：${names}${remaining ? ` ほか${remaining}件` : ''}`;
    sharedDataModalEl.hidden = false;
    sharedDataOpenBtnEl.focus();
  }

  function openPendingSharedData() {
    if (!pendingSharedTabs) return;
    pushUndo();
    tabs = pendingSharedTabs;
    pendingSharedTabs = null;
    sharedPreviewUncommitted = true;
    current = 0;
    renderTabs();
    resetPreview();
    clearSharedDataFromAddress();
    closeSharedDataModal();
    showSaveNotice('共有内容を表示しています。まだ保存も実行もしていません。', { sticky: true });
  }

  function cancelPendingSharedData() {
    pendingSharedTabs = null;
    clearSharedDataFromAddress();
    closeSharedDataModal();
    showSaveNotice('共有データを開かず、保存済みの内容を維持しました。');
  }
  
  // --- Event Listener Setup ---
  function setupEventListeners() {
    sidebarToggleBtnEl.addEventListener('click', handleSidebarToggle);
    runBtnEl.addEventListener('click', runCode);
    noteTextareaEl.addEventListener('input', (event) => {
      handleTextInput('note', event.currentTarget.value, event.currentTarget);
    });
    noteTextareaEl.addEventListener('keydown', handleEditorKeyDown);

    if (returnToPreviewBtnEl) {
      returnToPreviewBtnEl.addEventListener('click', runCode);
    }

    document.getElementById('exportBtn').addEventListener('click', exportTabs);
    document.getElementById('importFile').addEventListener('change', importTabs);
    document.querySelector('label[for="importFile"]').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        document.getElementById('importFile').click();
      }
    });
    document.getElementById('shareBtn').addEventListener('click', shareTabs);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('cheatBtn').addEventListener('click', showCheatModal);
    document.getElementById('clearBtn').addEventListener('click', clearAllTabData);

    cheatModalCloseBtnEl.addEventListener('click', hideCheatModal);
    cheatModalEl.addEventListener('click', (e) => {
      if (e.target === cheatModalEl) hideCheatModal();
    });
    sharedDataOpenBtnEl.addEventListener('click', openPendingSharedData);
    sharedDataCancelBtnEl.addEventListener('click', cancelPendingSharedData);
    sharedDataModalEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelPendingSharedData();
      }
    });
  }

  // --- Initialization ---
  function init() {
    cacheDOMElements();
    buildSidebar();
    setupEventListeners(); 
    
    loadTabs();
    renderTabs(); 
    runCode();

    setupDivider();
    setupFullscreen();
    setupNightBtn();
    showExecInfo();

    sidebarEl.classList.toggle('closed', !sidebarOpen);
    sidebarToggleBtnEl.textContent = sidebarOpen ? '×' : '≡';
    sidebarToggleBtnEl.setAttribute('aria-label', sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く');
    sidebarToggleBtnEl.setAttribute('aria-expanded', String(sidebarOpen));

    if (pendingSharedTabs) {
      showPendingSharedData();
    }
  }

  window.miniCodeApp = {
    switchTab,
    addTab,
    removeTab,
    editTabName,
    viewCodeInPreview // Exposing the new function
  };

  window.addEventListener('DOMContentLoaded', init);
  window.addEventListener('beforeunload', () => {
    if (sharedPreviewUncommitted || storageWriteBlocked) return;
    saveCurrentTabData();
    saveTabs();
  });

})(); // IIFE End
