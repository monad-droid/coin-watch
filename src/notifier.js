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
    if (coin.price) console.log(`  Price: ${coin.price}`);
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
      if (c.price) entry += ` - ${escapeHtml(c.price)}`;
      if (c.url) entry += `<br><a href="${escapeHtml(c.url)}">${escapeHtml(c.url)}</a>`;
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
 * Send a Discord webhook notification.
 */
async function notifyDiscord(newCoins) {
  if (!config.discord.webhookUrl) {
    console.warn(
      "  [discord] Skipped: DISCORD_WEBHOOK_URL not configured in .env"
    );
    return;
  }

  const axios = require("axios");

  const fields = newCoins.slice(0, 25).map((coin) => ({
    name: coin.name.substring(0, 256),
    value: [
      coin.price ? `**Price:** ${coin.price}` : "",
      coin.url ? `[View Listing](${coin.url})` : "",
    ]
      .filter(Boolean)
      .join("\n") || "No details available",
    inline: false,
  }));

  const payload = {
    embeds: [
      {
        title: `New Coin(s) Detected! (${newCoins.length})`,
        description: `Found at [Pinehurst Coins US Mint](${config.targetUrl})`,
        color: 0xffd700, // Gold color
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "Coin Watch" },
      },
    ],
  };

  await axios.post(config.discord.webhookUrl, payload, {
    headers: { "Content-Type": "application/json" },
  });

  console.log("  [discord] Webhook notification sent");
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
        case "discord":
          await notifyDiscord(newCoins);
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

module.exports = { notify, notifyConsole, notifyEmail, notifyDiscord };
