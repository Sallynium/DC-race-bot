const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const mongoose = require("mongoose");

const TOKEN = process.env["TOKEN"];
const CLIENT_ID = process.env["CLIENT_ID"];
const MONGO_URI = process.env["MONGO_URI"];

// ── Mongoose Schema ────────────────────────────────────────────────────────────

const guildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  // MongoDB 巢狀結構建議直接用混合型別或物件，配合原子操作最穩定
  // 結構：matchId -> userId -> teamName
  predictions: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },
  // userId -> score
  scores: { type: Map, of: Number, default: () => new Map() },
  // matchId -> winningTeam
  match_history: { type: Map, of: String, default: () => new Map() },
  // matchId -> ISO timestamp string
  match_schedules: { type: Map, of: String, default: () => new Map() },
  // matchId -> [teamA, teamB]
  match_teams: { type: Map, of: [String], default: () => new Map() },
  // matchId -> points
  match_points: { type: Map, of: Number, default: () => new Map() },
});

const GuildData = mongoose.model("GuildData", guildSchema);

// ── 取得（或初始化）伺服器資料 ────────────────────────────────────────────────

async function getServerData(guildId) {
  let doc = await GuildData.findOne({ guildId });
  if (!doc) {
    doc = await GuildData.create({ guildId });
  }
  return doc;
}

// ── Discord 客戶端 ─────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ── 斜線指令定義 ───────────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("predict")
    .setDescription("預測比賽贏家")
    .addStringOption((o) => o.setName("比賽id").setDescription("輸入比賽ID（例如：R1）").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("隊伍").setDescription("輸入預測獲勝的隊伍名稱").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("register")
    .setDescription("【管理員】登錄新比賽")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("比賽id").setDescription("比賽ID（例如：R1）").setRequired(true))
    .addStringOption((o) => o.setName("隊伍a").setDescription("隊伍A名稱").setRequired(true))
    .addStringOption((o) => o.setName("隊伍b").setDescription("隊伍B名稱").setRequired(true))
    .addStringOption((o) => o.setName("日期").setDescription("比賽日期（格式：YYYY-MM-DD）").setRequired(true))
    .addStringOption((o) => o.setName("時間").setDescription("比賽時間（格式：HH:MM，台北時間）").setRequired(true))
    .addIntegerOption((o) => o.setName("分數").setDescription("預測正確可得分數（預設為1分）").setMinValue(1))
    .addBooleanOption((o) => o.setName("強制覆蓋").setDescription("是否強制覆蓋已存在的比賽")),

  new SlashCommandBuilder()
    .setName("result")
    .setDescription("【管理員】登錄比賽結果")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("比賽id").setDescription("比賽ID").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("勝隊").setDescription("獲勝隊伍名稱").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder().setName("matches").setDescription("查看所有已登錄的比賽"),
  new SlashCommandBuilder().setName("myscore").setDescription("查看自己的目前總積分"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("查看積分排行榜"),
  new SlashCommandBuilder().setName("mypredictions").setDescription("查看自己的所有預測紀錄"),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("查看某場比賽的預測統計")
    .addStringOption((o) => o.setName("比賽id").setDescription("比賽ID").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("follow")
    .setDescription("複製其他使用者的預測（跟單）")
    .addUserOption((o) => o.setName("使用者").setDescription("選擇要跟單的使用者").setRequired(true)),

  new SlashCommandBuilder()
    .setName("delete")
    .setDescription("【管理員】刪除比賽及其所有相關資料")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("比賽id").setDescription("要刪除的比賽ID").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("undoresult")
    .setDescription("【管理員】回溯比賽結果")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName("比賽id").setDescription("要回溯的比賽ID").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("addscore")
    .setDescription("【管理員】手動增加使用者積分")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) => o.setName("使用者").setDescription("選擇使用者").setRequired(true))
    .addIntegerOption((o) => o.setName("分數").setDescription("要增加的分數").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("subscore")
    .setDescription("【管理員】手動減少使用者積分")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) => o.setName("使用者").setDescription("選擇使用者").setRequired(true))
    .addIntegerOption((o) => o.setName("分數").setDescription("要減少的分數").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("forcepredict")
    .setDescription("【管理員】代替使用者進行預測")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((o) => o.setName("使用者").setDescription("選擇使用者").setRequired(true))
    .addStringOption((o) => o.setName("比賽id").setDescription("比賽ID").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("隊伍").setDescription("預測隊伍").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("resetall")
    .setDescription("【管理員】清空所有資料（需二次確認）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((o) => o.setName("確認").setDescription("確認要清空所有資料？此操作無法復原！").setRequired(true)),

  new SlashCommandBuilder().setName("help").setDescription("顯示機器人使用說明"),
  new SlashCommandBuilder().setName("食物輪盤").setDescription("隨機決定今天要吃什麼！"),
];

async function registerCommands() {
  try {
    console.log("開始註冊斜線指令...");
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands.map((cmd) => cmd.toJSON()),
    });
    console.log("✅ 成功註冊所有斜線指令！");
  } catch (error) {
    console.error("❌ 註冊斜線指令失敗:", error);
  }
}

