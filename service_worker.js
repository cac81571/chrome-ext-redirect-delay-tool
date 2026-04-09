const DEBUGGER_VERSION = "1.3";

const state = {
  pausedTabs: new Map(),
  displayTabId: null,
  headerName: "server",
  latestHeaderValue: "",
  floatEnabled: true,
  redirectAutoPauseEnabled: false
};

function getQueuedRequestsForUi(queue) {
  return (queue || []).slice(0, 100).map((item) => ({
    url: item.url,
    method: item.method
  }));
}

function notifyStateToTab(tabId) {
  if (!Number.isInteger(tabId)) {
    return;
  }
  const session = state.pausedTabs.get(tabId);
  const isPaused = Boolean(session);
  const queue = session?.queue || [];
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "stateUpdated",
      isPaused,
      queueLength: queue.length,
      queuedRequests: getQueuedRequestsForUi(queue),
      tabId,
      allowPassCount: session?.allowPassCount || 0,
      passedCount: session?.passedCount || 0
    },
    () => {
      // Ignore send errors if content script is unavailable.
      void chrome.runtime.lastError;
    }
  );
}

function getOrCreateSession(tabId, allowPassCount = 0) {
  let session = state.pausedTabs.get(tabId);
  if (!session) {
    session = {
      queue: [],
      allowPassCount,
      passedCount: 0
    };
    state.pausedTabs.set(tabId, session);
  }
  return session;
}

function normalizeHeaderName(value) {
  const headerName = String(value || "").trim();
  return headerName || "server";
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
      floatEnabled: state.floatEnabled
    },
    () => {
      // Ignore send errors if content script is unavailable.
      void chrome.runtime.lastError;
    }
  );
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

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function isRedirectStatusCode(statusCode) {
  const code = Number(statusCode);
  return Number.isFinite(code) && code >= 300 && code < 400;
}

async function pauseRequests(tabId, allowPassCount) {
  if (!Number.isInteger(tabId)) {
    throw new Error("有効なタブが見つかりません。");
  }

  if (state.pausedTabs.has(tabId)) {
    return;
  }

  await attachDebugger(tabId);
  try {
    await sendDebuggerCommand(tabId, "Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }]
    });
  } catch (error) {
    await detachDebugger(tabId).catch(() => {});
    throw error;
  }

  getOrCreateSession(tabId, normalizeCount(allowPassCount));
  notifyStateToTab(tabId);
}

async function resumeSingleTab(tabId) {
  const session = state.pausedTabs.get(tabId);
  if (!session) {
    return;
  }
  const queuedRequestIds = session.queue.map((item) => item.requestId);

  for (const requestId of queuedRequestIds) {
    try {
      await sendDebuggerCommand(tabId, "Fetch.continueRequest", { requestId });
    } catch (_error) {
      // Ignore requests that are already closed/canceled.
    }
  }

  try {
    await sendDebuggerCommand(tabId, "Fetch.disable");
  } catch (_error) {
    // Ignore disable failure; detach below may still succeed.
  }

  await detachDebugger(tabId).catch(() => {});
  state.pausedTabs.delete(tabId);
  notifyStateToTab(tabId);
}

async function resumeRequests(tabId) {
  if (Number.isInteger(tabId)) {
    await resumeSingleTab(tabId);
    return;
  }
  const tabIds = [...state.pausedTabs.keys()];
  for (const pausedTabId of tabIds) {
    await resumeSingleTab(pausedTabId);
  }
}

async function handleFetchRequestPaused(source, params) {
  const tabId = source.tabId;
  const session = state.pausedTabs.get(tabId);
  if (!session) {
    return;
  }

  const requestUrl = params.request?.url || "";

  if (session.passedCount < session.allowPassCount) {
    session.passedCount += 1;
    await sendDebuggerCommand(tabId, "Fetch.continueRequest", {
      requestId: params.requestId
    }).catch(() => {});
    notifyStateToTab(tabId);
    return;
  }

  session.queue.push({
    requestId: params.requestId,
    url: requestUrl,
    method: params.request?.method || ""
  });
  notifyStateToTab(tabId);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== "Fetch.requestPaused") {
    return;
  }
  handleFetchRequestPaused(source, params).catch(() => {});
});

chrome.debugger.onDetach.addListener((source) => {
  if (!state.pausedTabs.has(source.tabId)) {
    return;
  }
  state.pausedTabs.delete(source.tabId);
  notifyStateToTab(source.tabId);
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!Number.isInteger(details.tabId) || details.tabId < 0) {
      return;
    }
    if (state.redirectAutoPauseEnabled && isRedirectStatusCode(details.statusCode)) {
      pauseRequests(details.tabId, 0).catch(() => {});
    }
    if (details.tabId !== state.displayTabId) {
      return;
    }
    if (!state.floatEnabled) {
      return;
    }
    const targetHeaderName = normalizeHeaderName(state.headerName);
    const matchedHeader = (details.responseHeaders || []).find(
      (item) => String(item.name || "").toLowerCase() === targetHeaderName.toLowerCase()
    );
    if (!matchedHeader) {
      return;
    }
    const nextValue = String(matchedHeader.value || "").trim();
    if (!nextValue || nextValue === state.latestHeaderValue) {
      return;
    }
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
    state.floatEnabled = Boolean(message.floatEnabled);
    state.redirectAutoPauseEnabled = Boolean(message.redirectAutoPauseEnabled);
    updateHeaderDisplay(state.displayTabId, state.headerName, state.latestHeaderValue);
    sendResponse({
      ok: true,
      tabId: state.displayTabId,
      headerName: state.headerName,
      headerValue: state.latestHeaderValue,
      floatEnabled: state.floatEnabled,
      redirectAutoPauseEnabled: state.redirectAutoPauseEnabled
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
      floatEnabled: state.floatEnabled,
      redirectAutoPauseEnabled: state.redirectAutoPauseEnabled
    });
    return true;
  }

  if (message?.type === "setPaused") {
    const isPaused = Boolean(message.isPaused);
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    const allowPassCount = normalizeCount(message.allowPassCount);

    const task = isPaused ? pauseRequests(tabId, allowPassCount) : resumeRequests(tabId);
    task
      .then(() => {
        const session = Number.isInteger(tabId) ? state.pausedTabs.get(tabId) : null;
        sendResponse({
          ok: true,
          isPaused: Boolean(session),
          queueLength: session?.queue.length || 0,
          queuedRequests: getQueuedRequestsForUi(session?.queue || []),
          tabId: Number.isInteger(tabId) ? tabId : null,
          allowPassCount: session?.allowPassCount || 0,
          passedCount: session?.passedCount || 0
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "getPaused") {
    const senderTabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    const session = Number.isInteger(senderTabId) ? state.pausedTabs.get(senderTabId) : null;
    sendResponse({
      ok: true,
      isPaused: Boolean(session),
      queueLength: session?.queue.length || 0,
      queuedRequests: getQueuedRequestsForUi(session?.queue || []),
      tabId: Number.isInteger(senderTabId) ? senderTabId : null,
      allowPassCount: session?.allowPassCount || 0,
      passedCount: session?.passedCount || 0
    });
    return true;
  }

  return false;
});
