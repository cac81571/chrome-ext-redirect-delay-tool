/**
 * document_start: サービスワーカーに依頼して window.open を MAIN world でラップする。
 * コンテンツスクリプトから chrome.scripting を呼ぶと環境によって失敗するため、注入は SW が行う。
 */
function tryInjectWindowOpenPatch() {
  chrome.runtime.sendMessage({ type: "applyWindowOpenPatch" }, () => {
    void chrome.runtime.lastError;
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
