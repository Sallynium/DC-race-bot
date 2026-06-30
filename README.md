# 🏁 DC-Race-Bot（MongoDB 版）

Discord 賽事預測競賽機器人。玩家用斜線指令預測比賽勝隊，管理員登錄比賽與結果，系統自動計分並產生排行榜。

> 本分支（`main`）為正式部署版本，資料儲存於 **MongoDB**，部署於 **Zeabur**。
> 舊版（單機 JSON 儲存、Replit 部署）保留在 [`replit`](https://github.com/Sallynium/DC-race-bot/tree/replit) 分支，詳見該分支的 README。

---

## 📑 目錄

- [功能總覽](#-功能總覽)
- [技術架構](#-技術架構)
- [資料模型](#-資料模型)
- [指令列表](#-指令列表)
- [環境變數](#-環境變數)
- [本機開發](#-本機開發)
- [部署（Zeabur）](#-部署zeabur)
- [關鍵設計決策](#-關鍵設計決策)
- [已知限制](#-已知限制)
- [分支說明](#-分支說明)

---

## ✨ 功能總覽

- **比賽預測**：玩家對「已登錄、未開賽」的比賽預測勝隊，開賽後鎖定無法再改。
- **自動計分**：管理員登錄結果後，預測正確者自動依該場分數加分。
- **結果回溯**：`/undoresult` 可撤銷結算（扣回分數），修正後重新 `/result`。
- **跟單**：`/follow` 一鍵複製其他玩家在所有「未截止」比賽的預測。
- **排行榜 / 個人積分 / 預測統計**：多種查詢指令。
- **管理工具**：手動加減分、代客預測、刪除比賽、全資料重置。
- **彩蛋**：`/食物輪盤` 隨機抽今天吃什麼（200+ 道台/港式美食）。

---

## 🛠 技術架構

| 項目 | 內容 |
|------|------|
| 執行環境 | Node.js |
| Discord 函式庫 | [discord.js](https://discord.js.org/) `^14.16.3` |
| 資料庫 | MongoDB（透過 [Mongoose](https://mongoosejs.com/) `^8.4.0`） |
| 保活 Web 伺服器 | [Express](https://expressjs.com/) `^4.18.2`（提供 `GET /` 健康檢查端點） |
| 部署平台 | Zeabur |
| 互動模型 | 全程使用 Slash Command + Autocomplete，無訊息內容權限需求 |

**單檔架構**：所有邏輯集中在 [`index.js`](index.js)，啟動流程為
`連線 MongoDB → 啟動 Express → 登入 Discord → ready 時註冊斜線指令`。

```
┌─────────────┐   Slash Command    ┌──────────────┐   Mongoose 原子操作   ┌──────────┐
│  Discord     │ ─────────────────▶ │   index.js    │ ───────────────────▶ │ MongoDB   │
│  使用者       │ ◀───────────────── │ (Bot Client)  │ ◀─────────────────── │ GuildData │
└─────────────┘     回覆 / Embed     └──────────────┘                       └──────────┘
                                            │
                                            ▼  GET /
                                     ┌──────────────┐
                                     │ Express 保活  │
                                     └──────────────┘
```

---

## 🗄 資料模型

單一 Collection `GuildData`，**以 Discord 伺服器（guild）為單位**，每個 guild 一份文件：

```js
const guildSchema = new mongoose.Schema({
  guildId:         { type: String, required: true, unique: true },
  predictions:     { type: Map, of: Schema.Types.Mixed,  default: () => new Map() }, // matchId -> { userId: teamName }
  scores:          { type: Map, of: Number, default: () => new Map() },              // userId  -> 累計分數
  match_history:   { type: Map, of: String, default: () => new Map() },              // matchId -> 勝隊（存在=已結算）
  match_schedules: { type: Map, of: String, default: () => new Map() },              // matchId -> 開賽 ISO 時間字串
  match_teams:     { type: Map, of: [String], default: () => new Map() },            // matchId -> [隊伍A, 隊伍B]
  match_points:    { type: Map, of: Number, default: () => new Map() },              // matchId -> 預測正確得分
});
```

**設計重點**：
- `predictions` 採巢狀結構 `matchId → userId → teamName`，透過 MongoDB 點號路徑（dot-notation）做精準原子寫入，例如 `predictions.R1.123456789`。
- `match_history` 是否含有某 `matchId` 即代表該場「是否已結算」，作為結算守衛的唯一真實來源。
- 所有時間以 **ISO 字串（UTC）** 儲存，顯示時再轉台北時區（`Asia/Taipei`）。

---

## 🎮 指令列表

### 👥 一般使用者

| 指令 | 說明 |
|------|------|
| `/predict 比賽id 隊伍` | 預測比賽勝隊（僅限未開賽，支援自動完成） |
| `/myscore` | 查看自己目前總積分 |
| `/mypredictions` | 查看自己所有預測紀錄 |
| `/matches` | 查看所有比賽（依可預測／進行中／已結算分類） |
| `/history 比賽id` | 查看某場比賽的預測票數統計 |
| `/leaderboard` | 查看積分排行榜 |
| `/follow 使用者` | 跟單某玩家在所有未截止比賽的預測 |
| `/help` | 顯示指令說明 |
| `/食物輪盤` | 🎰 隨機抽今天吃什麼 |

### 🔧 管理員（需 Administrator 權限）

| 指令 | 說明 |
|------|------|
| `/register 比賽id 隊伍a 隊伍b 日期 時間 [分數] [強制覆蓋]` | 登錄新比賽（日期 `YYYY-MM-DD`、時間 `HH:MM`，台北時間） |
| `/result 比賽id 勝隊` | 登錄結果並自動計分 |
| `/undoresult 比賽id` | 回溯結果並扣回分數 |
| `/addscore 使用者 分數` | 手動加分 |
| `/subscore 使用者 分數` | 手動扣分 |
| `/forcepredict 使用者 比賽id 隊伍` | 代替玩家預測（不受開賽時間限制） |
| `/delete 比賽id` | 刪除比賽及所有相關資料 |
| `/resetall 確認` | ⚠️ 清空該伺服器所有資料（需二次確認） |

---

## 🔐 環境變數

部署前需設定以下環境變數（Zeabur → 服務 → Variables）：

| 變數 | 說明 |
|------|------|
| `TOKEN` | Discord Bot Token |
| `CLIENT_ID` | Discord 應用程式（Application）ID，用於註冊斜線指令 |
| `MONGO_URI` | MongoDB 連線字串（例如 `mongodb+srv://...`） |
| `PORT` | （選用）Express 監聽埠，預設 `3000`，Zeabur 通常自動注入 |

> 缺少 `MONGO_URI` 時程式會直接以錯誤碼退出，避免在沒有資料庫的情況下啟動。

---

## 💻 本機開發

```bash
# 1. 安裝相依套件
npm install

# 2. 設定環境變數（建議用 .env，已被 .gitignore 排除）
#    TOKEN=...
#    CLIENT_ID=...
#    MONGO_URI=mongodb://localhost:27017/dc-race-bot

# 3. 啟動（需先確保本機或雲端 MongoDB 可連線）
npm start
```

> 本專案目前未引入 `dotenv`，本機若要用 `.env` 需自行載入，或直接以系統環境變數提供。
> 啟動後可開 `http://localhost:3000/` 看到保活訊息確認 Web 伺服器正常。

---

## 🚀 部署（Zeabur）

1. 將 GitHub repo 連結至 Zeabur，選擇 `main` 分支。
2. Zeabur 偵測為 Node.js 專案，使用 `npm start`（即 `node index.js`）。
3. 在 Variables 設定 `TOKEN`、`CLIENT_ID`、`MONGO_URI`。
4. 部署完成後，Bot 上線會自動向 Discord 全域註冊斜線指令（首次最多需數分鐘生效）。
5. `GET /` 端點可作為健康檢查／保活用途。

---

## 🧠 關鍵設計決策

這些決策是本版本相較 `replit` 舊版最核心的演進，目的在於**正確處理併發**：

1. **On-demand 讀寫，無全域狀態**
   每個指令進來才查 / 寫資料庫，不在記憶體保留全域 `data`，避免多實例或重啟造成資料不一致。

2. **點號路徑 `$set` / `$unset` 原子寫入**
   不再 `doc.save()` 整份回寫，改用 `updateOne({...}, { $set: { 'predictions.R1.userId': team } })`，只動到目標欄位，避免併發互相覆蓋。

3. **分數一律用 `$inc`，不讀舊值**
   加減分（`result` / `undoresult` / `addscore` / `subscore`）全部用 `$inc`，消除「讀-改-寫」的競態。

4. **結算守衛原子化（TOCTOU 防護）**
   `result` / `undoresult` 把「是否已結算」的條件放進 query：
   - `result`：`{ guildId, 'match_history.R1': { $exists: false } }`
   - `undoresult`：`{ guildId, 'match_history.R1': winner }`

   再以 `matchedCount` 判斷是否真的搶到，避免兩個指令並發時重複加 / 扣分。

5. **輸入驗證**
   - `matchId` 不可含 `.`，防止 dot-notation 注入。
   - `register` 嚴格驗證日期（正則 + ISO 回比對），擋掉 `2/30` 之類被 V8 自動進位的非法日期。
   - 計分迴圈加 `typeof team === "string"` 守衛，避免異常資料造成 crash。

6. **`follow` fail-closed**
   排程缺失、損毀、已結算、已截止的場次一律跳過；排程「異常」（缺失／無效）時額外 `console.warn` 方便除錯，正常截止則不記 log 以免洗版。

---

## ⚠️ 已知限制

- **斜線指令為全域註冊**，首次部署或更新指令定義後，Discord 端最多需數分鐘到一小時生效。
- **`leaderboard` 名稱抓取依賴 Discord API**：已改用 `Promise.all` 並發，但人數極多時仍受 API 速率影響；抓不到的使用者顯示為「未知使用者 (id)」。
- **未引入測試**：目前僅以 `node --check` 做語法檢查，邏輯正確性靠人工驗證。
- **時區固定台北**：所有顯示與 `register` 輸入皆假設 `Asia/Taipei`。
- **`getServerData` 首次併發**：極端情況下，同一 guild 從未建立文件時兩個併發指令可能撞 unique key（被 try/catch 吸收為通用錯誤），僅影響首次互動。

---

## 🌿 分支說明

| 分支 | 儲存方式 | 部署 | 用途 |
|------|----------|------|------|
| `main` | MongoDB + Mongoose | Zeabur | **正式版**，本文件對應版本 |
| `replit` | 單機 JSON 檔（`predictions_data.json`） | Replit | 原型／封存版，見該分支 README |

---

_最後更新：2026-06-29 ｜ 初版文件_
