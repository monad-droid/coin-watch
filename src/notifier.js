const config = require("./config");

/**
 * Send a console notification (always works, no setup needed).
 */
async function notifyConsole(newCoins) {
  console.log("\n" + "=".repeat(60));
  console.log(`  NEW COIN(S) DETECTED! (${newCoins.length})`);
  console.log("=".repeat(60));
  for (const coin of newCoins) {
    console.log(`\n  Name:  ${coin.name}`);
    if (coin.sku) console.log(`  SKU:   ${coin.sku}`);
    if (coin.price) console.log(`  Pays:  ${coin.price} per coin`);
    if (coin.url) console.log(`  URL:   ${coin.url}`);
  }
  console.log("\n" + "=".repeat(60) + "\n");
}

/**
 * Send an email notification via SMTP.
 */
async function notifyEmail(newCoins) {
  if (!config.email.user || !config.email.pass || !config.email.to) {
    console.warn(
      "  [email] Skipped: SMTP credentials not configured in .env"
    );
    return;
  }

  const nodemailer = require("nodemailer");

  const transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  const coinList = newCoins
    .map((c) => {
      let entry = `<li><strong>${escapeHtml(c.name)}</strong>`;
      if (c.sku) entry += ` (SKU: ${escapeHtml(c.sku)})`;
      if (c.price) entry += ` — Pays <strong>${escapeHtml(c.price)}</strong> per coin`;
      if (c.url) entry += `<br><a href="${escapeHtml(c.url)}">Create Purchase Order</a>`;
      entry += `</li>`;
      return entry;
    })
    .join("\n");

  const html = `
    <h2>New Coin(s) Detected on Pinehurst Coins!</h2>
    <p>${newCoins.length} new listing(s) found at <a href="${escapeHtml(config.targetUrl)}">${escapeHtml(config.targetUrl)}</a>:</p>
    <ul>${coinList}</ul>
    <p><em>Sent by Coin Watch at ${new Date().toLocaleString()}</em></p>
  `;

  const text = newCoins
    .map(
      (c) =>
        `${c.name}${c.price ? " - " + c.price : ""}${c.url ? "\n  " + c.url : ""}`
    )
    .join("\n\n");

  await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject: `Coin Watch: ${newCoins.length} New Coin(s) Found!`,
    text: `New coin(s) detected:\n\n${text}`,
    html,
  });

  console.log(`  [email] Notification sent to ${config.email.to}`);
}

/**
 * Send a Telegram Bot API notification.
 */
async function notifyTelegram(newCoins) {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.warn(
      "  [telegram] Skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in .env"
    );
    return;
  }

  const axios = require("axios");

  const coinLines = newCoins.map((coin) => {
    const parts = [`<b>${escapeHtml(coin.name)}</b>`];
    if (coin.sku) parts.push(`SKU: ${escapeHtml(coin.sku)}`);
    if (coin.price) parts.push(`Pays: <b>${escapeHtml(coin.price)}</b> per coin`);
    if (coin.url) parts.push(`<a href="${escapeHtml(coin.url)}">Create Purchase Order</a>`);
    return parts.join("\n");
  });

  const text =
    `<b>New Coin(s) Detected! (${newCoins.length})</b>\n` +
    `Found at <a href="${escapeHtml(config.targetUrl)}">Pinehurst Coins US Mint</a>\n\n` +
    coinLines.join("\n\n");

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;

  await axios.post(url, {
    chat_id: config.telegram.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });

  console.log("  [telegram] Notification sent");
}

/**
 * Send notifications through all configured methods.
 */
async function notify(newCoins) {
  if (!newCoins || newCoins.length === 0) return;

  const methods = config.notify.methods;

  for (const method of methods) {
    try {
      switch (method) {
        case "console":
          await notifyConsole(newCoins);
          break;
        case "email":
          await notifyEmail(newCoins);
          break;
        case "telegram":
          await notifyTelegram(newCoins);
          break;
        default:
          console.warn(`  Unknown notification method: ${method}`);
      }
    } catch (err) {
      console.error(`  [${method}] Notification failed:`, err.message);
    }
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { notify, notifyConsole, notifyEmail, notifyTelegram };
