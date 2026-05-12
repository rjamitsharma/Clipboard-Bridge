const socket = io();

let sessionId = null;
let scanner = null;
let selectedMedia = null;
const outgoingTransfers = new Map();
const incomingTransfers = new Map();
const messageLog = [];

const STORAGE_KEY = 'cb_state';

function loadStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    if (!state?.sessionId) return null;
    return state;
  } catch (_e) {
    return null;
  }
}

function saveStoredState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessionId,
      messages: messageLog
    }));
  } catch (_e) {
    // localStorage full or unavailable
  }
}

function clearStoredState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_e) { /* noop */ }
  messageLog.length = 0;
}

function updateUrl(code) {
  try {
    const url = code ? `${location.origin}?session=${code}` : location.origin;
    history.replaceState({ session: code }, '', url);
  } catch (_e) { /* noop */ }
}

function generateId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  arr[6] = (arr[6] & 0x0f) | 0x40;
  arr[8] = (arr[8] & 0x3f) | 0x80;
  const hex = [];
  for (let i = 0; i < 16; i++) {
    hex.push(arr[i].toString(16).padStart(2, '0'));
  }
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const els = {
  homeView: document.getElementById('homeView'),
  chatView: document.getElementById('chatView'),
  dropOverlay: document.getElementById('dropOverlay'),
  showCreateBtn: document.getElementById('showCreateBtn'),
  showJoinBtn: document.getElementById('showJoinBtn'),
  createPanel: document.getElementById('createPanel'),
  joinPanel: document.getElementById('joinPanel'),
  sessionCode: document.getElementById('sessionCode'),
  chatSessionCode: document.getElementById('chatSessionCode'),
  qrBox: document.getElementById('qrBox'),
  joinCode: document.getElementById('joinCode'),
  joinBtn: document.getElementById('joinBtn'),
  scanBtn: document.getElementById('scanBtn'),
  reader: document.getElementById('reader'),
  statusLine: document.getElementById('statusLine'),
  backBtn: document.getElementById('backBtn'),
  chatMessages: document.getElementById('chatMessages'),
  textInput: document.getElementById('textInput'),
  sendBtn: document.getElementById('sendBtn'),
  attachBtn: document.getElementById('attachBtn'),
  fileInput: document.getElementById('fileInput'),
  mediaViewer: document.getElementById('mediaViewer'),
  viewerContent: document.getElementById('viewerContent'),
  viewerCloseBtn: document.getElementById('viewerCloseBtn'),
  viewerDownloadBtn: document.getElementById('viewerDownloadBtn'),
  holdMenu: document.getElementById('holdMenu'),
  holdDownloadBtn: document.getElementById('holdDownloadBtn'),
  holdCancelBtn: document.getElementById('holdCancelBtn')
};

function setView(view) {
  els.homeView.classList.toggle('active', view === 'home');
  els.chatView.classList.toggle('active', view === 'chat');
}

function setStatusLine(text) {
  els.statusLine.textContent = text;
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  messageLog.push({ type: 'system', text });
  saveStoredState();
}

function addTextMessage(text, direction) {
  const div = document.createElement('div');
  div.className = `msg ${direction}`;

  const textBlock = document.createElement('div');
  textBlock.className = 'msg-text';
  appendLinkedText(textBlock, text);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.appendChild(createMiniIconButton('copy', 'Copy text', async () => {
    await copyText(text);
  }));

  div.appendChild(textBlock);
  div.appendChild(actions);
  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  messageLog.push({ type: 'text', text, direction });
  saveStoredState();
}

