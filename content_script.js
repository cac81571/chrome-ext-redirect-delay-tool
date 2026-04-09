const FLOAT_ID = "__req_breaker_header_float__";
const POSITION_STORAGE_KEY = "__req_breaker_header_float_position__";
const PAUSE_PANEL_ID = "__req_breaker_pause_panel__";
const PAUSE_PANEL_POSITION_STORAGE_KEY = "__req_breaker_pause_panel_position__";

let currentText = "";
let dragState = null;
let lastHeaderName = "server";
let lastHeaderValue = "";
let panelDragState = null;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function getOrCreatePausePanel() {
  let panel = document.getElementById(PAUSE_PANEL_ID);
  if (panel) {
    return panel;
  }
  panel = document.createElement("div");
  panel.id = PAUSE_PANEL_ID;
  panel.style.position = "fixed";
  panel.style.left = "12px";
  panel.style.top = "12px";
  panel.style.zIndex = "2147483646";
  panel.style.width = "420px";
  panel.style.maxWidth = "70vw";
  panel.style.maxHeight = "45vh";
  panel.style.padding = "10px";
  panel.style.borderRadius = "10px";
  panel.style.background = "rgba(20, 20, 20, 0.76)";
  panel.style.color = "#fff";
  panel.style.fontFamily = "Arial, sans-serif";
  panel.style.fontSize = "12px";
  panel.style.boxShadow = "0 4px 14px rgba(0,0,0,0.25)";
  panel.style.display = "none";
  panel.style.cursor = "move";
  panel.style.userSelect = "none";
  panel.style.paddingTop = "40px";

  const title = document.createElement("div");
  title.textContent = "全リクエスト停止中";
  title.style.fontWeight = "700";
  title.style.marginBottom = "4px";
  title.style.cursor = "move";
  panel.appendChild(title);

  const status = document.createElement("div");
  status.dataset.role = "paused-status";
  status.style.fontSize = "11px";
  status.style.color = "rgba(255, 255, 255, 0.88)";
  status.style.marginBottom = "8px";
  panel.appendChild(status);

  const list = document.createElement("div");
  list.dataset.role = "blocked-list";
  list.style.maxHeight = "28vh";
  list.style.overflowY = "auto";
  list.style.background = "rgba(255, 255, 255, 0.08)";
  list.style.borderRadius = "6px";
  list.style.padding = "8px";
  list.style.wordBreak = "break-all";
  list.style.marginBottom = "8px";
  list.style.cursor = "default";
  panel.appendChild(list);

  const resumeButton = document.createElement("button");
  resumeButton.textContent = "再開";
  resumeButton.dataset.role = "resume";
  resumeButton.style.position = "absolute";
  resumeButton.style.top = "8px";
  resumeButton.style.right = "8px";
  resumeButton.style.padding = "6px 12px";
  resumeButton.style.border = "none";
  resumeButton.style.borderRadius = "6px";
  resumeButton.style.cursor = "pointer";
  resumeButton.style.background = "#4caf50";
  resumeButton.style.color = "#fff";
  resumeButton.addEventListener("click", async () => {
    try {
      resumeButton.disabled = true;
      await sendRuntimeMessage({ type: "setPaused", isPaused: false });
    } catch (_error) {
      // Ignore failures in page UI; popup can still recover.
    } finally {
      resumeButton.disabled = false;
    }
  });
  panel.appendChild(resumeButton);

  panel.addEventListener("mousedown", onPanelDragStart);

  const storedPosition = loadStoredPausePanelPosition();
  if (storedPosition) {
    applyPausePanelPosition(panel, storedPosition.left, storedPosition.top);
  }

  document.documentElement.appendChild(panel);
  return panel;
}

function loadStoredPausePanelPosition() {
  try {
    const raw = window.localStorage.getItem(PAUSE_PANEL_POSITION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) {
      return null;
    }
    return { left: parsed.left, top: parsed.top };
  } catch (_error) {
    return null;
  }
}

