
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const env = parseEnv(readFileSync(".env", "utf8"));

const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
const enabled = env.TELEGRAM_ENABLED;
const baseUrl = "https://teddy-exactly-dragon-site.trycloudflare.com";

if (!token || !secret || enabled !== "true") {
  console.error("Periksa pengaturan Telegram di file .env.");
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error("Format TELEGRAM_WEBHOOK_SECRET tidak valid.");
  process.exit(1);
}

const response = await fetch(
  `https://api.telegram.org/bot${token}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false
    })
  }
);

const result = await response.json();

if (!response.ok || !result.ok) {
  console.error("Pendaftaran gagal:", result.description || response.status);
  process.exit(1);
}

console.log("Webhook berhasil didaftarkan!");
console.log("URL:", `${baseUrl}/api/telegram/webhook`);