function addFileMessage(name, type, base64, direction) {
  const bytes = base64ToUint8(base64);
  const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const div = document.createElement('div');
  div.className = `msg ${direction}`;

  if (type && type.startsWith('image/')) {
    const frame = document.createElement('div');
    frame.className = 'msg-media-frame';
    const img = document.createElement('img');
    img.className = 'msg-media';
    img.src = url;
    img.alt = name;
    img.loading = 'lazy';
    frame.appendChild(img);
    div.appendChild(frame);
    attachMediaInteractions(img, { type: 'image', url, name });
  } else if (type && type.startsWith('video/')) {
    const frame = document.createElement('div');
    frame.className = 'msg-media-frame';
    const video = document.createElement('video');
    video.className = 'msg-media';
    video.src = url;
    video.preload = 'metadata';
    video.controls = false;
    frame.appendChild(video);
    div.appendChild(frame);
    attachMediaInteractions(video, { type: 'video', url, name });
  } else {
    const fileName = document.createElement('div');
    fileName.className = 'msg-caption';
    fileName.textContent = name;
    div.appendChild(fileName);
  }

  if (type && (type.startsWith('image/') || type.startsWith('video/'))) {
    const caption = document.createElement('div');
    caption.className = 'msg-caption';
    caption.textContent = name;
    div.appendChild(caption);
  }

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.appendChild(createMiniIconButton('download', 'Download file', () => {
    downloadByUrl(url, name);
  }));
  div.appendChild(actions);

  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

  messageLog.push({ type: 'file', name, fileType: type, direction, size: base64.length });
  saveStoredState();
}

function addTransferCard({ direction, id, name, type, size, previewDataUrl, statusText, onDownload }) {
  const div = document.createElement('div');
  div.className = `msg ${direction}`;

  const canShowPreview = Boolean(previewDataUrl);
  const isMedia = type?.startsWith('image/') || type?.startsWith('video/');
  if (isMedia || canShowPreview) {
    const frame = document.createElement('div');
    frame.className = 'msg-media-frame';
    if (previewDataUrl) {
      const img = document.createElement('img');
      img.className = 'msg-media';
      img.src = previewDataUrl;
      img.alt = name;
      frame.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'msg-media-placeholder';
      ph.textContent = type.startsWith('video/') ? 'Video preview' : 'Image preview';
      frame.appendChild(ph);
    }
    div.appendChild(frame);
  }

  const caption = document.createElement('div');
  caption.className = 'msg-caption';
  caption.textContent = `${name} (${formatBytes(size || 0)})`;
  div.appendChild(caption);

  const status = document.createElement('div');
  status.className = 'msg-transfer-status';
  status.textContent = statusText || '';
  div.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const downloadBtn = createMiniIconButton('download', 'Download file', () => {
    onDownload?.(id);
  });
  actions.appendChild(downloadBtn);
  div.appendChild(actions);

  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  return { statusEl: status, downloadBtn };
}

function appendLinkedText(container, text) {
  const value = String(text || '');
  const regex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  let cursor = 0;
  let match = regex.exec(value);

  while (match) {
    const start = match.index;
    const rawMatch = match[0];
    if (start > cursor) {
      container.appendChild(document.createTextNode(value.slice(cursor, start)));
    }

    const { cleanUrl, trailing } = splitTrailingPunctuation(rawMatch);
    const href = cleanUrl.startsWith('www.') ? `https://${cleanUrl}` : cleanUrl;
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = cleanUrl;
    container.appendChild(a);

    if (trailing) {
      container.appendChild(document.createTextNode(trailing));
    }

    cursor = start + rawMatch.length;
    match = regex.exec(value);
  }

  if (cursor < value.length) {
    container.appendChild(document.createTextNode(value.slice(cursor)));
  }
}

function splitTrailingPunctuation(linkText) {
  let cleanUrl = linkText;
  let trailing = '';
  while (/[),.!?]$/.test(cleanUrl)) {
    trailing = cleanUrl.slice(-1) + trailing;
    cleanUrl = cleanUrl.slice(0, -1);
  }
  return { cleanUrl, trailing };
}

function createMiniIconButton(kind, ariaLabel, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-mini-btn';
  setMiniIcon(btn, kind, ariaLabel);
  btn.addEventListener('click', (evt) => {
    evt.stopPropagation();
    onClick();
  });
  return btn;
}

function setMiniIcon(btn, kind, ariaLabel) {
  btn.dataset.kind = kind;
  btn.setAttribute('aria-label', ariaLabel);
  btn.title = ariaLabel;
  btn.innerHTML = getActionIconSvg(kind);
}

function getActionIconSvg(kind) {
  if (kind === 'copy') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v12H9z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4V4h11v1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }

  if (kind === 'save') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4v6h8V4M8 20v-6h8v6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }

  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 18h16" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
}