function savePausePanelPosition(left, top) {
  try {
    window.localStorage.setItem(PAUSE_PANEL_POSITION_STORAGE_KEY, JSON.stringify({ left, top }));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function applyPausePanelPosition(panel, left, top) {
  const rect = panel.getBoundingClientRect();
  const clamped = clampToViewport(left, top, rect.width, rect.height);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
  panel.style.bottom = "auto";
}

function onPanelDragMove(event) {
  if (!panelDragState) {
    return;
  }
  const nextLeft = event.clientX - panelDragState.offsetX;
  const nextTop = event.clientY - panelDragState.offsetY;
  applyPausePanelPosition(panelDragState.panel, nextLeft, nextTop);
}

function onPanelDragEnd() {
  if (!panelDragState) {
    return;
  }
  const rect = panelDragState.panel.getBoundingClientRect();
  savePausePanelPosition(rect.left, rect.top);
  panelDragState = null;
  window.removeEventListener("mousemove", onPanelDragMove);
  window.removeEventListener("mouseup", onPanelDragEnd);
}

function onPanelDragStart(event) {
  if (event.button !== 0) {
    return;
  }
  if (event.target.closest("button")) {
    return;
  }
  const panel = getOrCreatePausePanel();
  const rect = panel.getBoundingClientRect();
  panelDragState = {
    panel,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  window.addEventListener("mousemove", onPanelDragMove);
  window.addEventListener("mouseup", onPanelDragEnd);
  event.preventDefault();
}

function renderPausedPanel(isPaused, queuedRequests, passedCount = 0, allowPassCount = 0, queueLength = 0) {
  const panel = getOrCreatePausePanel();
  if (!isPaused) {
    panel.style.display = "none";
    return;
  }
  const status = panel.querySelector('[data-role="paused-status"]');
  const list = panel.querySelector('[data-role="blocked-list"]');
  if (!status || !list) {
    panel.style.display = "none";
    return;
  }
  status.textContent = `現在: 一時停止中 (通過 ${passedCount}/${allowPassCount}件, キュー: ${queueLength}件)`;
  const items = Array.isArray(queuedRequests) ? queuedRequests : [];
  if (items.length === 0) {
    list.textContent = "停止中のURLはまだありません";
  } else {
    list.textContent = "";
    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.style.padding = "4px 0";
      row.style.borderBottom = "1px dashed rgba(255,255,255,0.2)";
      row.textContent = `${index + 1}. [${item.method || "GET"}] ${item.url || ""}`;
      list.appendChild(row);
    });
    const last = list.lastElementChild;
    if (last) {
      last.style.borderBottom = "none";
    }
  }
  panel.style.display = "block";
}

function loadStoredPosition() {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) {
      return null;
    }
    return { left: parsed.left, top: parsed.top };
  } catch (_error) {
    return null;
  }
}

function savePosition(left, top) {
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ left, top }));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function clampToViewport(left, top, width, height) {
  const maxLeft = Math.max(0, window.innerWidth - width);
  const maxTop = Math.max(0, window.innerHeight - height);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop)
  };
}

function applyPosition(element, left, top) {
  const rect = element.getBoundingClientRect();
  const clamped = clampToViewport(left, top, rect.width, rect.height);
  element.style.left = `${clamped.left}px`;
  element.style.top = `${clamped.top}px`;
  element.style.right = "auto";
}

function onDragMove(event) {
  if (!dragState) {
    return;
  }
  const nextLeft = event.clientX - dragState.offsetX;
  const nextTop = event.clientY - dragState.offsetY;
  applyPosition(dragState.element, nextLeft, nextTop);
}

function onDragEnd() {
  if (!dragState) {
    return;
  }
  const rect = dragState.element.getBoundingClientRect();
  savePosition(rect.left, rect.top);
  dragState = null;
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
}

