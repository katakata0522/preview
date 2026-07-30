(function () {
  'use strict';

  const STORAGE_KEY = 'miniCodeTabs_v2.3';
  const BACKUP_STORAGE_KEY = 'miniCodeTabs_v2.3_backup';
  const WIDTH_KEY = 'miniCodeTabs_editorWidth_v2.3';
  const PREVIEW_NIGHT_KEY = 'miniCodeTabs_previewNight';
  const MAX_UNDO_STACK = 100;
  const MAX_TABS = 50;
  const MAX_TAB_NAME_LENGTH = 100;
  const MAX_TAB_CONTENT_LENGTH = 500000;
  const MAX_TOTAL_CONTENT_LENGTH = 1500000;
  const MAX_IMPORT_FILE_SIZE = 2 * 1024 * 1024;
  const MAX_SHARE_URL_LENGTH = 8000;
  const EDIT_HISTORY_DELAY = 600;
  const AUTOSAVE_DELAY = 800;

  let tabs = [];
  let current = 0;
  let workspaceMode = 'local';
  let localWorkspaceSnapshot = null;
  let corruptSavedData = null;
  let startupError = '';
  let sidebarOpen = true;
  let previewNight = false;
  let previewMode = 'empty';
  let fullscreenMode = false;
  let fullscreenReturnFocus = null;
  let modalReturnFocus = null;
  let undoStack = [];
  let redoStack = [];
  let pendingEditSnapshot = null;
  let editHistoryTimer = null;
  let autosaveTimer = null;
  let noticeTimer = null;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  let sidebarEl;
  let sidebarToggleBtnEl;
  let tabButtonsEl;
  let editorColEl;
  let editorAreaEl;
  let noteTextareaEl;
  let runBtnEl;
  let execInfoEl;
  let saveNoticeEl;
  let dividerEl;
  let resultIframeEl;
  let fullscreenBtnEl;
  let fullscreenCloseBtnEl;
  let nightBtnEl;
  let stopPreviewBtnEl;
  let cheatModalEl;
  let cheatModalCloseBtnEl;
  let returnToPreviewBtnEl;
  let systemNoticeEl;
  let systemNoticeTitleEl;
  let systemNoticeTextEl;
  let systemNoticePrimaryEl;
  let systemNoticeSecondaryEl;

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
    stopPreviewBtnEl = document.getElementById('stopPreviewBtn');
    cheatModalEl = document.getElementById('cheatModal');
    cheatModalCloseBtnEl = document.getElementById('cheatModalCloseBtn');
    returnToPreviewBtnEl = document.getElementById('returnToPreviewBtn');
    systemNoticeEl = document.getElementById('systemNotice');
    systemNoticeTitleEl = document.getElementById('systemNoticeTitle');
    systemNoticeTextEl = document.getElementById('systemNoticeText');
    systemNoticePrimaryEl = document.getElementById('systemNoticePrimary');
    systemNoticeSecondaryEl = document.getElementById('systemNoticeSecondary');
  }

  function makeDefaultTabs() {
    return [{ name: 'タブ1', html: '', css: '', js: '', note: '', lastExec: null, execCount: 0 }];
  }

  function cloneTabs(value = tabs) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function formatDate(iso) {
    if (!iso) return 'なし';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'なし';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function getTotalContentLength(value = tabs) {
    return value.reduce((total, tab) => (
      total + tab.name.length + tab.html.length + tab.css.length + tab.js.length + tab.note.length
    ), 0);
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

      const name = readText('name', `無題${index + 1}`);
      const html = readText('html');
      const css = readText('css');
      const js = readText('js');
      const note = readText('note');

      if (name.trim().length === 0 || name.length > MAX_TAB_NAME_LENGTH) {
        throw new Error(`タブ${index + 1}の名前が空か、${MAX_TAB_NAME_LENGTH}文字を超えています。`);
      }

      for (const [key, value] of Object.entries({ html, css, js, note })) {
        if (value.length > MAX_TAB_CONTENT_LENGTH) {
          throw new Error(`タブ${index + 1}の${key}が${MAX_TAB_CONTENT_LENGTH}文字を超えています。`);
        }
      }

      totalLength += name.length + html.length + css.length + js.length + note.length;
      if (totalLength > MAX_TOTAL_CONTENT_LENGTH) {
        throw new Error(`全体の文字数が${MAX_TOTAL_CONTENT_LENGTH}文字を超えています。`);
      }

      const rawLastExec = tab.lastExec === null || tab.lastExec === undefined
        ? null
        : readText('lastExec');
      const lastExec = rawLastExec && !Number.isNaN(Date.parse(rawLastExec)) ? rawLastExec : null;
      const execCount = Number.isSafeInteger(tab.execCount) && tab.execCount >= 0 ? tab.execCount : 0;

      return { name, html, css, js, note, lastExec, execCount };
    });
  }

  function showSaveNotice(message, tone = 'info', duration = 2600) {
    clearTimeout(noticeTimer);
    saveNoticeEl.textContent = message;
    saveNoticeEl.className = `save-notice${tone === 'info' ? '' : ` ${tone}`}`;
    if (duration > 0) {
      noticeTimer = setTimeout(() => {
        saveNoticeEl.textContent = '';
        saveNoticeEl.className = 'save-notice';
      }, duration);
    }
  }

  function showSystemNotice({ title, message, tone = 'info', primary, secondary }) {
    systemNoticeTitleEl.textContent = title;
    systemNoticeTextEl.textContent = message;
    systemNoticeEl.dataset.tone = tone;
    systemNoticeEl.hidden = false;

    for (const [button, action] of [
      [systemNoticePrimaryEl, primary],
      [systemNoticeSecondaryEl, secondary]
    ]) {
      button.onclick = null;
      if (action) {
        button.textContent = action.label;
        button.onclick = action.onClick;
        button.hidden = false;
      } else {
        button.hidden = true;
      }
    }
  }

  function hideSystemNotice() {
    systemNoticeEl.hidden = true;
    systemNoticePrimaryEl.onclick = null;
    systemNoticeSecondaryEl.onclick = null;
  }

  function downloadTextFile(content, filename, type = 'application/json') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function persistCandidate(candidateTabs, { destructive = false, reason = 'save' } = {}) {
    try {
      const validated = validateTabsData(candidateTabs);
      const serialized = JSON.stringify(validated);
      const previous = localStorage.getItem(STORAGE_KEY);

      if (destructive && previous !== null && previous !== serialized) {
        localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify({
          createdAt: new Date().toISOString(),
          reason,
          raw: previous
        }));
      }

      localStorage.setItem(STORAGE_KEY, serialized);
      return true;
    } catch (error) {
      console.error('Failed to persist tabs:', error);
      showSaveNotice(`保存できませんでした：${error.message || '保存容量を確認してください。'}`, 'error', 0);
      return false;
    }
  }

  function saveTabs({ notify = false } = {}) {
    if (workspaceMode === 'shared') {
      showSaveNotice('共有データはまだ保存されていません。上の「この内容を保存」を選んでください。', 'warning', 0);
      return false;
    }
    if (workspaceMode === 'recovery') {
      showSaveNotice('保存データの復旧判断が必要です。上の案内からバックアップまたは初期化を選んでください。', 'warning', 0);
      return false;
    }
    if (!saveCurrentTabData()) return false;

    const saved = persistCandidate(tabs);
    if (saved && notify) showSaveNotice('保存しました');
    return saved;
  }

  function scheduleAutosave() {
    if (workspaceMode !== 'local') return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => saveTabs(), AUTOSAVE_DELAY);
  }

  function serializeState() {
    return JSON.stringify({ tabs, current });
  }

  function restoreState(serialized) {
    const state = JSON.parse(serialized);
    tabs = validateTabsData(state.tabs);
    current = Math.max(0, Math.min(Number.isInteger(state.current) ? state.current : 0, tabs.length - 1));
  }

  function pushUndo(serializedState = serializeState()) {
    if (undoStack.at(-1) === serializedState) return;
    undoStack.push(serializedState);
    if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
    redoStack = [];
  }

  function beginEditHistory(previousState) {
    if (pendingEditSnapshot === null) pendingEditSnapshot = previousState;
    clearTimeout(editHistoryTimer);
    editHistoryTimer = setTimeout(flushPendingEditHistory, EDIT_HISTORY_DELAY);
  }

  function flushPendingEditHistory() {
    clearTimeout(editHistoryTimer);
    if (pendingEditSnapshot !== null) {
      pushUndo(pendingEditSnapshot);
      pendingEditSnapshot = null;
    }
  }

  function undo() {
    flushPendingEditHistory();
    if (!undoStack.length) return;
    redoStack.push(serializeState());
    restoreState(undoStack.pop());
    renderTabs();
    resetPreview('内容を戻しました。実行ボタンでプレビューを更新できます。');
    saveTabs();
  }

  function redo() {
    flushPendingEditHistory();
    if (!redoStack.length) return;
    undoStack.push(serializeState());
    restoreState(redoStack.pop());
    renderTabs();
    resetPreview('内容をやり直しました。実行ボタンでプレビューを更新できます。');
    saveTabs();
  }

  function stringToBase64Url(value) {
    const binary = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) => (
      String.fromCharCode(Number.parseInt(hex, 16))
    ));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToString(value) {
    const normalized = value.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const encoded = Array.from(binary, (character) => (
      `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`
    )).join('');
    return decodeURIComponent(encoded);
  }

  function cleanShareParameter() {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete('data');
    const relativeUrl = `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;
    history.replaceState({}, document.title, relativeUrl);
  }

  function loadTabs() {
    let localTabs = makeDefaultTabs();
    let localMode = 'local';
    let saved = null;

    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to access localStorage:', error);
      startupError = 'ブラウザの保存領域へアクセスできません。この画面を開いている間だけ編集できます。';
    }

    if (saved) {
      try {
        localTabs = validateTabsData(JSON.parse(saved));
      } catch (error) {
        console.error('Failed to load tabs from localStorage:', error);
        corruptSavedData = saved;
        localMode = 'recovery';
      }
    }

    localWorkspaceSnapshot = {
      tabs: cloneTabs(localTabs),
      current: 0,
      mode: localMode,
      corruptSavedData
    };

    tabs = cloneTabs(localTabs);
    current = 0;
    workspaceMode = localMode;

    const urlParams = new URLSearchParams(location.search);
    if (!urlParams.has('data')) return;

    try {
      const sharedTabs = validateTabsData(JSON.parse(base64UrlToString(urlParams.get('data'))));
      tabs = sharedTabs;
      current = 0;
      workspaceMode = 'shared';
    } catch (error) {
      console.error('Failed to load tabs from URL:', error);
      startupError = `共有URLを読み込めませんでした：${error.message}`;
    } finally {
      cleanShareParameter();
    }
  }

  function acceptSharedWorkspace() {
    if (!saveCurrentTabData()) return;
    if (!confirm('現在ブラウザに保存されているタブを、表示中の共有データで置き換えますか？ 元のデータはバックアップキーへ退避されます。')) return;
    if (!persistCandidate(tabs, { destructive: true, reason: 'accept-shared-workspace' })) return;

    workspaceMode = 'local';
    localWorkspaceSnapshot = { tabs: cloneTabs(), current, mode: 'local', corruptSavedData: null };
    corruptSavedData = null;
    hideSystemNotice();
    showSaveNotice('共有データを保存しました。元のデータはバックアップへ退避されています。');
  }

  function discardSharedWorkspace() {
    if (!localWorkspaceSnapshot) return;
    if (!confirm('表示中の共有データを閉じて、元の作業へ戻りますか？ 共有データに加えた未保存の変更は失われます。')) return;
    tabs = cloneTabs(localWorkspaceSnapshot.tabs);
    current = localWorkspaceSnapshot.current;
    workspaceMode = localWorkspaceSnapshot.mode;
    corruptSavedData = localWorkspaceSnapshot.corruptSavedData;
    undoStack = [];
    redoStack = [];
    renderTabs();
    resetPreview();
    showWorkspaceNotice();
  }

  function downloadCorruptData() {
    if (!corruptSavedData) return;
    downloadTextFile(corruptSavedData, `miniCodeTabs-recovery-${new Date().toISOString().slice(0, 10)}.json`);
    showSaveNotice('読み込めなかった元データをダウンロードしました。');
  }

  function resetCorruptData() {
    if (!confirm('読み込めない保存データを退避し、現在表示している新しいタブで保存領域を初期化しますか？')) return;
    if (!persistCandidate(tabs, { destructive: true, reason: 'reset-corrupt-storage' })) return;
    workspaceMode = 'local';
    corruptSavedData = null;
    localWorkspaceSnapshot = { tabs: cloneTabs(), current, mode: 'local', corruptSavedData: null };
    hideSystemNotice();
    showSaveNotice('保存データを初期化しました。元データはバックアップキーへ退避されています。');
  }

  function showWorkspaceNotice() {
    if (workspaceMode === 'shared') {
      showSystemNotice({
        title: '共有データを一時表示しています',
        message: 'コードは自動実行も自動保存もされていません。内容を確認してから、実行または保存してください。',
        tone: 'info',
        primary: { label: 'この内容を保存', onClick: acceptSharedWorkspace },
        secondary: { label: '元の作業に戻る', onClick: discardSharedWorkspace }
      });
      return;
    }

    if (workspaceMode === 'recovery') {
      showSystemNotice({
        title: '以前の保存データを読み込めませんでした',
        message: '元データは上書きしていません。先にダウンロードしてから初期化できます。',
        tone: 'warning',
        primary: { label: '元データをダウンロード', onClick: downloadCorruptData },
        secondary: { label: '初期化して開始', onClick: resetCorruptData }
      });
      return;
    }

    if (startupError) {
      showSystemNotice({
        title: '共有URLの読み込みに失敗しました',
        message: startupError,
        tone: 'error',
        secondary: { label: '閉じる', onClick: () => { startupError = ''; hideSystemNotice(); } }
      });
      return;
    }

    hideSystemNotice();
  }

  function buildSidebar() {
    const button = (id, icon, label, ariaLabel = label) => `
      <button type="button" class="sidebar-btn" id="${id}" aria-label="${ariaLabel}" title="${ariaLabel}">
        <span class="sidebar-icon" aria-hidden="true">${icon}</span>
        <span class="sidebar-label">${label}</span>
      </button>`;

    sidebarEl.innerHTML = [
      button('exportBtn', '⇩', 'Export', 'JSONでエクスポート'),
      button('importBtn', '⇧', 'Import', 'JSONからインポート'),
      '<input class="sidebar-file-input" type="file" id="importFile" accept="application/json,.json" tabindex="-1">',
      button('shareBtn', '🔗', 'Share', '現在のタブの共有URLを生成'),
      button('undoBtn', '↶', 'Undo', '元に戻す'),
      button('redoBtn', '↷', 'Redo', 'やり直す'),
      button('cheatBtn', '？', 'Help', 'ショートカット一覧を表示'),
      button('clearBtn', '✖', 'Clear', '現在のタブの内容をすべて消去')
    ].join('');
  }

  function handleSidebarToggle() {
    sidebarOpen = !sidebarOpen;
    sidebarEl.classList.toggle('closed', !sidebarOpen);
    sidebarToggleBtnEl.textContent = sidebarOpen ? '×' : '≡';
    sidebarToggleBtnEl.setAttribute('aria-label', sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く');
    sidebarToggleBtnEl.setAttribute('aria-expanded', String(sidebarOpen));
  }

  function renderTabs() {
    tabButtonsEl.innerHTML = tabs.map((tab, index) => `
      <div class="tab-item${index === current ? ' active' : ''}">
        <button type="button" class="tab-btn" id="tab-${index}" role="tab"
          aria-selected="${index === current}" aria-controls="editorArea"
          tabindex="${index === current ? '0' : '-1'}" data-index="${index}"
          title="ダブルクリックまたはF2で名前を変更">
          <span class="tab-name">${escapeHtml(tab.name)}</span>
        </button>
        ${tabs.length > 1 ? `<button type="button" class="tab-close" data-index="${index}" aria-label="${escapeHtml(tab.name)}を削除">×</button>` : ''}
      </div>`).join('') +
      '<button type="button" class="add-btn" id="addTabBtn">＋追加</button>';

    tabButtonsEl.querySelectorAll('.tab-btn').forEach((button) => {
      const index = Number(button.dataset.index);
      button.addEventListener('click', () => switchTab(index));
      button.addEventListener('dblclick', () => editTabName(index));
      button.addEventListener('keydown', (event) => handleTabKeydown(event, index));
    });
    tabButtonsEl.querySelectorAll('.tab-close').forEach((button) => {
      button.addEventListener('click', () => removeTab(Number(button.dataset.index)));
    });
    document.getElementById('addTabBtn').addEventListener('click', addTab);
    editorAreaEl.setAttribute('aria-labelledby', `tab-${current}`);
    renderEditor();
  }

  function handleTabKeydown(event, index) {
    if (event.key === 'F2') {
      event.preventDefault();
      editTabName(index);
      return;
    }

    const last = tabs.length - 1;
    let target = null;
    if (event.key === 'ArrowRight') target = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft') target = index === 0 ? last : index - 1;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = last;
    if (target !== null) {
      event.preventDefault();
      switchTab(target, true);
    }
  }

  function switchTab(index, focusTab = false) {
    if (!tabs[index] || index === current) return;
    flushPendingEditHistory();
    saveCurrentTabData();
    if (workspaceMode === 'local') persistCandidate(tabs);
    current = index;
    renderTabs();
    resetPreview('タブを切り替えました。実行ボタンでプレビューできます。');
    showExecInfo();
    if (focusTab) document.getElementById(`tab-${current}`)?.focus();
  }

  function addTab() {
    flushPendingEditHistory();
    saveCurrentTabData();
    if (tabs.length >= MAX_TABS) {
      showSaveNotice(`タブは最大${MAX_TABS}件です。`, 'warning');
      return;
    }
    pushUndo();
    tabs.push({ name: `タブ${tabs.length + 1}`, html: '', css: '', js: '', note: '', lastExec: null, execCount: 0 });
    current = tabs.length - 1;
    renderTabs();
    resetPreview();
    saveTabs();
    document.getElementById(`tab-${current}`)?.focus();
  }

  function removeTab(index) {
    if (tabs.length === 1 || !tabs[index]) return;
    flushPendingEditHistory();
    saveCurrentTabData();
    pushUndo();
    tabs.splice(index, 1);
    if (index < current) current -= 1;
    if (current >= tabs.length) current = tabs.length - 1;
    renderTabs();
    resetPreview('タブを削除しました。Undoで元に戻せます。');
    saveTabs();
    document.getElementById(`tab-${current}`)?.focus();
  }

  function editTabName(index) {
    const tabButton = document.getElementById(`tab-${index}`);
    if (!tabButton || !tabs[index]) return;
    const oldName = tabs[index].name;
    const input = document.createElement('input');
    input.className = 'tab-name-input';
    input.type = 'text';
    input.maxLength = MAX_TAB_NAME_LENGTH;
    input.value = oldName;
    input.setAttribute('aria-label', 'タブ名');

    let cancelled = false;
    const finish = () => {
      const newName = cancelled ? oldName : input.value.trim();
      if (newName && newName !== oldName) {
        flushPendingEditHistory();
        saveCurrentTabData();
        pushUndo();
        tabs[index].name = newName;
        saveTabs();
      }
      renderTabs();
      document.getElementById(`tab-${index}`)?.focus();
    };

    input.addEventListener('blur', finish, { once: true });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      if (event.key === 'Escape') {
        cancelled = true;
        input.blur();
      }
    });

    tabButton.replaceWith(input);
    input.focus();
    input.select();
  }

  function renderEditor() {
    const tab = tabs[current];
    if (!tab) return;
    const field = (id, label, placeholder = '') => `
      <div class="code-field">
        <div class="code-field-header">
          <label for="${id}">${label}</label>
          <button type="button" class="view-code-btn" data-target="${id}" aria-label="${label}コードだけをプレビューに表示">コード表示</button>
        </div>
        <textarea id="${id}" maxlength="${MAX_TAB_CONTENT_LENGTH}" placeholder="${placeholder}" spellcheck="false">${escapeHtml(tab[id])}</textarea>
      </div>`;

    editorAreaEl.innerHTML = [
      field('html', 'HTML（1枚HTMLも貼り付け可能）', 'HTMLを入力'),
      field('css', 'CSS', 'CSSを入力'),
      field('js', 'JavaScript', 'JavaScriptを入力')
    ].join('');
    noteTextareaEl.value = tab.note || '';

    ['html', 'css', 'js'].forEach((id) => {
      const textarea = document.getElementById(id);
      textarea.addEventListener('keydown', handleEditorKeyDown);
      textarea.addEventListener('input', handleEditorInput);
    });
    editorAreaEl.querySelectorAll('.view-code-btn').forEach((button) => {
      button.addEventListener('click', () => viewCodeInPreview(button.dataset.target));
    });
    showExecInfo();
  }

  function readEditorValues() {
    return {
      html: document.getElementById('html')?.value || '',
      css: document.getElementById('css')?.value || '',
      js: document.getElementById('js')?.value || '',
      note: noteTextareaEl.value || ''
    };
  }

  function saveCurrentTabData() {
    if (!tabs[current]) return false;
    const values = readEditorValues();
    const candidate = cloneTabs();
    Object.assign(candidate[current], values);
    try {
      validateTabsData(candidate);
      Object.assign(tabs[current], values);
      return true;
    } catch (error) {
      showSaveNotice(error.message, 'error', 0);
      return false;
    }
  }

  function applyEditorInput() {
    const previousState = serializeState();
    const previousTabs = cloneTabs();
    Object.assign(tabs[current], readEditorValues());

    if (getTotalContentLength() > MAX_TOTAL_CONTENT_LENGTH) {
      tabs = previousTabs;
      renderEditor();
      showSaveNotice(`全体で${MAX_TOTAL_CONTENT_LENGTH}文字までです。直前の入力を戻しました。`, 'error', 0);
      return;
    }

    beginEditHistory(previousState);
    scheduleAutosave();
  }

  function handleEditorInput() {
    applyEditorInput();
  }

  function handleNoteInput() {
    applyEditorInput();
  }

  function handleEditorKeyDown(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'enter') {
      event.preventDefault();
      runCode();
    } else if (key === 's') {
      event.preventDefault();
      flushPendingEditHistory();
      saveTabs({ notify: true });
    } else if (key === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    } else if (key === 'y') {
      event.preventDefault();
      redo();
    }
  }

  function escapeClosingTag(content, tagName) {
    return content.replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);
  }

  function injectIntoDocument(code, target, markup) {
    if (!markup) return code;
    const closingPattern = new RegExp(`</${target}\\s*>`, 'i');
    if (closingPattern.test(code)) return code.replace(closingPattern, `${markup}</${target}>`);
    const openingPattern = new RegExp(`<${target}[^>]*>`, 'i');
    if (openingPattern.test(code)) return code.replace(openingPattern, (match) => `${match}${markup}`);
    if (target === 'head') return code.replace(/<html[^>]*>/i, (match) => `${match}<head>${markup}</head>`);
    const withBodyMarkup = code.replace(/<\/html\s*>/i, `${markup}</html>`);
    return withBodyMarkup === code ? `${code}${markup}` : withBodyMarkup;
  }

  function buildPreviewDocument(tab) {
    const nightCss = previewNight ? `
      html,body{background:#141922!important;color:#e2e7f2!important;}
      a{color:#84aaff!important;}
      button,input,select,textarea,.btn{background:#223760!important;color:#d4e2ff!important;border-color:#4664aa!important;}
      h1,h2,h3,h4,h5,h6{color:#fff!important;}
      table{background:#1a202a!important;color:#e2e7f2!important;}
      th,td{border-color:#364263!important;}` : '';
    const combinedCss = [nightCss, tab.css].filter(Boolean).join('\n');
    const styleBlock = combinedCss
      ? `<style data-mini-code-style>${escapeClosingTag(combinedCss, 'style')}</style>`
      : '';
    const scriptBlock = tab.js
      ? `<script data-mini-code-script>${escapeClosingTag(tab.js, 'script')}<\/script>`
      : '';
    const htmlInput = tab.html.trim();

    if (/^\s*(?:<!doctype[^>]*>\s*)?<html(?:\s|>)/i.test(htmlInput)) {
      let code = htmlInput;
      code = injectIntoDocument(code, 'head', styleBlock);
      code = injectIntoDocument(code, 'body', scriptBlock);
      return code;
    }

    return `<!doctype html>
      <html>
        <head>${styleBlock}</head>
        <body>${tab.html}${scriptBlock}</body>
      </html>`;
  }

  function runCode({ recordExecution = true, persist = true } = {}) {
    if (!saveCurrentTabData() || !tabs[current]) return;
    returnToPreviewBtnEl.hidden = true;
    resultIframeEl.srcdoc = buildPreviewDocument(tabs[current]);
    previewMode = 'execution';

    if (recordExecution) {
      tabs[current].lastExec = new Date().toISOString();
      tabs[current].execCount = Math.min(Number.MAX_SAFE_INTEGER, (tabs[current].execCount || 0) + 1);
    }
    showExecInfo();
    if (persist && workspaceMode === 'local') persistCandidate(tabs);
  }

  function showExecInfo() {
    const tab = tabs[current];
    if (!tab) {
      execInfoEl.textContent = 'Ctrl+Enterで実行／Ctrl+Sで保存';
      return;
    }
    execInfoEl.textContent = `Ctrl+Enterで実行／Ctrl+Sで保存｜最終実行：${formatDate(tab.lastExec)}｜回数：${tab.execCount || 0}`;
  }

  function resetPreview(message = 'コードは自動実行されません。内容を確認して「コードを実行」を押してください。') {
    resultIframeEl.srcdoc = `<!doctype html><html lang="ja"><body style="margin:0;padding:2em;background:#f5f7fa;color:#4a5565;font-family:system-ui,sans-serif;text-align:center;"><p>${escapeHtml(message)}</p></body></html>`;
    previewMode = 'empty';
    returnToPreviewBtnEl.hidden = true;
  }

  function stopPreview() {
    resetPreview('プレビューを停止しました。');
    showSaveNotice('プレビューを停止しました。');
  }

  function viewCodeInPreview(type) {
    if (!saveCurrentTabData() || !tabs[current]) return;
    const label = { html: 'HTML', css: 'CSS', js: 'JavaScript' }[type] || 'コード';
    const escapedCode = escapeHtml(tabs[current][type] || '');
    resultIframeEl.srcdoc = `<!doctype html><html lang="ja"><head><style>
      body{margin:0;background:#282c34;color:#d7dae0;font:14px/1.55 ui-monospace,monospace;}
      header{padding:.65em 1em;background:#20232a;color:#9fb5ff;font-family:system-ui,sans-serif;font-weight:700;}
      pre{margin:0;padding:1em;white-space:pre-wrap;overflow-wrap:anywhere;}
    </style></head><body><header>${label}</header><pre><code>${escapedCode}</code></pre></body></html>`;
    previewMode = 'code';
    returnToPreviewBtnEl.hidden = false;
  }

  function clearAllTabData() {
    if (!confirm('現在のタブの内容をすべてクリアしますか？ HTML・CSS・JavaScript・メモが対象です。')) return;
    flushPendingEditHistory();
    saveCurrentTabData();
    pushUndo();
    Object.assign(tabs[current], { html: '', css: '', js: '', note: '', lastExec: null, execCount: 0 });
    renderEditor();
    resetPreview('現在のタブをクリアしました。Undoで元に戻せます。');
    saveTabs();
  }

  function exportTabs() {
    if (!saveCurrentTabData()) return;
    downloadTextFile(JSON.stringify(tabs, null, 2), 'miniCodeTabs.json');
    showSaveNotice('JSONをエクスポートしました。');
  }

  function importTabs(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      showSaveNotice('インポートできません：ファイルサイズは2MB以下にしてください。', 'error', 0);
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const importedTabs = validateTabsData(JSON.parse(reader.result));
        if (!confirm(`${importedTabs.length}件のタブをインポートし、現在の保存データと置き換えますか？ 元のデータはバックアップへ退避されます。`)) return;
        if (!persistCandidate(importedTabs, { destructive: true, reason: 'import-json' })) return;

        flushPendingEditHistory();
        pushUndo();
        tabs = importedTabs;
        current = 0;
        workspaceMode = 'local';
        corruptSavedData = null;
        localWorkspaceSnapshot = { tabs: cloneTabs(), current: 0, mode: 'local', corruptSavedData: null };
        renderTabs();
        resetPreview('インポートしました。コードはまだ実行されていません。');
        hideSystemNotice();
        showSaveNotice('タブデータをインポートしました。');
      } catch (error) {
        console.error('Import error:', error);
        showSaveNotice(`インポートできません：${error.message}`, 'error', 0);
      } finally {
        input.value = '';
      }
    };
    reader.onerror = () => {
      showSaveNotice('インポートできません：ファイルを読み込めませんでした。', 'error', 0);
      input.value = '';
    };
    reader.readAsText(file);
  }

  function shareCurrentTab() {
    if (!saveCurrentTabData() || !tabs[current]) return;
    try {
      const shareUrl = new URL(location.href);
      shareUrl.search = '';
      shareUrl.hash = '';
      shareUrl.searchParams.set('data', stringToBase64Url(JSON.stringify([tabs[current]])));
      if (shareUrl.toString().length > MAX_SHARE_URL_LENGTH) {
        throw new Error(`共有URLが${MAX_SHARE_URL_LENGTH}文字を超えます。JSON Exportを利用してください。`);
      }
      prompt(`現在の「${tabs[current].name}」だけを共有できます。受け取った側では自動実行・自動保存されません。`, shareUrl.toString());
    } catch (error) {
      console.error('Share URL generation error:', error);
      showSaveNotice(`共有URLを生成できません：${error.message}`, 'error', 0);
    }
  }

  function setEditorWidth(width) {
    const nextWidth = Math.min(900, Math.max(220, Math.round(width)));
    editorColEl.style.width = `${nextWidth}px`;
    dividerEl.setAttribute('aria-valuenow', String(nextWidth));
    return nextWidth;
  }

  function saveEditorWidth(width) {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch (error) {
      console.error('Failed to save editor width:', error);
    }
  }

  function setupDivider() {
    try {
      const storedWidth = Number.parseInt(localStorage.getItem(WIDTH_KEY), 10);
      if (Number.isFinite(storedWidth)) setEditorWidth(storedWidth);
    } catch (error) {
      console.error('Failed to load editor width:', error);
    }

    dividerEl.addEventListener('pointerdown', (event) => {
      if (innerWidth < 900 || event.target.closest('.snap-btn')) return;
      isDragging = true;
      dragStartX = event.clientX;
      dragStartWidth = editorColEl.offsetWidth;
      dividerEl.classList.add('active');
      dividerEl.setPointerCapture?.(event.pointerId);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    });

    dividerEl.addEventListener('pointermove', (event) => {
      if (!isDragging) return;
      setEditorWidth(dragStartWidth + event.clientX - dragStartX);
    });

    const finishDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      dividerEl.classList.remove('active');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      saveEditorWidth(editorColEl.offsetWidth);
    };
    dividerEl.addEventListener('pointerup', finishDrag);
    dividerEl.addEventListener('pointercancel', finishDrag);

    dividerEl.addEventListener('dblclick', () => {
      if (innerWidth < 900) return;
      saveEditorWidth(setEditorWidth(dividerEl.parentElement.offsetWidth / 2));
    });

    dividerEl.addEventListener('keydown', (event) => {
      if (innerWidth < 900) return;
      let width = editorColEl.offsetWidth;
      if (event.key === 'ArrowLeft') width -= event.shiftKey ? 50 : 10;
      else if (event.key === 'ArrowRight') width += event.shiftKey ? 50 : 10;
      else if (event.key === 'Home') width = 220;
      else if (event.key === 'End') width = 900;
      else return;
      event.preventDefault();
      saveEditorWidth(setEditorWidth(width));
    });

    dividerEl.querySelectorAll('.snap-btn').forEach((button) => {
      button.addEventListener('click', () => {
        if (innerWidth < 900) return;
        const width = dividerEl.parentElement.offsetWidth * Number.parseFloat(button.dataset.snap);
        saveEditorWidth(setEditorWidth(width));
      });
    });
  }

  function updateNightButtonState() {
    nightBtnEl.classList.toggle('active', previewNight);
    nightBtnEl.textContent = previewNight ? '🌚' : '🌝';
    nightBtnEl.setAttribute('aria-pressed', String(previewNight));
    nightBtnEl.setAttribute('aria-label', previewNight ? 'プレビューナイトモードを解除' : 'プレビューナイトモードを有効化');
  }

  function setupNightMode() {
    try {
      previewNight = localStorage.getItem(PREVIEW_NIGHT_KEY) === '1';
    } catch (error) {
      console.error('Failed to load night mode:', error);
    }
    updateNightButtonState();

    nightBtnEl.addEventListener('click', () => {
      previewNight = !previewNight;
      updateNightButtonState();
      try {
        localStorage.setItem(PREVIEW_NIGHT_KEY, previewNight ? '1' : '0');
      } catch (error) {
        showSaveNotice('ナイトモード設定を保存できませんでした。', 'warning');
      }
      if (previewMode === 'execution') runCode({ recordExecution: false, persist: false });
    });
  }

  function enterFullscreen() {
    if (fullscreenMode) return;
    fullscreenReturnFocus = document.activeElement;
    resultIframeEl.classList.add('fullscreen-iframe');
    fullscreenCloseBtnEl.hidden = false;
    fullscreenMode = true;
    fullscreenCloseBtnEl.focus();
  }

  function exitFullscreen() {
    if (!fullscreenMode) return;
    resultIframeEl.classList.remove('fullscreen-iframe');
    fullscreenCloseBtnEl.hidden = true;
    fullscreenMode = false;
    fullscreenReturnFocus?.focus();
  }

  function getFocusableElements(container) {
    return [...container.querySelectorAll('button:not([hidden]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden);
  }

  function handleModalKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      hideCheatModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements(cheatModalEl);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showCheatModal() {
    modalReturnFocus = document.activeElement;
    cheatModalEl.hidden = false;
    cheatModalEl.addEventListener('keydown', handleModalKeydown);
    cheatModalCloseBtnEl.focus();
  }

  function hideCheatModal() {
    cheatModalEl.hidden = true;
    cheatModalEl.removeEventListener('keydown', handleModalKeydown);
    modalReturnFocus?.focus();
  }

  function setupEventListeners() {
    sidebarToggleBtnEl.addEventListener('click', handleSidebarToggle);
    runBtnEl.addEventListener('click', () => runCode());
    stopPreviewBtnEl.addEventListener('click', stopPreview);
    returnToPreviewBtnEl.addEventListener('click', () => runCode({ recordExecution: false }));
    noteTextareaEl.addEventListener('input', handleNoteInput);
    noteTextareaEl.addEventListener('keydown', handleEditorKeyDown);

    document.getElementById('exportBtn').addEventListener('click', exportTabs);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importTabs);
    document.getElementById('shareBtn').addEventListener('click', shareCurrentTab);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('cheatBtn').addEventListener('click', showCheatModal);
    document.getElementById('clearBtn').addEventListener('click', clearAllTabData);

    fullscreenBtnEl.addEventListener('click', enterFullscreen);
    fullscreenCloseBtnEl.addEventListener('click', exitFullscreen);
    cheatModalCloseBtnEl.addEventListener('click', hideCheatModal);
    cheatModalEl.addEventListener('click', (event) => {
      if (event.target === cheatModalEl) hideCheatModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && fullscreenMode) exitFullscreen();
    });
  }

  function init() {
    cacheDOMElements();
    buildSidebar();
    setupEventListeners();
    loadTabs();
    renderTabs();
    resetPreview();
    setupDivider();
    setupNightMode();
    showExecInfo();
    showWorkspaceNotice();
    sidebarEl.classList.toggle('closed', !sidebarOpen);
    sidebarToggleBtnEl.setAttribute('aria-expanded', String(sidebarOpen));
  }

  window.addEventListener('DOMContentLoaded', init);
  window.addEventListener('beforeunload', () => {
    flushPendingEditHistory();
    clearTimeout(autosaveTimer);
    if (workspaceMode === 'local' && saveCurrentTabData()) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(validateTabsData(tabs)));
      } catch (error) {
        console.error('Failed to save before unload:', error);
      }
    }
  });
})();
