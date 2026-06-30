# 🏁 DC-Race-Bot（Replit / JSON 版）

Discord 賽事預測競賽機器人。玩家用斜線指令預測比賽勝隊，管理員登錄比賽與結果，系統自動計分並產生排行榜。

> ⚠️ **本分支（`replit`）為原型／封存版本**，資料以**單機 JSON 檔**儲存，原設計運行於 **Replit**。
> 正式部署版本已遷移至 **MongoDB + Zeabur**，請見 [`main`](https://github.com/Sallynium/DC-race-bot/tree/main) 分支。
> 本分支保留作為開發歷史與離線 / 單機運行參考。

---

## 📑 目錄

- [與 main 版的差異](#-與-main-版的差異)
- [功能總覽](#-功能總覽)
- [技術架構](#-技術架構)
- [資料儲存](#-資料儲存)
- [指令列表](#-指令列表)
- [環境變數](#-環境變數)
- [本機 / Replit 執行](#-本機--replit-執行)
- [已知限制](#-已知限制)

---

## 🔀 與 main 版的差異

| 面向 | `replit`（本分支） | `main`（正式版） |
|------|--------------------|------------------|
| 資料儲存 | 單機 JSON 檔 `predictions_data.json` | MongoDB（Mongoose） |
| 狀態模型 | 全域 `data` 物件常駐記憶體，變更後整份寫回檔案 | 無全域狀態，每次指令 on-demand 讀寫資料庫 |
| 寫入方式 | `saveData()` 整份 `JSON.stringify` 覆寫 | `$set` / `$unset` / `$inc` 原子操作 |
| 併發安全 | ❌ 多操作同時寫入可能互相覆蓋 | ✅ 原子操作 + 結算守衛防競態 |
| 持久化 | 依賴 Replit 檔案系統（重置容器即可能遺失） | 雲端資料庫持久化 |
| 部署 | Replit | Zeabur |
| 相依套件 | `discord.js`、`express` | 另加 `mongoose` |

指令集（使用者體驗）兩版**完全一致**，差別在底層儲存與併發正確性。

---

## ✨ 功能總覽

- **比賽預測**：玩家對「已登錄、未開賽」的比賽預測勝隊，開賽後鎖定。
- **自動計分**：管理員登錄結果後，預測正確者依該場分數加分。
- **結果回溯**：`/undoresult` 撤銷結算（扣回分數）。
- **跟單**：`/follow` 複製其他玩家的預測。
- **排行榜 / 個人積分 / 預測統計**等查詢。
- **管理工具**：手動加減分、代客預測、刪除比賽、全資料重置。
- **彩蛋**：`/食物輪盤` 隨機抽今天吃什麼。

---

## 🛠 技術架構

| 項目 | 內容 |
|------|------|
| 執行環境 | Node.js |
| Discord 函式庫 | discord.js `^14.16.3` |
| 資料儲存 | 本機 JSON 檔（`fs` 讀寫） |
| 保活 Web 伺服器 | Express `^4.18.2`（`GET /` 保活，配合 Replit/UptimeRobot 等） |
| 互動模型 | Slash Command + Autocomplete |

**單檔架構**：邏輯集中於 [`index.js`](index.js)。啟動時 `loadData()` 把 JSON 檔讀進全域 `data`，每次資料變更呼叫 `saveData()` 整份寫回。

---

## 🗄 資料儲存

所有資料存於專案根目錄的 `predictions_data.json`，結構以 Discord 伺服器（guild）為頂層鍵：

```jsonc
{
  "<guildId>": {
    "predictions":     { "<matchId>": { "<userId>": "隊伍名" } },
    "scores":          { "<userId>": 累計分數 },
    "match_history":   { "<matchId>": "勝隊名" },        // 存在=已結算
    "match_schedules": { "<matchId>": "ISO 時間字串" },
    "match_teams":     { "<matchId>": ["隊伍A", "隊伍B"] },
    "match_points":    { "<matchId>": 預測正確得分 }
  }
}
```

**`loadData()` 內建資料修補**：載入時會
- 移除非物件 / 陣列等無效根鍵；
- 補齊缺失的六個欄位（避免舊資料缺欄位報錯）；
- 清理誤植到內層的根層級欄位名；
- 移除早期 1A2B 小遊戲的殘留資料。

> ⚠️ 此檔被 `.gitignore` 排除，不會進版控；容器重置或檔案遺失即會清空資料。**正式營運請改用 `main` 分支。**

---

## 🎮 指令列表

### 👥 一般使用者
| 指令 | 說明 |
|------|------|
| `/predict 比賽id 隊伍` | 預測比賽勝隊（僅限未開賽） |
| `/myscore` | 查看自己總積分 |
| `/mypredictions` | 查看自己所有預測 |
| `/matches` | 查看所有比賽 |
| `/history 比賽id` | 查看某場預測票數統計 |
| `/leaderboard` | 積分排行榜 |
| `/follow 使用者` | 跟單其他玩家預測 |
| `/help` | 指令說明 |
| `/食物輪盤` | 🎰 隨機抽今天吃什麼 |

### 🔧 管理員（需 Administrator 權限）
| 指令 | 說明 |
|------|------|
| `/register 比賽id 隊伍a 隊伍b 日期 時間 [分數] [強制覆蓋]` | 登錄新比賽 |
| `/result 比賽id 勝隊` | 登錄結果並計分 |
| `/undoresult 比賽id` | 回溯結果並扣回分數 |
| `/addscore 使用者 分數` | 手動加分 |
| `/subscore 使用者 分數` | 手動扣分 |
| `/forcepredict 使用者 比賽id 隊伍` | 代客預測 |
| `/delete 比賽id` | 刪除比賽 |
| `/resetall 確認` | ⚠️ 清空所有資料（需二次確認） |

---

## 🔐 環境變數

| 變數 | 說明 |
|------|------|
| `TOKEN` | Discord Bot Token（Replit Secrets） |
| `CLIENT_ID` | Discord Application ID（註冊斜線指令用） |
| `PORT` | （選用）Express 埠，預設 3000 |

> 本版**不需要** `MONGO_URI`（無資料庫）。

---

## 💻 本機 / Replit 執行

```bash
npm install
# 設定 TOKEN、CLIENT_ID（Replit 用 Secrets；本機用環境變數）
npm start
```

啟動後：
1. `loadData()` 讀取 `predictions_data.json`（首次不存在會在第一次寫入時建立）。
2. Express 於 `PORT` 監聽，`GET /` 回保活訊息。
3. Bot 上線後向 Discord 全域註冊斜線指令。

---

## ⚠️ 已知限制

- **併發不安全**：全域 `data` + 整份覆寫，多人同時操作可能互相覆蓋；這是遷移到 `main`（MongoDB 原子操作）的主因。
- **資料易失**：JSON 檔依賴容器檔案系統，重置即遺失。
- **單機**：無法水平擴展或多實例部署（多實例會各自持有不一致的 `data`）。
- **無自動化測試**。

---

## 🌿 分支說明

| 分支 | 儲存方式 | 部署 | 用途 |
|------|----------|------|------|
| `main` | MongoDB + Mongoose | Zeabur | **正式版**（建議使用） |
| `replit` | 單機 JSON 檔 | Replit | 原型／封存版（本文件對應版本） |

---

_最後更新：2026-06-30 ｜ 初版文件 ｜ 本分支為封存版，新功能請以 `main` 為準_
