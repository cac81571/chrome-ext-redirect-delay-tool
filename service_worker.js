const DEBUGGER_VERSION = "1.3";

const state = {
  isPaused: false,
  tabId: null,
  queue: [],
  allowPassCount: 1,
  passedCount: 0
};

function getQueuedRequestsForUi() {
  return state.queue.slice(0, 100).map((item) => ({
    url: item.url,
    method: item.method
  }));
}

function notifyStateToActiveTab() {
  if (!Number.isInteger(state.tabId)) {
    return;
  }
  chrome.tabs.sendMessage(
    state.tabId,
    {
      type: "stateUpdated",
      isPaused: state.isPaused,
      queueLength: state.queue.length,
      queuedRequests: getQueuedRequestsForUi(),
      tabId: state.tabId,
      allowPassCount: state.allowPassCount,
      passedCount: state.passedCount
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

async function pauseRequests(tabId, allowPassCount) {
  if (!Number.isInteger(tabId)) {
    throw new Error("有効なタブが見つかりません。");
  }

  if (state.isPaused && state.tabId === tabId) {
    return;
  }

  if (state.isPaused && state.tabId !== null) {
    await resumeRequests();
  }

  await attachDebugger(tabId);
  try {
    await sendDebuggerCommand(tabId, "Fetch.enable", {
      patterns: [{ urlPattern: "*" }]
    });
  } catch (error) {
    await detachDebugger(tabId).catch(() => {});
    throw error;
  }

  state.isPaused = true;
  state.tabId = tabId;
  state.queue = [];
  state.allowPassCount = normalizeCount(allowPassCount);
  state.passedCount = 0;
  notifyStateToActiveTab();
}

async function resumeRequests() {
  if (!state.isPaused || state.tabId === null) {
    state.isPaused = false;
    state.tabId = null;
    state.queue = [];
    state.passedCount = 0;
    return;
  }

  const tabId = state.tabId;
  const queuedRequestIds = state.queue.map((item) => item.requestId);

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
  state.isPaused = false;
  state.tabId = null;
  state.queue = [];
  state.passedCount = 0;
  notifyStateToActiveTab();
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!state.isPaused || source.tabId !== state.tabId) {
    return;
  }
  if (method !== "Fetch.requestPaused") {
    return;
  }

  if (state.passedCount < state.allowPassCount) {
    state.passedCount += 1;
    sendDebuggerCommand(state.tabId, "Fetch.continueRequest", {
      requestId: params.requestId
    }).catch(() => {});
    notifyStateToActiveTab();
    return;
  }

  state.queue.push({
    requestId: params.requestId,
    url: params.request?.url || "",
    method: params.request?.method || ""
  });
  notifyStateToActiveTab();
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== state.tabId) {
    return;
  }
  state.isPaused = false;
  state.tabId = null;
  state.queue = [];
  state.passedCount = 0;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "setPaused") {
    const isPaused = Boolean(message.isPaused);
    const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    const allowPassCount = normalizeCount(message.allowPassCount);

    const task = isPaused ? pauseRequests(tabId, allowPassCount) : resumeRequests();
    task
      .then(() => {
        sendResponse({
          ok: true,
          isPaused: state.isPaused,
          queueLength: state.queue.length,
          queuedRequests: getQueuedRequestsForUi(),
          tabId: state.tabId,
          allowPassCount: state.allowPassCount,
          passedCount: state.passedCount
        });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "getPaused") {
    const senderTabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
    const isPausedForSender = state.isPaused && senderTabId === state.tabId;
    sendResponse({
      ok: true,
      isPaused: isPausedForSender,
      queueLength: isPausedForSender ? state.queue.length : 0,
      queuedRequests: isPausedForSender ? getQueuedRequestsForUi() : [],
      tabId: state.tabId,
      allowPassCount: state.allowPassCount,
      passedCount: state.passedCount
    });
    return true;
  }

  return false;
});