async function copyText(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
  } catch (_err) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function attachMediaInteractions(node, media) {
  let suppressClick = false;
  let longPressTimer = null;

  const openHold = () => {
    suppressClick = true;
    selectedMedia = media;
    els.holdMenu.classList.remove('hidden');
    window.setTimeout(() => {
      suppressClick = false;
    }, 240);
  };

  node.addEventListener('pointerdown', (evt) => {
    if (evt.button !== undefined && evt.button !== 0) return;
    longPressTimer = window.setTimeout(openHold, 550);
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => {
    node.addEventListener(eventName, () => {
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
      }
    });
  });

  node.addEventListener('contextmenu', (evt) => {
    evt.preventDefault();
    openHold();
  });

  node.addEventListener('click', () => {
    if (suppressClick) return;
    openMediaViewer(media);
  });
}

function openMediaViewer(media) {
  selectedMedia = media;
  els.viewerContent.innerHTML = '';

  if (media.type === 'image') {
    const img = document.createElement('img');
    img.src = media.url;
    img.alt = media.name;
    els.viewerContent.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = media.url;
    video.controls = true;
    video.autoplay = true;
    els.viewerContent.appendChild(video);
  }

  els.mediaViewer.classList.remove('hidden');
}

function closeMediaViewer() {
  els.mediaViewer.classList.add('hidden');
  els.viewerContent.innerHTML = '';
}

function closeHoldMenu() {
  els.holdMenu.classList.add('hidden');
}

function downloadSelectedMedia() {
  if (!selectedMedia) return;
  downloadByUrl(selectedMedia.url, selectedMedia.name || 'media');
}

function downloadByUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

socket.on('connect', () => {
  setStatusLine('Connected to server.');
});

socket.on('disconnect', () => {
  setStatusLine('Disconnected from server.');
});

els.showCreateBtn.addEventListener('click', async () => {
  els.createPanel.classList.remove('hidden');
  els.joinPanel.classList.add('hidden');

  const res = await fetch('/api/session');
  const data = await res.json();
  sessionId = data.id;
  els.sessionCode.textContent = sessionId;
  saveStoredState();
  updateUrl(sessionId);

  const url = `${location.origin}?session=${sessionId}&join=1`;

  els.qrBox.innerHTML = '';
  const qrRes = await fetch(`/api/qr?text=${encodeURIComponent(url)}`);
  if (!qrRes.ok) {
    alert('Unable to generate QR right now. Please try again.');
    return;
  }
  const qrData = await qrRes.json();
  if (!qrData?.dataUrl) {
    alert('Unable to generate QR right now. Please try again.');
    return;
  }

  const img = document.createElement('img');
  img.src = qrData.dataUrl;
  img.alt = `Session QR ${sessionId}`;
  img.width = 220;
  img.height = 220;
  els.qrBox.appendChild(img);

  joinSession(sessionId, { openChat: false, announce: false });
  setStatusLine('Session created. Waiting for peer...');
});

els.showJoinBtn.addEventListener('click', () => {
  els.joinPanel.classList.remove('hidden');
  els.createPanel.classList.add('hidden');
});

els.joinBtn.addEventListener('click', () => {
  const code = els.joinCode.value.trim().toUpperCase();
  if (!code) return;
  joinSession(code);
});

els.scanBtn.addEventListener('click', async () => {
  els.reader.classList.remove('hidden');

  if (!scanner) {
    scanner = new Html5Qrcode('reader');
  }

  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      async (decodedText) => {
        try {
          const url = new URL(decodedText);
          const code = url.searchParams.get('session');
          if (!code) return;
          els.joinCode.value = code.toUpperCase();
          await scanner.stop();
          els.reader.classList.add('hidden');
          joinSession(code);
        } catch (_err) {
          // Ignore non-link QR payload.
        }
      }
    );
  } catch (_err) {
    alert('Unable to access camera for QR scan.');
  }
});

els.sendBtn.addEventListener('click', () => {
  sendText();
});

els.textInput.addEventListener('keydown', (evt) => {
  if (evt.key === 'Enter') {
    evt.preventDefault();
    sendText();
  }
});

els.attachBtn.addEventListener('click', () => {
  els.fileInput.click();
});

els.fileInput.addEventListener('change', async () => {
  const files = els.fileInput.files;
  for (const file of files) {
    await processOutgoingFile(file);
  }
  els.fileInput.value = '';
});

