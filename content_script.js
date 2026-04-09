const FLOAT_ID = "__req_breaker_header_float__";
const POSITION_STORAGE_KEY = "__req_breaker_header_float_position__";

const SLEEP_FLOAT_ID = "__redirect_delay_sleep_float__";
const SLEEP_FLOAT_POSITION_KEY = "__redirect_delay_sleep_float_position__";

let currentText = "";
let dragState = null;
let sleepDragState = null;

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

function loadStoredPosition(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
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

function savePosition(storageKey, left, top) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ left, top }));
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
  element.style.bottom = "auto";
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
  savePosition(POSITION_STORAGE_KEY, rect.left, rect.top);
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

  const storedPosition = loadStoredPosition(POSITION_STORAGE_KEY);
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
  const safeHeaderName = String(headerName || "").trim() || "X-App-Node";
  const safeHeaderValue = String(headerValue || "").trim();
  const nextText = safeHeaderValue ? `${safeHeaderName}: ${safeHeaderValue}` : `${safeHeaderName}: (値なし)`;
  const element = getOrCreateFloatElement();
  element.textContent = nextText;

  if (nextText !== currentText) {
    element.style.backgroundColor = hashToColor(nextText);
    currentText = nextText;
  }
}

function setFloatVisibility(isVisible) {
  const element = getOrCreateFloatElement();
  element.style.display = isVisible ? "block" : "none";
}

function getOrCreateSleepFloat() {
  let panel = document.getElementById(SLEEP_FLOAT_ID);
  if (panel) {
    return panel;
  }
  panel = document.createElement("div");
  panel.id = SLEEP_FLOAT_ID;
  panel.style.position = "fixed";
  panel.style.left = "12px";
  panel.style.top = "12px";
  panel.style.bottom = "auto";
  panel.style.right = "auto";
  panel.style.zIndex = "2147483646";
  panel.style.maxWidth = "min(92vw, 520px)";
  panel.style.padding = "12px 14px";
  panel.style.borderRadius = "10px";
  panel.style.background = "rgba(165, 40, 48, 0.94)";
  panel.style.color = "#fff";
  panel.style.fontFamily = "Arial, sans-serif";
  panel.style.fontSize = "12px";
  panel.style.lineHeight = "1.45";
  panel.style.boxShadow = "0 6px 20px rgba(0,0,0,0.35)";
  panel.style.display = "none";
  panel.style.cursor = "move";
  panel.style.userSelect = "none";
  panel.style.wordBreak = "break-all";

  const title = document.createElement("div");
  title.dataset.role = "sleep-title";
  title.style.fontWeight = "700";
  title.style.fontSize = "13px";
  title.style.marginBottom = "6px";
  panel.appendChild(title);

  const body = document.createElement("div");
  body.dataset.role = "sleep-body";
  body.style.fontSize = "11px";
  body.style.color = "rgba(255, 255, 255, 0.92)";
  body.style.whiteSpace = "pre-wrap";
  panel.appendChild(body);

  panel.addEventListener("mousedown", onSleepDragStart);

  const stored = loadStoredPosition(SLEEP_FLOAT_POSITION_KEY);
  if (stored) {
    panel.style.bottom = "auto";
    panel.style.left = `${stored.left}px`;
    panel.style.top = `${stored.top}px`;
  }

  document.documentElement.appendChild(panel);
  return panel;
}

function applySleepPanelPosition(panel, left, top) {
  const rect = panel.getBoundingClientRect();
  const clamped = clampToViewport(left, top, rect.width, rect.height);
  panel.style.left = `${clamped.left}px`;
  panel.style.top = `${clamped.top}px`;
  panel.style.bottom = "auto";
  panel.style.right = "auto";
}

function onSleepDragMove(event) {
  if (!sleepDragState) {
    return;
  }
  const nextLeft = event.clientX - sleepDragState.offsetX;
  const nextTop = event.clientY - sleepDragState.offsetY;
  applySleepPanelPosition(sleepDragState.panel, nextLeft, nextTop);
}

function onSleepDragEnd() {
  if (!sleepDragState) {
    return;
  }
  const rect = sleepDragState.panel.getBoundingClientRect();
  savePosition(SLEEP_FLOAT_POSITION_KEY, rect.left, rect.top);
  sleepDragState = null;
  window.removeEventListener("mousemove", onSleepDragMove);
  window.removeEventListener("mouseup", onSleepDragEnd);
}

function onSleepDragStart(event) {
  if (event.button !== 0) {
    return;
  }
  const panel = getOrCreateSleepFloat();
  const rect = panel.getBoundingClientRect();
  sleepDragState = {
    panel,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  window.addEventListener("mousemove", onSleepDragMove);
  window.addEventListener("mouseup", onSleepDragEnd);
  event.preventDefault();
}

function renderRedirectSleepFloat(payload) {
  const panel = getOrCreateSleepFloat();
  const titleEl = panel.querySelector('[data-role="sleep-title"]');
  const bodyEl = panel.querySelector('[data-role="sleep-body"]');
  if (!titleEl || !bodyEl) {
    return;
  }

  if (payload?.phase === "ended") {
    panel.style.display = "none";
    return;
  }

  if (payload?.phase === "armed") {
    panel.style.display = "none";
    return;
  }

  if (payload?.phase === "sleeping") {
    panel.style.left = "12px";
    panel.style.top = "12px";
    panel.style.bottom = "auto";
    panel.style.right = "auto";
    panel.style.background = "rgba(165, 40, 48, 0.94)";
    const ms = Number(payload.sleepMs) || 0;
    const url = String(payload.targetUrl || "").trim();
    titleEl.textContent = "スリープ中";
    bodyEl.textContent = url
      ? `待機時間: ${ms}ms\n対象URL:\n${url}`
      : `待機時間: ${ms}ms`;
    panel.style.display = "block";
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "headerValueUpdated") {
    const on = Boolean(message.extensionEnabled ?? message.floatEnabled);
    setFloatVisibility(on);
    if (on) {
      updateFloat(message.headerName, message.headerValue);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "redirectSleepFloat") {
    renderRedirectSleepFloat(message);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function syncHeaderFloatState() {
  try {
    const response = await sendRuntimeMessage({ type: "getHeaderDisplayConfig" });
    if (!response?.ok) {
      return;
    }
    const on = Boolean(response.extensionEnabled ?? response.floatEnabled);
    setFloatVisibility(on);
    if (on) {
      updateFloat(response.headerName, response.headerValue);
    }
  } catch (_error) {
    // Ignore transient messaging errors.
  }
}

syncHeaderFloatState();
setInterval(syncHeaderFloatState, 1000);