// ── 自動完成 ───────────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  const focusedOption = interaction.options.getFocused(true);

  try {
    const doc = await GuildData.findOne({ guildId }, "match_teams match_history").lean();
    if (!doc) return interaction.respond([]);

    const matchTeams = doc.match_teams || {};
    const matchHistory = doc.match_history || {};
    const commandName = interaction.commandName;
    const searchValue = focusedOption.value.toLowerCase();

    if (focusedOption.name === "比賽id") {
      const allMatchIds = Object.keys(matchTeams);
      let filtered;

      if (["predict", "forcepredict", "result"].includes(commandName)) {
        filtered = allMatchIds.filter((id) => !matchHistory[id] && id.toLowerCase().includes(searchValue));
      } else if (commandName === "undoresult") {
        filtered = allMatchIds.filter((id) => matchHistory[id] && id.toLowerCase().includes(searchValue));
      } else {
        filtered = allMatchIds.filter((id) => id.toLowerCase().includes(searchValue));
      }

      const choices = filtered.slice(0, 25).map((id) => {
        const teams = Array.isArray(matchTeams[id]) ? matchTeams[id].join(" vs ") : "未知";
        return { name: `${id} (${teams})`, value: id };
      });

      await interaction.respond(choices);
    } else if (focusedOption.name === "隊伍" || focusedOption.name === "勝隊") {
      const matchId = interaction.options.getString("比賽id")?.toUpperCase();
      const teams = matchId && matchTeams[matchId];
      if (Array.isArray(teams)) {
        const choices = teams
          .filter((t) => t.toLowerCase().includes(searchValue))
          .map((t) => ({ name: t, value: t }));
        await interaction.respond(choices);
      } else {
        await interaction.respond([]);
      }
    }
  } catch (error) {
    console.error("自動完成錯誤:", error);
    try { await interaction.respond([]); } catch (_) {}
  }
});