async function processOutgoingFile(file) {
  if (!file || !sessionId) return;

  const id = generateId();
  const type = file.type || 'application/octet-stream';
  const previewDataUrl = await buildPreviewDataUrl(file);
  const dom = addTransferCard({
    direction: 'out',
    id,
    name: file.name,
    type,
    size: file.size,
    previewDataUrl,
    statusText: 'Shared. Waiting for receiver to download...',
    onDownload: null
  });
  dom.downloadBtn.disabled = true;

  outgoingTransfers.set(id, {
    id,
    file,
    name: file.name,
    type,
    size: file.size,
    dom
  });

  socket.emit('relay:file-offer', {
    sessionId,
    offer: {
      id,
      name: file.name,
      type,
      size: file.size,
      previewDataUrl
    }
  });
}

function setupDragAndDrop() {
  let dragCounter = 0;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    els.chatView.addEventListener(eventName, (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
  });

  els.chatView.addEventListener('dragenter', () => {
    dragCounter += 1;
    if (dragCounter === 1) {
      els.dropOverlay.classList.remove('hidden');
    }
  });

  els.chatView.addEventListener('dragleave', () => {
    dragCounter -= 1;
    if (dragCounter <= 0) {
      dragCounter = 0;
      els.dropOverlay.classList.add('hidden');
    }
  });

  els.chatView.addEventListener('drop', async (evt) => {
    dragCounter = 0;
    els.dropOverlay.classList.add('hidden');

    const files = evt.dataTransfer?.files;
    if (!files || !files.length) return;

    for (const file of files) {
      await processOutgoingFile(file);
    }
  });
}

setupDragAndDrop();

els.backBtn.addEventListener('click', async () => {
  closeMediaViewer();
  closeHoldMenu();

  if (scanner) {
    try {
      await scanner.stop();
    } catch (_err) {
      // Scanner may not be running.
    }
  }

  sessionId = null;
  outgoingTransfers.clear();
  incomingTransfers.clear();
  els.chatMessages.innerHTML = '';
  els.sessionCode.textContent = '-';
  els.chatSessionCode.textContent = '-';
  clearStoredState();
  updateUrl(null);
  setView('home');
});

els.viewerCloseBtn.addEventListener('click', closeMediaViewer);
els.viewerDownloadBtn.addEventListener('click', () => {
  downloadSelectedMedia();
});
els.mediaViewer.addEventListener('click', (evt) => {
  if (evt.target === els.mediaViewer) {
    closeMediaViewer();
  }
});

els.holdDownloadBtn.addEventListener('click', () => {
  downloadSelectedMedia();
  closeHoldMenu();
});
els.holdCancelBtn.addEventListener('click', closeHoldMenu);
els.holdMenu.addEventListener('click', (evt) => {
  if (evt.target === els.holdMenu) {
    closeHoldMenu();
  }
});

document.addEventListener('keydown', (evt) => {
  if (evt.key === 'Escape') {
    closeMediaViewer();
    closeHoldMenu();
  }
});

async function joinSession(code, options = {}) {
  const { openChat = true, announce = true } = options;
  socket.emit('session:join', code, async (resp) => {
    if (!resp?.ok) {
      if (els.chatView.classList.contains('active')) {
        clearStoredState();
        updateUrl(null);
        sessionId = null;
        els.chatMessages.innerHTML = '';
        setView('home');
      }
      alert(resp?.error || 'Could not join session.');
      return;
    }

    sessionId = code.toUpperCase();
    els.chatSessionCode.textContent = sessionId;
    saveStoredState();
    updateUrl(sessionId);

    if (openChat) {
      setView('chat');
      if (announce) {
        addSystemMessage(`Joined session ${sessionId}`);
      }
    }

    if (!resp.peers.length) {
      setStatusLine('Session ready. Waiting for peer...');
      return;
    }

    if (!openChat) {
      setView('chat');
      addSystemMessage(`Connected to session ${sessionId}`);
    }

    setStatusLine('Peer connected.');
  });
}

socket.on('peer:joined', () => {
  if (els.homeView.classList.contains('active')) {
    setView('chat');
    addSystemMessage(`Connected to session ${sessionId}`);
  }
  addSystemMessage('Peer connected');
  setStatusLine('Peer connected.');
});

socket.on('peer:left', () => {
  outgoingTransfers.clear();
  incomingTransfers.clear();
  addSystemMessage('Peer left the session');
  setStatusLine('Peer disconnected. Waiting for reconnection...');
});

socket.on('relay:text', ({ text }) => {
  addTextMessage(text, 'in');
});

