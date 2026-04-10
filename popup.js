const extensionSwitch = document.getElementById("extensionSwitch");
const targetHeaderNameInput = document.getElementById("targetHeaderName");
const redirectSleepMsInput = document.getElementById("redirectSleepMs");
const preWindowOpenSleepMsInput = document.getElementById("preWindowOpenSleepMs");
const saveButton = document.getElementById("saveButton");
const saveStatusElement = document.getElementById("saveStatus");

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

function getTargetHeaderName() {
  return String(targetHeaderNameInput.value || "").trim();
}

function getRedirectSleepMs() {
  const value = Number(redirectSleepMsInput.value);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(120000, Math.floor(value));
}

function getPreWindowOpenSleepMs() {
  const value = Number(preWindowOpenSleepMsInput.value);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(120000, Math.floor(value));
}

function setSaveStatus(message, isError = false) {
  saveStatusElement.textContent = message;
  saveStatusElement.classList.toggle("is-error", isError);
}

function isExtensionOn() {
  return extensionSwitch.classList.contains("is-on");
}

function setExtensionSwitch(on) {
  extensionSwitch.classList.toggle("is-on", on);
  extensionSwitch.setAttribute("aria-checked", on ? "true" : "false");
}

function applyConfigToForm(response) {
  setExtensionSwitch(Boolean(response.extensionEnabled));
  targetHeaderNameInput.value = response.headerName || "";
  redirectSleepMsInput.value = String(
    Number.isFinite(response.redirectSleepMs) ? response.redirectSleepMs : 1000
  );
  preWindowOpenSleepMsInput.value = String(
    Number.isFinite(response.preWindowOpenSleepMs) ? response.preWindowOpenSleepMs : 0
  );
}

async function saveSettings() {
  const tabId = await getActiveTabId();
  const response = await sendMessage({
    type: "setHeaderDisplayConfig",
    tabId,
    headerName: getTargetHeaderName(),
    extensionEnabled: isExtensionOn(),
    redirectSleepMs: getRedirectSleepMs(),
    preWindowOpenSleepMs: getPreWindowOpenSleepMs()
  });
  applyConfigToForm(response);
  setSaveStatus("保存しました。", false);
}

async function loadCurrentState() {
  try {
    const tabId = await getActiveTabId();
    const headerConfig = await sendMessage({
      type: "getHeaderDisplayConfig",
      tabId
    });
    if (document.activeElement !== targetHeaderNameInput) {
      targetHeaderNameInput.value = headerConfig.headerName || "X-App-Node";
    }
    setExtensionSwitch(Boolean(headerConfig.extensionEnabled));
    redirectSleepMsInput.value = String(
      Number.isFinite(headerConfig.redirectSleepMs) ? headerConfig.redirectSleepMs : 1000
    );
    preWindowOpenSleepMsInput.value = String(
      Number.isFinite(headerConfig.preWindowOpenSleepMs) ? headerConfig.preWindowOpenSleepMs : 0
    );
    setSaveStatus("", false);
  } catch (error) {
    setSaveStatus(`読み込みできません: ${error.message}`, true);
  }
}

extensionSwitch.addEventListener("click", async () => {
  const previous = isExtensionOn();
  setExtensionSwitch(!previous);
  try {
    const tabId = await getActiveTabId();
    await sendMessage({
      type: "setExtensionEnabled",
      tabId,
      extensionEnabled: isExtensionOn()
    });
    setSaveStatus("", false);
  } catch (error) {
    setExtensionSwitch(previous);
    setSaveStatus(`拡張の反映に失敗しました: ${error.message}`, true);
  }
});

saveButton.addEventListener("click", async () => {
  saveButton.disabled = true;
  setSaveStatus("保存中…", false);
  try {
    await saveSettings();
  } catch (error) {
    setSaveStatus(`保存に失敗しました: ${error.message}`, true);
  } finally {
    saveButton.disabled = false;
  }
});

loadCurrentState();