// ── 斜線指令處理 ───────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  try {
    switch (interaction.commandName) {

      case "predict": {
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const predictedTeam = interaction.options.getString("隊伍").toUpperCase();

        const doc = await getServerData(guildId);

        if (!doc.match_teams.get(matchId)) {
          return interaction.reply({
            content: `❌ 預測失敗，找不到比賽 \`${matchId}\`，請確認比賽是否已登錄。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const validTeams = doc.match_teams.get(matchId);
        if (!validTeams.includes(predictedTeam)) {
          return interaction.reply({
            content: `❌ 預測失敗，請確認隊伍名稱是否為 ${validTeams.join(" 或 ")}。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const startTimeStr = doc.match_schedules.get(matchId);
        if (startTimeStr && new Date() >= new Date(startTimeStr)) {
          return interaction.reply({
            content: `⏰ 比賽 \`${matchId}\` 已開始，無法再預測！`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        // 原子操作 $set，避免 doc.save() 造成的併發覆蓋
        await GuildData.updateOne(
          { guildId },
          { $set: { [`predictions.${matchId}.${interaction.user.id}`]: predictedTeam } }
        );

        await interaction.reply({ content: `✅ 你預測 \`${matchId}\` 比賽的贏家為：\`${predictedTeam}\`` });
        break;
      }

      case "register": {
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const teamA = interaction.options.getString("隊伍a").toUpperCase();
        const teamB = interaction.options.getString("隊伍b").toUpperCase();
        const datePart = interaction.options.getString("日期");
        const timePart = interaction.options.getString("時間");
        const point = interaction.options.getInteger("分數") || 1;
        const hasForce = interaction.options.getBoolean("強制覆蓋") || false;

        if (matchId.includes(".")) {
          return interaction.reply({
            content: "❌ 比賽ID 不可包含 `.` 字元，請重新輸入。",
            flags: [MessageFlags.Ephemeral],
          });
        }

        // 嚴格驗證格式：V8 會把 2/30 之類的非法日期自動進位（不回 Invalid Date），
        // 所以先用正則檢查欄位範圍，再回比對 ISO 確認沒有進位。
        const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
        const timeMatch = /^(\d{2}):(\d{2})$/.exec(timePart);
        const taipeiTime = new Date(`${datePart}T${timePart}+08:00`);
        const validRollover =
          dateMatch &&
          timeMatch &&
          Number(timeMatch[1]) < 24 &&
          Number(timeMatch[2]) < 60 &&
          !isNaN(taipeiTime.getTime()) &&
          // 用台北時區把解析結果格式化回 YYYY-MM-DD，與輸入比對是否被進位
          taipeiTime.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) === datePart;

        if (!validRollover) {
          return interaction.reply({
            content: "❌ 時間格式錯誤或日期不存在，請使用 YYYY-MM-DD HH:MM 台北時間格式（例如 2026-07-01 19:30）。",
            flags: [MessageFlags.Ephemeral],
          });
        }

        const doc = await getServerData(guildId);

        if (doc.match_teams.get(matchId) && !hasForce) {
          return interaction.reply({
            content: `⚠️ 比賽 \`${matchId}\` 已經存在，若要覆蓋請將「強制覆蓋」選項設為 True`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        await GuildData.updateOne(
          { guildId },
          {
            $set: {
              [`match_teams.${matchId}`]: [teamA, teamB],
              [`match_schedules.${matchId}`]: taipeiTime.toISOString(),
              [`match_points.${matchId}`]: point
            }
          }
        );

        await interaction.reply({
          content: `${hasForce ? "🔄 已覆蓋原有資料，" : ""}✅ 登錄比賽 \`${matchId}\`：${teamA} vs ${teamB}，時間：${taipeiTime.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}（預測正確得 ${point} 分）`,
        });
        break;
      }

      case "result": {
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const winningTeam = interaction.options.getString("勝隊").toUpperCase();

        const doc = await getServerData(guildId);

        if (!doc.match_teams.get(matchId)) {
          return interaction.reply({
            content: `❌ 查無比賽 \`${matchId}\`，請確認是否正確輸入。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const validTeams = doc.match_teams.get(matchId);
        if (!validTeams.includes(winningTeam)) {
          return interaction.reply({
            content: `❌ 結果輸入錯誤：勝隊 \`${winningTeam}\` 並不屬於比賽 \`${matchId}\` 的登錄隊伍。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        if (doc.match_history.get(matchId)) {
          return interaction.reply({
            content: `⚠️ 比賽 \`${matchId}\` 已結算過，若需要修正請使用 \`/undoresult\` 回溯。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const point = doc.match_points.get(matchId) || 1;
        const matchPredictions = doc.predictions.get(matchId);
        const rawPredictions = matchPredictions instanceof Map
          ? Object.fromEntries(matchPredictions)
          : (matchPredictions || {});

        const incOps = {};

        for (const [userId, team] of Object.entries(rawPredictions)) {
          if (typeof team === "string" && team.toUpperCase() === winningTeam) {
            incOps[`scores.${userId}`] = point;
          }
        }

        // 把「尚未結算」的守衛放進 query，靠 matchedCount 判斷是否真的搶到，
        // 避免兩個 /result 並發時雙雙通過上面的讀取檢查而重複加分。
        const res = await GuildData.updateOne(
          { guildId, [`match_history.${matchId}`]: { $exists: false } },
          {
            $set: { [`match_history.${matchId}`]: winningTeam },
            ...(Object.keys(incOps).length > 0 && { $inc: incOps }),
          }
        );

        if (res.matchedCount === 0) {
          return interaction.reply({
            content: `⚠️ 比賽 \`${matchId}\` 剛剛已被結算，若需修正請使用 \`/undoresult\` 回溯。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        await interaction.reply({ content: `✅ 比賽 \`${matchId}\` 的勝隊是 \`${winningTeam}\`，積分已更新！` });
        break;
      }

      case "matches": {
        const doc = await getServerData(guildId);
        const now = new Date();
        const upcoming = [];
        const ongoing = [];
        const finished = [];

        for (const [matchId, timeStr] of doc.match_schedules) {
          const start = new Date(timeStr);
          const teams = doc.match_teams.get(matchId)?.join(" vs ") || "未知對戰組合";
          const point = doc.match_points.get(matchId) || 1;
          const timeDisplay = start.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
          const line = `\`${matchId}\`｜${teams}｜${timeDisplay}｜${point} 分`;

          if (doc.match_history.get(matchId)) {
            finished.push(matchId);
          } else if (now < start) {
            upcoming.push(line);
          } else {
            ongoing.push(line);
          }
        }

        let msg = "**📅 比賽狀態總覽：**\n";
        msg += upcoming.length > 0
          ? "\n🔮 **可預測比賽：**\n" + upcoming.join("\n") + "\n"
          : "\n🔮 **可預測比賽：** 無\n";
        if (ongoing.length > 0) msg += "\n⏰ **進行中（無法預測）：**\n" + ongoing.join("\n") + "\n";
        if (finished.length > 0) {
          msg += `\n✅ **已結算比賽：** ${finished.length} 場`;
          msg += `\n（${finished.slice(0, 5).join(", ")}${finished.length > 5 ? "..." : ""}）`;
        }

        await interaction.reply({ content: msg });
        break;
      }

      case "myscore": {
        const doc = await getServerData(guildId);
        const score = doc.scores.get(interaction.user.id) || 0;
        await interaction.reply({
          content: `🎯 你的目前總積分為：${score} 分`,
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case "leaderboard": {
        await interaction.deferReply();

        const doc = await getServerData(guildId);
        const sorted = [...doc.scores.entries()].sort(([, a], [, b]) => b - a);

        let msg = "**📊 當前積分排行榜：**\n";
        if (sorted.length === 0) {
          msg += "尚無任何積分紀錄，快來預測！";
        } else {
          // 並發抓取使用者名稱，避免人數多時逐一 await 造成逾時
          const lines = await Promise.all(
            sorted.map(async ([userId, score], i) => {
              try {
                const user = await client.users.fetch(userId);
                return `${i + 1}. ${user.username}：${score} 分`;
              } catch {
                return `${i + 1}. 未知使用者 (${userId})：${score} 分`;
              }
            })
          );
          msg += lines.join("\n") + "\n";
        }

        await interaction.editReply({ content: msg });
        break;
      }

      case "mypredictions": {
        const doc = await getServerData(guildId);
        const userId = interaction.user.id;
        const myList = [];

        for (const [matchId, matchPredictions] of doc.predictions) {
          const rawPredictions = matchPredictions instanceof Map
            ? Object.fromEntries(matchPredictions)
            : matchPredictions;
          const team = rawPredictions?.[userId];
          if (team) myList.push({ matchId, team });
        }

        if (myList.length === 0) {
          return interaction.reply({ content: "你尚未預測任何比賽。", flags: [MessageFlags.Ephemeral] });
        }

        myList.sort((a, b) => a.matchId.localeCompare(b.matchId));
        const lines = myList.map((item) => `- ${item.matchId}: 預測 ${item.team}`);
        await interaction.reply({
          content: `您目前預測結果：\n${lines.join("\n")}`,
          flags: [MessageFlags.Ephemeral],
        });
        break;
      }

      case "history": {
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const doc = await getServerData(guildId);
        const matchPredictions = doc.predictions.get(matchId);

        if (!matchPredictions) {
          return interaction.reply({
            content: `查無比賽 \`${matchId}\` 的預測紀錄`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const rawPredictions = matchPredictions instanceof Map
          ? Object.fromEntries(matchPredictions)
          : matchPredictions;

        const count = {};
        for (const team of Object.values(rawPredictions)) {
          if (typeof team !== "string") continue;
          const t = team.toUpperCase();
          count[t] = (count[t] || 0) + 1;
        }

        let result = `📊 \`${matchId}\` 預測統計：\n`;
        for (const [team, votes] of Object.entries(count)) {
          result += `- ${team}：${votes} 票\n`;
        }

        await interaction.reply({ content: result });
        break;
      }

      case "follow": {
        const targetUser = interaction.options.getUser("使用者");
        const userId = interaction.user.id;
        const targetId = targetUser.id;

        if (userId === targetId) {
          return interaction.reply({ content: "❌ 你不能跟單自己喔！", flags: [MessageFlags.Ephemeral] });
        }

        const doc = await getServerData(guildId);
        const now = new Date();
        const updateOps = {};
        const followed = [];
        const skipped = [];
        const alreadyPredicted = [];

        for (const [matchId] of doc.match_teams) {
          // 已結算、無排程、排程無效、或已截止的場次都跳過（fail-closed）
          const scheduleStr = doc.match_schedules.get(matchId);
          const deadline = new Date(scheduleStr);
          if (doc.match_history.get(matchId) || !scheduleStr || isNaN(deadline.getTime()) || now > deadline) {
            continue;
          }

          const matchPredictions = doc.predictions.get(matchId);
          const rawPredictions = matchPredictions instanceof Map
            ? Object.fromEntries(matchPredictions)
            : (matchPredictions || {});

          const targetTeam = rawPredictions[targetId];
          if (!targetTeam) { skipped.push(matchId); continue; }

          if (rawPredictions[userId]) { alreadyPredicted.push(matchId); continue; }

          updateOps[`predictions.${matchId}.${userId}`] = targetTeam;
          followed.push(`${matchId}：${targetTeam}`);
        }

        if (Object.keys(updateOps).length > 0) {
          await GuildData.updateOne({ guildId }, { $set: updateOps });
        }

        let msg = `📋 成功跟單 ${targetUser.username} 的預測如下：\n`;
        if (followed.length > 0) msg += `✅ ${followed.join("\n")}\n`;
        if (skipped.length > 0) msg += `⏭️ 略過未預測場次：${skipped.join(", ")}\n`;
        if (alreadyPredicted.length > 0) msg += `🛑 以下場次你已預測，未覆蓋：${alreadyPredicted.join(", ")}`;

        await interaction.reply({ content: msg });
        break;
      }

      case "delete": {
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const doc = await getServerData(guildId);

        if (!doc.match_teams.get(matchId) && !doc.match_schedules.get(matchId) && !doc.predictions.get(matchId)) {
          return interaction.reply({
            content: `❌ 查無比賽 \`${matchId}\`，無需刪除。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        await GuildData.updateOne(
          { guildId },
          {
            $unset: {
              [`match_teams.${matchId}`]: "",
              [`match_schedules.${matchId}`]: "",
              [`match_points.${matchId}`]: "",
              [`predictions.${matchId}`]: "",
              [`match_history.${matchId}`]: ""
            }
          }
        );

        await interaction.reply({ content: `🗑️ 已刪除比賽 \`${matchId}\` 的所有紀錄。` });
        break;
      }

      case "undoresult": {
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const doc = await getServerData(guildId);
        const winner = doc.match_history.get(matchId);

        if (!winner) {
          return interaction.reply({
            content: "⚠️ 此比賽尚未結算，無法回溯結果。",
            flags: [MessageFlags.Ephemeral],
          });
        }

        const point = doc.match_points.get(matchId) || 1;
        const matchPredictions = doc.predictions.get(matchId);
        const rawPredictions = matchPredictions instanceof Map
          ? Object.fromEntries(matchPredictions)
          : (matchPredictions || {});

        let undoCount = 0;
        const incOps = {};

        for (const [userId, team] of Object.entries(rawPredictions)) {
          if (typeof team === "string" && team.toUpperCase() === winner.toUpperCase()) {
            incOps[`scores.${userId}`] = -point;
            undoCount++;
          }
        }

        // 守衛條件放進 query：只有目前仍是這個 winner 時才回溯，
        // 避免兩個 /undoresult 並發時重複扣分。
        const res = await GuildData.updateOne(
          { guildId, [`match_history.${matchId}`]: winner },
          {
            $unset: { [`match_history.${matchId}`]: "" },
            ...(Object.keys(incOps).length > 0 && { $inc: incOps }),
          }
        );

        if (res.matchedCount === 0) {
          return interaction.reply({
            content: "⚠️ 此比賽剛剛已被回溯或重新結算，請重新確認狀態。",
            flags: [MessageFlags.Ephemeral],
          });
        }

        await interaction.reply({
          content: `🔄 已回溯比賽 \`${matchId}\` 結果，扣除 ${undoCount} 名預測 \`${winner}\` 使用者的 ${point} 分，請重新使用 \`/result\` 結算。`,
        });
        break;
      }

      case "addscore": {
        const target = interaction.options.getUser("使用者");
        const points = interaction.options.getInteger("分數");

        // 直接 $inc，不需先讀整份文件；upsert 確保 guild 文件不存在時也會建立
        await GuildData.updateOne(
          { guildId },
          { $inc: { [`scores.${target.id}`]: points } },
          { upsert: true }
        );

        await interaction.reply({ content: `✅ 已增加 ${target.username} 的 ${points} 分` });
        break;
      }

      case "subscore": {
        const target = interaction.options.getUser("使用者");
        const points = interaction.options.getInteger("分數");

        await GuildData.updateOne(
          { guildId },
          { $inc: { [`scores.${target.id}`]: -points } },
          { upsert: true }
        );

        await interaction.reply({ content: `✅ 已減少 ${target.username} 的 ${points} 分` });
        break;
      }

      case "forcepredict": {
        const target = interaction.options.getUser("使用者");
        const matchId = interaction.options.getString("比賽id").toUpperCase();
        const predictedTeam = interaction.options.getString("隊伍").toUpperCase();
        const doc = await getServerData(guildId);

        if (!doc.match_teams.get(matchId)) {
          return interaction.reply({
            content: `❌ 找不到比賽 \`${matchId}\`，請確認是否登錄。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        const validTeams = doc.match_teams.get(matchId);
        if (!validTeams.includes(predictedTeam)) {
          return interaction.reply({
            content: `❌ 錯誤，隊伍名稱應為 ${validTeams.join(" 或 ")}。`,
            flags: [MessageFlags.Ephemeral],
          });
        }

        await GuildData.updateOne(
          { guildId },
          { $set: { [`predictions.${matchId}.${target.id}`]: predictedTeam } }
        );

        await interaction.reply({ content: `✅ 成功為 ${target.username} 設定 \`${matchId}\` 預測為 \`${predictedTeam}\`` });
        break;
      }

      case "resetall": {
        const confirm = interaction.options.getBoolean("確認");
        if (!confirm) {
          return interaction.reply({
            content: "❌ 請將「確認」選項設為 True 才能執行清空操作。",
            flags: [MessageFlags.Ephemeral],
          });
        }

        await GuildData.findOneAndUpdate(
          { guildId },
          {
            $set: {
              predictions: {},
              scores: {},
              match_history: {},
              match_schedules: {},
              match_teams: {},
              match_points: {},
            },
          },
          { upsert: true },
        );

        await interaction.reply({
          content:
            "🧹 **已完全重置所有資料！**\n\n" +
            "已清空內容：\n" +
            "✅ 所有比賽資料\n" +
            "✅ 所有預測紀錄\n" +
            "✅ 所有積分紀錄\n" +
            "✅ 所有比賽歷史\n" +
            "系統已重新開始，可以登錄新的比賽了！",
        });
        break;
      }

      case "食物輪盤": {
        const foodList = [
          "滷肉飯","雞腿飯","排骨飯","焢肉飯","燒肉飯","烤肉飯","三寶飯","炸雞飯","咖哩飯","炒飯",
          "蛋炒飯","海鮮炒飯","牛肉炒飯","鐵板燒","日式丼飯","親子丼","豬排飯","炸蝦飯","鰻魚飯","叉燒飯",
          "油雞飯","海南雞飯","燒臘飯","鹹水雞飯","牛肉麵","陽春麵","乾麵","擔擔麵","炸醬麵","麻醬麵",
          "榨菜肉絲麵","紅燒牛肉麵","清燉牛肉麵","羊肉麵","豬腳麵","排骨麵","餛飩麵","米粉湯","炒米粉","意麵",
          "刀削麵","拉麵","烏龍麵","拌麵","涼麵","麻辣麵","大滷麵","三鮮麵","肉羹麵","魚丸湯",
          "貢丸湯","餛飩湯","酸辣湯","牛肉湯","虱目魚湯","河粉","板條","粄條","米苔目","麵疙瘩",
          "滷味","鹹酥雞","雞排","蚵仔煎","蚵仔麵線","臭豆腐","炸豆腐","肉圓","碗粿","米糕",
          "筒仔米糕","油飯","肉粽","割包","刈包","胡椒餅","蔥油餅","蔥抓餅","煎餃","鍋貼",
          "水餃","小籠包","生煎包","包子","雞腿便當","排骨便當","魚便當","控肉便當","爌肉便當","燒肉便當",
          "烤雞便當","火鍋","麻辣鍋","薑母鴨","羊肉爐","佛跳牆","麻油雞","義大利麵","披薩","漢堡",
          "炸雞","韓式料理","日式定食","泰式料理","越南河粉","印度咖哩","港式飲茶","港式燒臘","素食便當","素食自助餐",
          "素食麵","素食火鍋","自助餐","吃到飽","煲仔飯","臘味煲仔飯","滑蛋牛肉飯","窩蛋牛肉飯","乾炒牛河","濕炒牛河",
          "豉椒炒蜆","椒鹽九肚魚","椒鹽魷魚","豉汁蒸排骨","鳳爪","蝦餃","燒賣","叉燒包","腸粉","蘿蔔糕",
          "芋頭糕","鹹水角","馬拉糕","雞扎","糯米雞","蝦腸粉","叉燒腸粉","牛肉腸粉","豬肝粥","皮蛋瘦肉粥",
          "及第粥","艇仔粥","雲吞麵","車仔麵","魚蛋粉","豬紅粥","豬潤粥","蚵嗲","蝦捲","棺材板",
          "擔仔麵","肉粿","虱目魚粥","四神湯","藥燉排骨","鹽水意麵","鱔魚麵","大腸麵線","花枝羹","魷魚羹",
          "當歸鴨","三杯雞","炒飯糰","飯糰",
        ];

        const randomFood = foodList[Math.floor(Math.random() * foodList.length)];
        const embed = new EmbedBuilder()
          .setTitle("🎰 今天吃什麼？")
          .setColor(0xff6b6b)
          .setDescription(`## 🎯 就決定是你了！\n\n# 🍽️ ${randomFood}\n\n───────────────`)
          .setFooter({ text: `🎲 從 ${foodList.length} 種美食中隨機抽選 | 不喜歡就再抽一次吧！` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case "help": {
        const embed = new EmbedBuilder()
          .setTitle("🍁 MSI 預測機器人指令表")
          .setColor(0xecda24)
          .addFields(
            {
              name: "💁 使用者指令",
              value:
                "`/predict` - 預測比賽贏家\n" +
                "`/myscore` - 查看自己目前的分數\n" +
                "`/mypredictions` - 查看預測紀錄\n" +
                "`/matches` - 查看所有比賽\n" +
                "`/history` - 查看預測統計\n" +
                "`/leaderboard` - 查看計分板\n" +
                "`/follow` - 跟單其他使用者\n",
            },
            {
              name: "🔧 管理員指令",
              value:
                "`/register` - 登錄比賽\n" +
                "`/result` - 登錄結果\n" +
                "`/addscore` / `/subscore` - 調整分數\n" +
                "`/forcepredict` - 代客登記\n" +
                "`/delete` - 刪除比賽\n" +
                "`/undoresult` - 回溯結果\n" +
                "`/resetall` - 重置所有資料\n",
            },
            { name: "📘 說明", value: "所有指令都有參數提示和自動完成功能！" },
          )
          .setFooter({ text: "有狀況請找飼養員 Ruru⛄" });

        await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
        break;
      }
    }
  } catch (error) {
    console.error("指令執行錯誤:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ 執行指令時發生錯誤，請稍後再試。",
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
});

// ── 啟動 ───────────────────────────────────────────────────────────────────────

const express = require("express");
const app = express();

app.get("/", (_, res) => res.send("🤖 Discord Bot 正在運行中（MongoDB 版本）"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 網頁伺服器已啟動於 port ${PORT}`));

async function main() {
  if (!MONGO_URI) {
    console.error("❌ 缺少環境變數 MONGO_URI，請在 Zeabur 設定後重啟。");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB 連線成功！");

  client.on("ready", async () => {
    console.log(`🤖 機器人上線：${client.user.tag}`);
    await registerCommands();
  });

  await client.login(TOKEN);
}

main().catch((err) => {
  console.error("❌ 啟動失敗:", err);
  process.exit(1);
});