function onDragStart(event) {
  if (event.button !== 0) {
    return;
  }
  const element = getOrCreateFloatElement();
  const rect = element.getBoundingClientRect();
  dragState = {
    element,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
  event.preventDefault();
}

function getOrCreateFloatElement() {
  let element = document.getElementById(FLOAT_ID);
  if (element) {
    return element;
  }
  element = document.createElement("div");
  element.id = FLOAT_ID;
  element.style.position = "fixed";
  element.style.top = "12px";
  element.style.right = "12px";
  element.style.zIndex = "2147483647";
  element.style.padding = "10px 14px";
  element.style.borderRadius = "8px";
  element.style.fontSize = "18px";
  element.style.fontWeight = "700";
  element.style.fontFamily = "Arial, sans-serif";
  element.style.color = "#fff";
  element.style.background = "rgba(68, 68, 68, 0.7)";
  element.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
  element.style.maxWidth = "50vw";
  element.style.wordBreak = "break-all";
  element.style.transition = "background-color 160ms ease";
  element.style.pointerEvents = "auto";
  element.style.cursor = "move";
  element.style.userSelect = "none";
  element.addEventListener("mousedown", onDragStart);

  const storedPosition = loadStoredPosition();
  if (storedPosition) {
    applyPosition(element, storedPosition.left, storedPosition.top);
  }

  document.documentElement.appendChild(element);
  return element;
}

function hashToColor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsla(${hue}, 65%, 45%, 0.7)`;
}

function updateFloat(headerName, headerValue) {
  const safeHeaderName = String(headerName || "").trim() || "server";
  const safeHeaderValue = String(headerValue || "").trim();
  lastHeaderName = safeHeaderName;
  lastHeaderValue = safeHeaderValue;
  const nextText = safeHeaderValue ? `${safeHeaderName}: ${safeHeaderValue}` : `${safeHeaderName}: (値なし)`;
  const element = getOrCreateFloatElement();
  element.textContent = nextText;

  if (nextText !== currentText) {
    element.style.backgroundColor = hashToColor(nextText);
    currentText = nextText;
  }
}

function showRedirectDelayMessage(delayMs) {
  const element = getOrCreateFloatElement();
  const nextText = `Redirect delay: ${delayMs}ms`;
  element.textContent = nextText;
  if (nextText !== currentText) {
    element.style.backgroundColor = "hsla(28, 90%, 45%, 0.78)";
    currentText = nextText;
  }
}

function setFloatVisibility(isVisible) {
  const element = getOrCreateFloatElement();
  element.style.display = isVisible ? "block" : "none";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "headerValueUpdated") {
    setFloatVisibility(Boolean(message.floatEnabled));
    if (message.floatEnabled) {
      updateFloat(message.headerName, message.headerValue);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "redirectDelayStatus") {
    setFloatVisibility(Boolean(message.floatEnabled));
    if (!message.floatEnabled) {
      sendResponse({ ok: true });
      return true;
    }
    if (message.isDelaying) {
      showRedirectDelayMessage(message.delayMs || 0);
    } else {
      updateFloat(message.headerName || lastHeaderName, message.headerValue || lastHeaderValue);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "stateUpdated") {
    renderPausedPanel(
      Boolean(message.isPaused),
      message.queuedRequests || [],
      Number(message.passedCount) || 0,
      Number(message.allowPassCount) || 0,
      Number(message.queueLength) || 0
    );
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function syncPausedPanelState() {
  try {
    const response = await sendRuntimeMessage({ type: "getPaused" });
    if (!response?.ok) {
      return;
    }
    renderPausedPanel(
      Boolean(response.isPaused),
      response.queuedRequests || [],
      Number(response.passedCount) || 0,
      Number(response.allowPassCount) || 0,
      Number(response.queueLength) || 0
    );
  } catch (_error) {
    // Ignore transient messaging errors.
  }
}

syncPausedPanelState();
setInterval(syncPausedPanelState, 1000);
