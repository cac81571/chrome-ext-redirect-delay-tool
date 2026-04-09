# Request Breaker (Chrome Extension)

Chrome Manifest V3 で、全リクエストを一時停止/再開する拡張です。

## 使い方

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択
4. 拡張アイコンをクリック
5. 「一時停止」を押すと全通信をブロック
6. 「再開」を押すとブロック解除

## 補足

- この拡張は `declarativeNetRequest` の動的ルールで全URLをブロックします。
- 設定状態は `storage.local` に保存されるため、再起動後も状態を復元します。