socket.on('relay:file', ({ name, type, payload }) => {
  addFileMessage(name, type, payload, 'in');
});

socket.on('relay:file-offer', (offer) => {
  if (!offer?.id) return;
  const dom = addTransferCard({
    direction: 'in',
    id: offer.id,
    name: offer.name || 'file',
    type: offer.type || 'application/octet-stream',
    size: offer.size || 0,
    previewDataUrl: offer.previewDataUrl || null,
    statusText: 'Tap download to start transfer',
    onDownload: requestIncomingDownload
  });

  incomingTransfers.set(offer.id, {
    ...offer,
    chunks: [],
    received: 0,
    total: 0,
    phase: 'offered',
    dom
  });
});

socket.on('relay:file-request', ({ id }) => {
  if (!id) return;
  const transfer = outgoingTransfers.get(id);
  if (!transfer) return;
  streamOutgoingTransfer(transfer);
});

socket.on('relay:file-start', (meta) => {
  if (!meta?.id) return;
  const transfer = incomingTransfers.get(meta.id);
  if (!transfer) return;
  transfer.phase = 'receiving';
  transfer.total = meta.total || 0;
  transfer.received = 0;
  transfer.chunks = [];
  transfer.dom.downloadBtn.disabled = true;
  setMiniIcon(transfer.dom.downloadBtn, 'download', 'Download file');
  transfer.dom.statusEl.textContent = 'Downloading... 0%';
});

socket.on('relay:file-chunk', (chunk) => {
  if (!chunk?.id) return;
  const transfer = incomingTransfers.get(chunk.id);
  if (!transfer) return;
  transfer.chunks.push(chunk.payload);
  transfer.received += 1;
  const total = chunk.total || transfer.total || 1;
  transfer.total = total;
  const pct = Math.min(100, Math.floor((transfer.received / total) * 100));
  transfer.dom.statusEl.textContent = `Downloading... ${pct}%`;
  if (transfer.received >= total) {
    transfer.phase = 'ready';
    transfer.dom.statusEl.textContent = 'Download ready';
    transfer.dom.downloadBtn.disabled = false;
    setMiniIcon(transfer.dom.downloadBtn, 'save', 'Save file');
  }
});

function sendText() {
  const text = els.textInput.value.trim();
  if (!text || !sessionId) return;

  addTextMessage(text, 'out');
  socket.emit('relay:text', { sessionId, text });

  els.textInput.value = '';
}

function requestIncomingDownload(id) {
  const transfer = incomingTransfers.get(id);
  if (!transfer) return;

  if (transfer.phase === 'ready') {
    setMiniIcon(transfer.dom.downloadBtn, 'save', 'Save file');
    saveIncomingTransfer(transfer);
    return;
  }

  if (transfer.phase !== 'offered') return;
  transfer.phase = 'requesting';
  transfer.dom.downloadBtn.disabled = true;
  transfer.dom.statusEl.textContent = 'Requesting file from sender...';
  socket.emit('relay:file-request', { sessionId, id });
}

async function streamOutgoingTransfer(transfer) {
  const { id, file, dom } = transfer;
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const chunkSize = 32000;
  const total = Math.ceil(base64.length / chunkSize);

  socket.emit('relay:file-start', { sessionId, meta: { id, total } });

  for (let i = 0; i < total; i += 1) {
    const payload = base64.slice(i * chunkSize, (i + 1) * chunkSize);
    socket.emit('relay:file-chunk', {
      sessionId,
      chunk: { id, total, index: i, payload }
    });
    const pct = Math.min(100, Math.floor(((i + 1) / total) * 100));
    dom.statusEl.textContent = `Uploading... ${pct}%`;
  }

  dom.statusEl.textContent = 'Upload complete';
}

