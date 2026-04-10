/**
 * document_start: window.open をページのメイン世界でラップする。
 * window.open は同期的に Window を返すため、待機はビジー待ち（メインスレッドをブロック）になる。
 */
function applyWindowOpenDelay(ms) {
  const delay = Math.min(120000, Math.max(0, Math.floor(Number(ms)) || 0));
  if (window.__redirectDelayOrigOpen) {
    window.open = window.__redirectDelayOrigOpen;
    delete window.__redirectDelayOrigOpen;
  }
  if (delay <= 0) {
    return;
  }
  const orig = window.open;
  window.__redirectDelayOrigOpen = orig;
  window.open = function () {
    const until = Date.now() + delay;
    while (Date.now() < until) {}
    return orig.apply(window, arguments);
  };
}

function tryInjectWindowOpenPatch() {
  chrome.runtime.sendMessage({ type: "getWindowOpenPatchConfig" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok || !Number.isInteger(response.tabId)) {
      return;
    }
    const ms =
      response.extensionEnabled && response.preWindowOpenSleepMs > 0
        ? response.preWindowOpenSleepMs
        : 0;
    chrome.scripting
      .executeScript({
        target: { tabId: response.tabId },
        world: "MAIN",
        func: applyWindowOpenDelay,
        args: [ms]
      })
      .catch(() => {});
  });
}

tryInjectWindowOpenPatch();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (!changes.headerDisplayPreWindowOpenSleepMs && !changes.headerDisplayExtensionEnabled) {
    return;
  }
  tryInjectWindowOpenPatch();
});
