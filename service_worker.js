const DEBUGGER_VERSION = "1.3";

const DEFAULT_HEADER_NAME = "X-App-Node";

const state = {
  /** リダイレクト後のスリープ用（メイン文書1回だけ待機して解除） */
  redirectSleepSessions: new Map(),
  displayTabId: null,
  headerName: DEFAULT_HEADER_NAME,
  latestHeaderValue: "",
  /** 拡張全体の ON/OFF（ヘッダフロート・リダイレクト待機の両方） */
  extensionEnabled: true,
  redirectSleepMs: 1000,
  /** window.open 呼び出し直前の待機（ミリ秒）。0 で無効 */
  preWindowOpenSleepMs: 0
};

async function persistHeaderDisplaySettings() {
  await chrome.storage.local.set({
    headerDisplayHeaderName: state.headerName,
    headerDisplayExtensionEnabled: state.extensionEnabled,
    headerDisplayRedirectSleepMs: state.redirectSleepMs,
    headerDisplayPreWindowOpenSleepMs: state.preWindowOpenSleepMs
  });
}

function normalizeHeaderName(value) {
  const headerName = String(value || "").trim();
  return headerName || DEFAULT_HEADER_NAME;
}

function updateHeaderDisplay(tabId, headerName, value) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "headerValueUpdated",
      headerName,
      headerValue: value,
      extensionEnabled: state.extensionEnabled
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

/**
 * タブのページに直接注入される（サービスワーカーからシリアライズされる）。
 * 外側のスコープは参照しないこと。
 * @param {{ phase: string; targetUrl?: string; sleepMs?: number; reason?: string }} payload
 */
function redirectSleepFloatPage(payload) {
  const SLEEP_FLOAT_ID = "__redirect_delay_sleep_float__";
  const panel = document.getElementById(SLEEP_FLOAT_ID);
  const phase = payload && payload.phase;

  if (phase === "ended") {
    if (panel) {
      panel.style.display = "none";
    }
    return;
  }

  if (phase === "armed") {
    if (panel) {
      panel.style.display = "none";
    }
    return;
  }

  let el = panel;
  if (!el) {
    el = document.createElement("div");
    el.id = SLEEP_FLOAT_ID;
    el.style.cssText = [
      "position:fixed",
      "left:12px",
      "top:12px",
      "bottom:auto",
      "right:auto",
      "z-index:2147483646",
      "max-width:min(92vw,520px)",
      "padding:12px 14px",
      "border-radius:10px",
      "background:rgba(165,40,48,0.94)",
      "color:#fff",
      "font-family:Arial,sans-serif",
      "font-size:12px",
      "line-height:1.45",
      "box-shadow:0 6px 20px rgba(0,0,0,0.35)",
      "word-break:break-all"
    ].join(";");
    const title = document.createElement("div");
    title.dataset.role = "sleep-title";
    title.style.cssText = "font-weight:700;font-size:13px;margin-bottom:6px;";
    const body = document.createElement("div");
    body.dataset.role = "sleep-body";
    body.style.cssText = "font-size:11px;color:rgba(255,255,255,0.92);white-space:pre-wrap;";
    el.appendChild(title);
    el.appendChild(body);
    document.documentElement.appendChild(el);
  }

  const titleEl = el.querySelector('[data-role="sleep-title"]');
  const bodyEl = el.querySelector('[data-role="sleep-body"]');
  if (!titleEl || !bodyEl) {
    return;
  }

  if (phase === "sleeping") {
    el.style.left = "12px";
    el.style.top = "12px";
    el.style.bottom = "auto";
    el.style.right = "auto";
    el.style.background = "rgba(165,40,48,0.94)";
    const ms = Number(payload.sleepMs) || 0;
    const url = String(payload.targetUrl || "").trim();
    titleEl.textContent = "スリープ中";
    bodyEl.textContent = url ? `待機時間: ${ms}ms\n対象URL:\n${url}` : `待機時間: ${ms}ms`;
    el.style.display = "block";
  }
}

/** @param {{ phase: "sleeping" | "ended" | "armed"; targetUrl?: string; sleepMs?: number; reason?: string }} payload */
async function sendRedirectSleepFloat(tabId, payload) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: redirectSleepFloatPage,
      args: [payload],
      injectImmediately: true
    });
    return;
  } catch (_e1) {
    // injectImmediately 未対応・その他
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: redirectSleepFloatPage,
      args: [payload]
    });
    return;
  } catch (_e2) {
    // scripting 不可（制限 URL など）
  }
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "redirectSleepFloat",
      ...payload
    });
  } catch (_e3) {
    // コンテンツスクリプト未注入など
  }
}