function saveIncomingTransfer(transfer) {
  if (!transfer?.chunks?.length) return;
  const base64 = transfer.chunks.join('');
  const bytes = base64ToUint8(base64);
  const blob = new Blob([bytes], { type: transfer.type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  downloadByUrl(url, transfer.name || 'file');
}

async function buildPreviewDataUrl(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  const isHeic = type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif');
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');

  if (isHeic) {
    return renderHeicPlaceholder(file);
  }

  if (type.startsWith('image/')) {
    return renderImagePreview(file);
  }

  if (type.startsWith('video/')) {
    return renderVideoPreview(file);
  }

  if (isPdf) {
    return renderPdfPreview(file);
  }

  return null;
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function renderImagePreview(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
    return drawPreviewToDataUrl(img, 280);
  } catch (_err) {
    return null;
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function renderVideoPreview(file) {
  const src = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });
    const seekTo = Math.min(0.2, Math.max(0, (video.duration || 0) / 4));
    await new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done);
        resolve();
      };
      video.addEventListener('seeked', done, { once: true });
      try {
        video.currentTime = seekTo;
      } catch (_err) {
        resolve();
      }
      window.setTimeout(resolve, 350);
    });
    const shot = drawPreviewToDataUrl(video, 280);
    return shot || renderVideoPlaceholder(file);
  } catch (_err) {
    return renderVideoPlaceholder(file);
  } finally {
    URL.revokeObjectURL(src);
  }
}

function renderVideoPlaceholder(file) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#1a2028';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(132, 84);
  ctx.lineTo(132, 136);
  ctx.lineTo(182, 110);
  ctx.closePath();
  ctx.fill();
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#d9dde2';
  ctx.fillText((file?.name || 'video').slice(0, 30), 18, 196);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function renderPdfPreview(file) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#f1eee6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(46, 26, 228, 168);
  ctx.strokeStyle = '#d6d2c8';
  ctx.lineWidth = 2;
  ctx.strokeRect(46, 26, 228, 168);

  ctx.fillStyle = '#d63b3b';
  ctx.fillRect(46, 26, 54, 30);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('PDF', 57, 46);

  ctx.fillStyle = '#5d6874';
  ctx.font = '13px sans-serif';
  const text = (file?.name || 'Document.pdf').slice(0, 28);
  ctx.fillText(text, 56, 88);
  ctx.fillText('Tap download to fetch full file', 56, 112);

  return canvas.toDataURL('image/jpeg', 0.8);
}

function renderHeicPlaceholder(file) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#e8edf6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#2b4d83';
  ctx.fillRect(18, 18, 88, 30);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('HEIC', 34, 38);
  ctx.fillStyle = '#5d6874';
  ctx.font = '13px sans-serif';
  ctx.fillText((file?.name || 'image.heic').slice(0, 30), 18, 96);
  ctx.fillText('Preview generated for HEIC', 18, 118);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function drawPreviewToDataUrl(source, maxSide) {
  const w = source.videoWidth || source.naturalWidth || source.width || 0;
  const h = source.videoHeight || source.naturalHeight || source.height || 0;
  if (!w || !h) return null;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', 0.72);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function restoreMessages() {
  for (const entry of messageLog) {
    if (entry.type === 'system') {
      const div = document.createElement('div');
      div.className = 'msg system';
      div.textContent = entry.text;
      els.chatMessages.appendChild(div);
    } else if (entry.type === 'text') {
      const div = document.createElement('div');
      div.className = `msg ${entry.direction}`;

      const textBlock = document.createElement('div');
      textBlock.className = 'msg-text';
      appendLinkedText(textBlock, entry.text);

      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.appendChild(createMiniIconButton('copy', 'Copy text', async () => {
        await copyText(entry.text);
      }));

      div.appendChild(textBlock);
      div.appendChild(actions);
      els.chatMessages.appendChild(div);
    } else if (entry.type === 'file') {
      const div = document.createElement('div');
      div.className = `msg ${entry.direction}`;

      const caption = document.createElement('div');
      caption.className = 'msg-caption';
      caption.textContent = `${entry.name} (file)`;
      div.appendChild(caption);

      els.chatMessages.appendChild(div);
    }
  }
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

const params = new URLSearchParams(location.search);
const codeFromUrl = params.get('session');
if (codeFromUrl) {
  els.joinCode.value = codeFromUrl.toUpperCase();
  els.joinPanel.classList.remove('hidden');
  els.createPanel.classList.add('hidden');
  joinSession(codeFromUrl.toUpperCase());
} else {
  const stored = loadStoredState();
  if (stored) {
    messageLog.push(...(stored.messages || []));
    sessionId = stored.sessionId;
    els.chatSessionCode.textContent = sessionId;
    updateUrl(sessionId);
    setView('chat');
    restoreMessages();
    setStatusLine('Reconnecting to session...');
    joinSession(sessionId, { announce: false });
  }
}
