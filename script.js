(function() { // IIFE Start
  'use strict';

  // --- 定数 ---
  const STORAGE_KEY = 'miniCodeTabs_v2.3';
  const WIDTH_KEY = 'miniCodeTabs_editorWidth_v2.3';
  const PREVIEW_NIGHT_KEY = 'miniCodeTabs_previewNight';
  const MAX_UNDO_STACK = 100;
  const DEFAULT_TAB_NAME = "無題"; // --- ADDED: Default tab name ---

  // --- 状態 ---
  let tabs = [];
  let current = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartWidth = 0;
  let fullscreenMode = false;
  let previewNight = localStorage.getItem(PREVIEW_NIGHT_KEY) === '1';
  let sidebarOpen = true;
  let undoStack = [], redoStack = [];
  let lockStack = false;

  // --- DOM要素キャッシュ ---
  let sidebarEl, sidebarToggleBtnEl, tabButtonsEl, editorColEl, editorAreaEl,
      noteTextareaEl, runBtnEl, execInfoEl, saveNoticeEl, dividerEl,
      resultIframeEl, fullscreenBtnEl, fullscreenCloseBtnEl, nightBtnEl,
      cheatModalEl, cheatModalCloseBtnEl, returnToPreviewBtnEl; // Added returnToPreviewBtnEl

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
    returnToPreviewBtnEl = document.getElementById('returnToPreviewBtn'); // Cached the new button
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

  // --- サイドバーUI構築 ---
  function buildSidebar() {
    sidebarEl.innerHTML = `
      <button class="sidebar-btn" id="exportBtn" title="JSONでエクスポート" aria-label="JSONでエクスポート">
        <span>⇩</span>
        <span>Export</span>
        <div class="sidebar-tooltip" style="font-size:0.93em;">タブ全体をJSON保存</div>
      </button>
      <label class="sidebar-btn" for="importFile" tabindex="0" title="JSONでインポート" aria-label="JSONでインポート">
        <span>⇧</span>
        <span>Import</span>
        <input type="file" id="importFile" accept="application/json">
        <div class="sidebar-tooltip" style="font-size:0.93em;">JSONファイルから復元</div>
      </label>
      <button class="sidebar-btn" id="shareBtn" title="共有URL生成" aria-label="共有URL生成">
        <span>🔗</span>
        <span>Share</span>
        <div class="sidebar-tooltip" style="font-size:0.93em;">短い内容をURLで共有</div>
      </button>
      <button class="sidebar-btn" id="undoBtn" title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
        <span>↶</span>
        <span>Undo</span>
        <div class="sidebar-tooltip" style="font-size:0.93em;">ひとつ前に戻す</div>
      </button>
      <button class="sidebar-btn" id="redoBtn" title="やり直し (Ctrl+Y)" aria-label="やり直し">
        <span>↷</span>
        <span>Redo</span>
        <div class="sidebar-tooltip" style="font-size:0.93em;">やり直し</div>
      </button>
      <button class="sidebar-btn" id="cheatBtn" title="ショートカット一覧" aria-label="ショートカット一覧表示">
        <span>？</span>
        <span>Help</span>
        <div class="sidebar-tooltip" style="font-size:0.93em;">ショートカット・使い方</div>
      </button>
      <button class="sidebar-btn" id="clearBtn" title="全クリア" aria-label="現在のタブの内容を全クリア">
        <span>✖</span>
        <span>Clear</span>
        <div class="sidebar-tooltip" style="font-size:0.93em;">全入力を消去</div>
      </button>
    `;
  }

  // --- ヘッダー・サイドバー制御 ---
  function handleSidebarToggle() {
    sidebarOpen = !sidebarOpen;
    sidebarEl.classList.toggle('closed', !sidebarOpen);
    sidebarToggleBtnEl.textContent = sidebarOpen ? '×' : '≡';
    sidebarToggleBtnEl.setAttribute('aria-label', sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く');
  }

  // --- タブ処理 ---
  function loadTabs() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('data')) {
      try {
        const json = fromBase64(urlParams.get('data'));
        const arr = JSON.parse(json);
        if (Array.isArray(arr) && arr.length) {
          tabs = arr;
          current = 0;
          history.replaceState({}, document.title, location.pathname);
          return;
        }
      } catch (e) {
        console.error("Failed to load tabs from URL:", e);
      }
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (Array.isArray(data) && data.length > 0) {
          tabs = data;
          current = Math.min(current, tabs.length - 1);
          return;
        }
      } catch (e) {
        console.error("Failed to load tabs from localStorage:", e);
      }
    }
    tabs = [{name: 'タブ1', html: '', css: '', js: '', note: '', lastExec: null, execCount: 0}];
    current = 0;
  }

  function saveTabs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  }

  function renderTabs() {
    tabButtonsEl.innerHTML = tabs.map((t, i) =>
      `<button class="tab-btn${i === current ? ' active' : ''}" 
               onclick="window.miniCodeApp.switchTab(${i})" 
               ondblclick="window.miniCodeApp.editTabName(${i})" 
               title="ダブルクリックで名前変更">
        <span>${escapeHtml(t.name)}</span>
        ${tabs.length > 1 ? `<span class="close" onclick="event.stopPropagation(); window.miniCodeApp.removeTab(${i});">×</span>` : ''}
      </button>`
    ).join('') +
    `<button class="add-btn" onclick="window.miniCodeApp.addTab()">＋追加</button>`;
    renderEditor();
  }

  function switchTab(i) {
    if (i === current && tabs[i]) return;
    saveCurrentTabData();
    current = i;
    renderTabs();
    runCode();
  }

  function addTab() {
    saveCurrentTabData();
    tabs.push({name: `タブ${tabs.length + 1}`, html: '', css: '', js: '', note: '', lastExec: null, execCount: 0});
    current = tabs.length - 1;
    renderTabs();
    saveTabs();
    runCode();
  }

  function removeTab(idx) {
    if (tabs.length === 1) return;
    const wasCurrent = idx === current;
    tabs.splice(idx, 1);
    if (current >= tabs.length) {
      current = tabs.length - 1;
    }
    renderTabs();
    saveTabs();
    if (wasCurrent) {
      runCode();
    }
  }

  function editTabName(idx) {
    const tabBtnElements = tabButtonsEl.querySelectorAll('.tab-btn');
    if (!tabBtnElements[idx]) return;

    const btn = tabBtnElements[idx];
    const span = btn.querySelector('span:first-child');
    if (!span) return;

    const oldName = tabs[idx].name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;

    input.addEventListener('blur', () => {
      let newName = input.value.trim();
      if (newName === "") {
        newName = oldName; 
      }
      tabs[idx].name = newName;
      renderTabs();
      saveTabs();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = oldName;
        input.blur();
      }
    });

    span.replaceWith(input);
    input.focus();
    input.select();
  }

  // --- Undo/Redo機能 ---
  function pushUndo() {
    if (lockStack) return;
    const data = JSON.stringify(tabs);
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === data) return;

    undoStack.push(data);
    if (undoStack.length > MAX_UNDO_STACK) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(tabs));
    const lastState = undoStack.pop();
    tabs = JSON.parse(lastState);
    current = Math.min(current, tabs.length - 1);
    renderTabs();
    runCode();
    saveTabs();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(tabs));
    const nextState = redoStack.pop();
    tabs = JSON.parse(nextState);
    current = Math.min(current, tabs.length - 1);
    renderTabs();
    runCode();
    saveTabs();
  }

  // --- エディタ ---
  function renderEditor() {
    if (!tabs[current]) {
        if (tabs.length > 0) {
            current = 0;
        } else {
            editorAreaEl.innerHTML = "<p>エラー: 表示できるタブがありません。</p>";
            noteTextareaEl.value = "";
            return;
        }
    }
    const t = tabs[current];
    editorAreaEl.innerHTML = `
      <label>HTML（1枚HTMLコピペ可）<button class="view-code-btn" data-target="html" title="HTMLコードを表示" style="margin-left: 5px; cursor: pointer; border: none; background: none; color: white; font-size: 1.1em;">👀</button><br>
        <textarea id="html" placeholder="HTMLや丸ごと1枚のHTMLコードも貼れます">${escapeHtml(t.html)}</textarea>
      </label>
      <label>CSS<button class="view-code-btn" data-target="css" title="CSSコードを表示" style="margin-left: 5px; cursor: pointer; border: none; background: none; color: white; font-size: 1.1em;">👀</button><br>
        <textarea id="css">${escapeHtml(t.css)}</textarea>
      </label>
      <label>JavaScript<button class="view-code-btn" data-target="js" title="JavaScriptコードを表示" style="margin-left: 5px; cursor: pointer; border: none; background: none; color: white; font-size: 1.1em;">👀</button><br>
        <textarea id="js">${escapeHtml(t.js)}</textarea>
      </label>
    `;
    noteTextareaEl.value = t.note || "";

    ['html', 'css', 'js'].forEach(id => {
      const textarea = document.getElementById(id);
      if (textarea) {
        textarea.addEventListener('keydown', handleEditorKeyDown);
        textarea.addEventListener('input', handleEditorInput);
      }
    });

    // Add event listeners for the new "View Code" buttons
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
          saveCurrentTabData();
          saveTabs();
          showSaveNotice('保存しました（Ctrl+S）');
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

  function handleEditorInput() {
    if (!tabs[current]) return;
    tabs[current].html = document.getElementById('html')?.value || '';
    tabs[current].css = document.getElementById('css')?.value || '';
    tabs[current].js = document.getElementById('js')?.value || '';
    pushUndo();
  }

  function saveCurrentTabData() {
    if (!tabs[current]) return;
    tabs[current].html = document.getElementById('html')?.value || '';
    tabs[current].css = document.getElementById('css')?.value || '';
    tabs[current].js = document.getElementById('js')?.value || '';
    tabs[current].note = noteTextareaEl.value || '';
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
      returnToPreviewBtnEl.style.display = 'inline-block';
    }
  }

  // --- コード実行 ---
  function runCode() {
    if (returnToPreviewBtnEl) { // Hide return button when running normal code
        returnToPreviewBtnEl.style.display = 'none';
    }
    saveCurrentTabData();
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

    if (/^\s*<!?doctype html.*<html[\s\S]*?>/i.test(htmlInput)) {
      code = htmlInput;
      if (nightModeStyles) {
          if (/<head[^>]*>/i.test(code)) {
              code = code.replace(/<head[^>]*>/i, `$&${nightModeStyles}`);
          } else if (/<html[^>]*>/i.test(code)) {
              code = code.replace(/<html[^>]*>/i, `$&<head>${nightModeStyles}</head>`);
          } else {
              code = `<head>${nightModeStyles}</head>${code}`;
          }
      }
    } else {
      code = `
        <html>
        <head>
          ${nightModeStyles}
          <style>${t.css}</style>
        </head>
        <body>
          ${t.html}
          <script>${t.js}<\/script>
        </body>
        </html>
      `;
    }
    resultIframeEl.srcdoc = code;
    t.lastExec = new Date().toISOString();
    t.execCount = (t.execCount || 0) + 1;
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

  function showSaveNotice(msg) {
    saveNoticeEl.textContent = msg;
    setTimeout(() => { saveNoticeEl.textContent = ''; }, 1700);
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
      saveTabs();
    }
  }

  // --- 分割線・スナップ ---
  function setupDivider() {
    const minW = 220, maxW = 900;
    const storedWidth = parseInt(localStorage.getItem(WIDTH_KEY));
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
      localStorage.setItem(WIDTH_KEY, editorColEl.offsetWidth);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    });

    dividerEl.addEventListener('dblclick', function(e) {
      if (window.innerWidth < 900) return;
      const mainAreaRect = dividerEl.parentElement.getBoundingClientRect();
      let clickXInMainArea = e.clientX - mainAreaRect.left;
      let newW = Math.min(maxW, Math.max(minW, clickXInMainArea));
      editorColEl.style.width = newW + 'px';
      localStorage.setItem(WIDTH_KEY, newW);
    });

    dividerEl.querySelectorAll('.snap-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        if (window.innerWidth < 900) return;
        const mainAreaWidth = dividerEl.parentElement.offsetWidth;
        let percent = parseFloat(this.dataset.snap);
        let newW = Math.round(Math.max(minW, Math.min(maxW, mainAreaWidth * percent)));
        editorColEl.style.width = newW + 'px';
        localStorage.setItem(WIDTH_KEY, newW);
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
    cheatModalEl.style.display = 'flex';
    document.addEventListener('keydown', handleCheatModalKeydown); 
  }
  function hideCheatModal() {
    cheatModalEl.style.display = 'none';
    document.removeEventListener('keydown', handleCheatModalKeydown); 
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
      localStorage.setItem(PREVIEW_NIGHT_KEY, previewNight ? '1' : '0');
      updateNightButtonState();
      runCode();
    });
    updateNightButtonState();
  }

  // --- JSONエクスポート ---
  function exportTabs() {
    saveCurrentTabData();
    const blob = new Blob([JSON.stringify(tabs, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "miniCodeTabs.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- JSONインポート ---
  function importTabs(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const importedData = JSON.parse(ev.target.result);
        if (Array.isArray(importedData) && importedData.length > 0) {
          pushUndo();
          tabs = importedData;
          current = 0;
          renderTabs();
          runCode();
          saveTabs();
          alert("タブデータをインポートしました！");
        } else {
          alert("インポート失敗：無効なデータ形式です。");
        }
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
    saveCurrentTabData();
    try {
      const dataToShare = tabs.length > 3 ? tabs.slice(0, 3) : tabs;
      const jsonString = JSON.stringify(dataToShare);
      const base64Param = toBase64(jsonString);
      const shareUrl = `${location.origin}${location.pathname}?data=${base64Param}`;
      prompt("このURLをコピーして共有できます！（内容が長すぎる場合は先頭3タブ分まで）", shareUrl);
    } catch (err) {
      alert("共有URLの生成に失敗しました。データが大きすぎる可能性があります。");
      console.error("Share URL generation error:", err);
    }
  }
  
  // --- Event Listener Setup ---
  function setupEventListeners() {
    sidebarToggleBtnEl.addEventListener('click', handleSidebarToggle);
    runBtnEl.addEventListener('click', runCode);
    noteTextareaEl.addEventListener('input', () => {
        saveCurrentTabData();
        pushUndo();
    });

    if (returnToPreviewBtnEl) { // Add listener for the new button
        returnToPreviewBtnEl.addEventListener('click', runCode);
    }

    document.getElementById('exportBtn').addEventListener('click', exportTabs);
    document.getElementById('importFile').addEventListener('change', importTabs);
    document.getElementById('shareBtn').addEventListener('click', shareTabs);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('cheatBtn').addEventListener('click', showCheatModal);
    document.getElementById('clearBtn').addEventListener('click', clearAllTabData);

    cheatModalCloseBtnEl.addEventListener('click', hideCheatModal);
    cheatModalEl.addEventListener('click', (e) => {
      if (e.target === cheatModalEl) hideCheatModal();
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
      saveCurrentTabData();
      saveTabs();
  });

})(); // IIFE End
