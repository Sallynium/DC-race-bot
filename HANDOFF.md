# 🤝 開發交接文件（HANDOFF）

> 給下一位接手者（或下一個 AI 對話）的脈絡摘要。貼到新對話開頭即可快速接續。
> 最後更新：2026-06-29

---

## 📌 專案 / 任務背景

Discord 賽事預測競賽機器人，`discord.js v14` + `Mongoose` + `MongoDB`，部署於 **Zeabur**。

- GitHub：https://github.com/Sallynium/DC-race-bot
- 預設分支：`main`（MongoDB 版，正式部署）
- 封存分支：`replit`（單機 JSON 版，原型）
- 主檔：[`index.js`](index.js)（單一檔案，約 820 行）

---

## ✅ 已完成的事

### 遷移與重構（M1–M3）
- 原始 Replit 版（JSON 儲存）保存在 `replit` 分支。
- `main` 分支：完整遷移至 MongoDB + Mongoose。
- 所有寫入改為 on-demand 讀寫，移除全域 `data` 變數。
- `doc.save()` 全面改為 `$set` / `$unset` 原子操作。
- 分數累加 / 扣減（`result` / `undoresult` / `addscore` / `subscore`）改用 `$inc`，消除讀-改-寫競態。
- `register` 驗證 `matchId` 不可含 `.`（防 dot-notation 注入）。
- `result` / `undoresult` 計分迴圈加 `typeof team === "string"` 防呆。

### 第二輪 code review 修正（M4，本次）
- **`result` / `undoresult` 結算守衛原子化**：把「是否已結算」條件放進 `updateOne` 的 query，以 `matchedCount` 判斷是否搶到，**修掉並發重複加 / 扣分的 TOCTOU**。
  - `result`：query 加 `'match_history.<id>': { $exists: false }`
  - `undoresult`：query 加 `'match_history.<id>': winner`
- **`history`**：計票迴圈加 `typeof team !== "string"` 守衛，避免異常資料 crash。
- **`follow` 改 fail-closed**：排除已結算 / 無排程 / 無效日期 / 已截止場次；排程異常時 `console.warn`，正常截止不記 log。
- **`register` 嚴格日期驗證**：正則 + 台北時區 ISO 回比對，擋掉 `2/30` 之類被 V8 自動進位的非法日期。
- **`leaderboard`**：改用 `Promise.all` 並發抓使用者名稱，避免人多逾時。
- **`addscore` / `subscore`**：移除未使用的 `getServerData` 查詢，改 `updateOne(..., { upsert: true })` 保留「文件不存在也會建立」的保證。

### 維運
- GitHub 預設分支已從 `replit` 改為 `main`。
- 上述修正皆已 commit 並 push 到 `main`，且通過 `node --check` 語法檢查。

---

## 🔧 已知但尚未處理的事項

- **無自動化測試**：目前僅 `node --check`，邏輯正確性靠人工驗證。建議下次部署前手動測 `/result → /undoresult → /result` 流程。
- **`instanceof Map` 死分支**：點號路徑寫入的資料一律是 plain object，`doc.predictions.get()` 取回也非 Map，多處 `instanceof Map ? ... : ...` 的前半永遠走不到。功能正確，純屬可清理的死碼（`result`、`undoresult`、`history`、`mypredictions`、`follow`）。
- **Map 遍歷風格不統一**：`follow` 等用 `for (const [matchId] of map)` 解構，與其他迴圈一致但非最直白；若要統一成 `.keys()` 建議全檔一起改，另開純風格 commit。
- **`getServerData` 首次併發**：同一 guild 從未建立文件時，兩個併發指令可能撞 unique key（被 try/catch 吸收）。僅影響首次互動，低風險。
- **斜線指令全域註冊**：定義變更後生效需時（最多約 1 小時）。

---

## 📁 重要檔案

| 檔案 | 說明 |
|------|------|
| [`index.js`](index.js) | 單一主檔，所有邏輯 |
| [`package.json`](package.json) | 相依：`discord.js`、`express`、`mongoose` |
| [`README.md`](README.md) | 安裝 / 指令 / 部署 / 設計說明 |
| [`專案計畫書.md`](專案計畫書.md) | 目標、範圍、里程碑、風險 |
| `.gitignore` | 排除 `node_modules/`、`predictions_data.json`、`.env` |

---

## 🧠 關鍵決策 / 重要結論

- Schema：`predictions` 型別為 `Map of Mixed`，配合點號路徑 `$set` 寫入；讀取時值為 plain object。
- 所有分數累加 / 扣減用 `$inc`，不讀舊值。
- `result` / `undoresult` 用展開運算子條件合併 `$set` / `$unset` 與 `$inc`（`incOps` 為空時不帶 `$inc`）。
- 結算「是否已發生」的唯一真實來源是 `match_history` 是否含該 `matchId`。
- 時間一律存 ISO（UTC），顯示與輸入皆以 `Asia/Taipei` 處理。

---

## ⚠️ 環境變數（Zeabur）

| 變數 | 用途 |
|------|------|
| `TOKEN` | Discord Bot Token |
| `CLIENT_ID` | Discord Application ID（註冊斜線指令用） |
| `MONGO_URI` | MongoDB 連線字串（缺少時程式直接退出） |
| `PORT` | （選用）Express 埠，預設 3000 |

---

## 💬 協作偏好

- 以**繁體中文**溝通。
- 回應**簡潔**。
- 動 git（commit / merge / push）前先確認；本機修改完成後會先 `node --check`。

---

_此文件隨開發進度更新，接手前請先確認以上資訊是否仍為最新。_
