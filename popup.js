const pauseButton = document.getElementById("pause");
const resumeButton = document.getElementById("resume");
const allowCountInput = document.getElementById("allowCount");
const enableHeaderFloatInput = document.getElementById("enableHeaderFloat");
const targetHeaderNameInput = document.getElementById("targetHeaderName");
const enableRedirectDelayInput = document.getElementById("enableRedirectDelay");
const statusElement = document.getElementById("status");
const blockedListElement = document.getElementById("blockedList");

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#c00" : "#333";
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unknown error"));
        return;
      }
      resolve(response);
    });
  });
}

function getActiveTabId() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const activeTabId = tabs?.[0]?.id;
      if (!Number.isInteger(activeTabId)) {
        reject(new Error("アクティブタブが取得できません。"));
        return;
      }
      resolve(activeTabId);
    });
  });
}

function updateButtonState(isPaused) {
  pauseButton.disabled = isPaused;
  resumeButton.disabled = !isPaused;
  allowCountInput.disabled = isPaused;
}

function getAllowCount() {
  const value = Number(allowCountInput.value);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function getTargetHeaderName() {
  return String(targetHeaderNameInput.value || "").trim();
}

async function syncHeaderDisplayConfig(tabId) {
  const response = await sendMessage({
    type: "setHeaderDisplayConfig",
    tabId,
    headerName: getTargetHeaderName(),
    floatEnabled: Boolean(enableHeaderFloatInput.checked),
    redirectAutoPauseEnabled: Boolean(enableRedirectDelayInput.checked)
  });
  targetHeaderNameInput.value = response.headerName || "";
  enableHeaderFloatInput.checked = Boolean(response.floatEnabled);
  targetHeaderNameInput.disabled = !enableHeaderFloatInput.checked;
  enableRedirectDelayInput.checked = Boolean(response.redirectAutoPauseEnabled);
  return response;
}

function renderBlockedList(queuedRequests) {
  blockedListElement.textContent = "";
  if (!Array.isArray(queuedRequests) || queuedRequests.length === 0) {
    blockedListElement.textContent = "ブロック中のURLはありません";
    return;
  }

  queuedRequests.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "blocked-item";
    row.textContent = `${index + 1}. [${item.method || "GET"}] ${item.url || ""}`;
    blockedListElement.appendChild(row);
  });
}

async function loadCurrentState() {
  try {
    const tabId = await getActiveTabId();
    const headerConfig = await sendMessage({
      type: "getHeaderDisplayConfig",
      tabId
    });
    if (document.activeElement !== targetHeaderNameInput) {
      targetHeaderNameInput.value = headerConfig.headerName || "server";
    }
    enableHeaderFloatInput.checked = Boolean(headerConfig.floatEnabled);
    targetHeaderNameInput.disabled = !enableHeaderFloatInput.checked;
    enableRedirectDelayInput.checked = Boolean(headerConfig.redirectAutoPauseEnabled);

    const response = await sendMessage({ type: "getPaused", tabId });
    updateButtonState(response.isPaused);
    if (response.isPaused) {
      allowCountInput.value = String(response.allowPassCount || 1);
    }
    renderBlockedList(response.queuedRequests || []);
    if (response.isPaused) {
      showStatus(
        `現在: 一時停止中 (通過 ${response.passedCount}/${response.allowPassCount}件, キュー: ${response.queueLength}件)`
      );
    } else {
      showStatus("現在: 稼働中");
    }
  } catch (error) {
    showStatus(`読み込み失敗: ${error.message}`, true);
  }
}

pauseButton.addEventListener("click", async () => {
  try {
    const tabId = await getActiveTabId();
    const allowPassCount = getAllowCount();
    await syncHeaderDisplayConfig(tabId);
    const response = await sendMessage({
      type: "setPaused",
      isPaused: true,
      tabId,
      allowPassCount
    });
    updateButtonState(true);
    renderBlockedList(response.queuedRequests || []);
    showStatus(
      `最初の ${response.allowPassCount} 件を通過し、その後はキューに保存します。`
    );
  } catch (error) {
    showStatus(`一時停止失敗: ${error.message}`, true);
  }
});

resumeButton.addEventListener("click", async () => {
  try {
    const tabId = await getActiveTabId();
    await syncHeaderDisplayConfig(tabId);
    const response = await sendMessage({ type: "setPaused", isPaused: false, tabId });
    updateButtonState(false);
    renderBlockedList(response.queuedRequests || []);
    showStatus("キュー済みリクエストを再開しました。");
  } catch (error) {
    showStatus(`再開失敗: ${error.message}`, true);
  }
});

targetHeaderNameInput.addEventListener("change", async () => {
  try {
    const tabId = await getActiveTabId();
    await syncHeaderDisplayConfig(tabId);
    showStatus("ヘッダ表示設定を更新しました。");
  } catch (error) {
    showStatus(`ヘッダ設定更新失敗: ${error.message}`, true);
  }
});

enableHeaderFloatInput.addEventListener("change", async () => {
  try {
    const tabId = await getActiveTabId();
    await syncHeaderDisplayConfig(tabId);
  } catch (error) {
    showStatus(`フロート設定更新失敗: ${error.message}`, true);
  }
});

enableRedirectDelayInput.addEventListener("change", async () => {
  try {
    const tabId = await getActiveTabId();
    await syncHeaderDisplayConfig(tabId);
  } catch (error) {
    showStatus(`遅延設定更新失敗: ${error.message}`, true);
  }
});

loadCurrentState();
setInterval(loadCurrentState, 1000);