function debuggee(tabId) {
  return { tabId };
}

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(debuggee(tabId), DEBUGGER_VERSION, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(debuggee(tabId), () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function sendDebuggerCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(debuggee(tabId), method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

/** リダイレクト後スリープ時間（ミリ秒）。0〜120000 */
function normalizeSleepMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(120000, Math.floor(parsed));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRedirectStatusCode(statusCode) {
  const code = Number(statusCode);
  return Number.isFinite(code) && code >= 300 && code < 400;
}

/** タブのトップレベル HTML のみ（iframe の sub_frame は対象外） */
function isTopLevelMainFrameDocument(resourceType) {
  return resourceType === "main_frame";
}

/**
 * POST → 3xx → 次の GET/POST（メイン文書）の「間」にだけスリープを挟む。
 * - main_frame 以外の 3xx（XHR 等）では開始しない（誤った Document を待たない）。
 * - method が取れる環境では POST のレスポンスが 3xx のときだけ開始する。
 */
function shouldBeginRedirectSleep(details) {
  if (!isTopLevelMainFrameDocument(details.type)) {
    return false;
  }
  if (details.method == null) {
    return true;
  }
  return String(details.method).toUpperCase() === "POST";
}

async function endRedirectSleepSession(tabId, reason = "normal") {
  const session = state.redirectSleepSessions.get(tabId);
  if (!session) {
    return;
  }
  clearTimeout(session.safetyTimerId);
  state.redirectSleepSessions.delete(tabId);
  if (reason !== "replaced") {
    await sendRedirectSleepFloat(tabId, { phase: "ended", reason });
  }
  try {
    await sendDebuggerCommand(tabId, "Fetch.disable");
  } catch (_error) {
    // Ignore disable failure; detach below may still succeed.
  }
  await detachDebugger(tabId).catch(() => {});
}

async function beginRedirectSleep(tabId, ms) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  const delayMs = normalizeSleepMs(ms);
  if (delayMs <= 0) {
    return;
  }
  await endRedirectSleepSession(tabId, "replaced");
  await attachDebugger(tabId);
  let mainFrameFrameId = null;
  try {
    await sendDebuggerCommand(tabId, "Page.enable");
    const frameTreeResult = await sendDebuggerCommand(tabId, "Page.getFrameTree", {});
    mainFrameFrameId = frameTreeResult?.frameTree?.frame?.id ?? null;
  } catch (_error) {
    mainFrameFrameId = null;
  }
  try {
    await sendDebuggerCommand(tabId, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });
  } catch (error) {
    await detachDebugger(tabId).catch(() => {});
    throw error;
  }

  const safetyTimerId = setTimeout(() => {
    endRedirectSleepSession(tabId, "timeout").catch(() => {});
  }, 15000);
  state.redirectSleepSessions.set(tabId, {
    ms: delayMs,
    safetyTimerId,
    mainFrameFrameId
  });
}

async function handleFetchRequestPaused(source, params) {
  const tabId = source.tabId;
  const sleepSession = state.redirectSleepSessions.get(tabId);
  if (!sleepSession) {
    return;
  }

  const resourceType = String(params.resourceType || "");
  if (resourceType !== "Document") {
    await sendDebuggerCommand(tabId, "Fetch.continueRequest", {
      requestId: params.requestId
    }).catch(() => {});
    return;
  }

  const frameId = params.frameId != null ? String(params.frameId) : null;
  const mainId = sleepSession.mainFrameFrameId != null ? String(sleepSession.mainFrameFrameId) : null;
  if (mainId != null && frameId != null && frameId !== mainId) {
    await sendDebuggerCommand(tabId, "Fetch.continueRequest", {
      requestId: params.requestId
    }).catch(() => {});
    return;
  }

  const targetUrl = String(params.request?.url || "");
  clearTimeout(sleepSession.safetyTimerId);
  await sendRedirectSleepFloat(tabId, {
    phase: "sleeping",
    targetUrl,
    sleepMs: sleepSession.ms
  });
  await sleep(sleepSession.ms);
  await sendDebuggerCommand(tabId, "Fetch.continueRequest", {
    requestId: params.requestId
  }).catch(() => {});
  await endRedirectSleepSession(tabId, "normal");
}

function registerExtensionListeners() {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method !== "Fetch.requestPaused") {
      return;
    }
    handleFetchRequestPaused(source, params).catch(() => {});
  });

  chrome.debugger.onDetach.addListener((source) => {
    const tabId = source.tabId;
    const sleepSession = state.redirectSleepSessions.get(tabId);
    if (sleepSession) {
      clearTimeout(sleepSession.safetyTimerId);
      state.redirectSleepSessions.delete(tabId);
      void sendRedirectSleepFloat(tabId, { phase: "ended", reason: "detach" }).catch(() => {});
    }
  });

  chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
      if (!Number.isInteger(details.tabId) || details.tabId < 0) {
        return;
      }
      if (!state.extensionEnabled) {
        return;
      }
      if (!isRedirectStatusCode(details.statusCode)) {
        return;
      }
      const ms = normalizeSleepMs(state.redirectSleepMs);
      if (ms > 0 && shouldBeginRedirectSleep(details)) {
        beginRedirectSleep(details.tabId, ms).catch(() => {});
      }
    },
    { urls: ["<all_urls>"] }
  );

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (!Number.isInteger(details.tabId) || details.tabId < 0) {
        return;
      }
      if (!state.extensionEnabled) {
        return;
      }
      if (details.tabId !== state.displayTabId) {
        return;
      }
      if (!isTopLevelMainFrameDocument(details.type)) {
        return;
      }
      const targetHeaderName = normalizeHeaderName(state.headerName);
      const matchedHeader = (details.responseHeaders || []).find(
        (item) => String(item.name || "").toLowerCase() === targetHeaderName.toLowerCase()
      );
      const nextValue = matchedHeader ? String(matchedHeader.value || "").trim() : "";
      state.latestHeaderValue = nextValue;
      updateHeaderDisplay(details.tabId, targetHeaderName, nextValue);
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
  );

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "setHeaderDisplayConfig") {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
      if (!Number.isInteger(tabId)) {
        sendResponse({ ok: false, error: "有効なタブが見つかりません。" });
        return true;
      }
      state.displayTabId = tabId;
      state.headerName = normalizeHeaderName(message.headerName);
      state.extensionEnabled = Boolean(message.extensionEnabled);
      state.redirectSleepMs = normalizeSleepMs(message.redirectSleepMs ?? state.redirectSleepMs);
      state.preWindowOpenSleepMs = normalizeSleepMs(
        message.preWindowOpenSleepMs ?? state.preWindowOpenSleepMs
      );
      updateHeaderDisplay(state.displayTabId, state.headerName, state.latestHeaderValue);
      persistHeaderDisplaySettings()
        .then(() => {
          sendResponse({
            ok: true,
            tabId: state.displayTabId,
            headerName: state.headerName,
            headerValue: state.latestHeaderValue,
            extensionEnabled: state.extensionEnabled,
            redirectSleepMs: state.redirectSleepMs,
            preWindowOpenSleepMs: state.preWindowOpenSleepMs
          });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: String(error) });
        });
      return true;
    }

    if (message?.type === "getHeaderDisplayConfig") {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
      if (Number.isInteger(tabId)) {
        state.displayTabId = tabId;
      }
      sendResponse({
        ok: true,
        tabId: state.displayTabId,
        headerName: state.headerName,
        headerValue: state.latestHeaderValue,
        extensionEnabled: state.extensionEnabled,
        redirectSleepMs: state.redirectSleepMs,
        preWindowOpenSleepMs: state.preWindowOpenSleepMs
      });
      return true;
    }

    if (message?.type === "setExtensionEnabled") {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
      if (Number.isInteger(tabId)) {
        state.displayTabId = tabId;
      }
      state.extensionEnabled = Boolean(message.extensionEnabled);
      updateHeaderDisplay(state.displayTabId, state.headerName, state.latestHeaderValue);
      persistHeaderDisplaySettings()
        .then(() => {
          sendResponse({
            ok: true,
            extensionEnabled: state.extensionEnabled
          });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: String(error) });
        });
      return true;
    }

    if (message?.type === "getWindowOpenPatchConfig") {
      const tabId = sender.tab?.id;
      sendResponse({
        ok: Number.isInteger(tabId),
        tabId,
        extensionEnabled: state.extensionEnabled,
        preWindowOpenSleepMs: state.preWindowOpenSleepMs
      });
      return true;
    }

    return false;
  });
}

chrome.storage.local
  .get(null)
  .then((all) => {
    state.headerName = normalizeHeaderName(all?.headerDisplayHeaderName ?? DEFAULT_HEADER_NAME);
    if (typeof all?.headerDisplayExtensionEnabled === "boolean") {
      state.extensionEnabled = all.headerDisplayExtensionEnabled;
    } else {
      const legacyFloat = all?.headerDisplayFloatEnabled !== false;
      const legacySleep = Boolean(
        all?.headerDisplayRedirectSleepEnabled ?? all?.headerDisplayRedirectAutoPause
      );
      state.extensionEnabled = legacyFloat || legacySleep;
    }
    if (Number.isFinite(all?.headerDisplayRedirectSleepMs)) {
      state.redirectSleepMs = normalizeSleepMs(all.headerDisplayRedirectSleepMs);
    } else {
      state.redirectSleepMs = 1000;
    }
    if (Number.isFinite(all?.headerDisplayPreWindowOpenSleepMs)) {
      state.preWindowOpenSleepMs = normalizeSleepMs(all.headerDisplayPreWindowOpenSleepMs);
    } else {
      state.preWindowOpenSleepMs = 0;
    }
    registerExtensionListeners();
  })
  .catch(() => {
    registerExtensionListeners();
  });
