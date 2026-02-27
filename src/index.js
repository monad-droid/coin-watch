const cron = require("node-cron");
const config = require("./config");
const { scrape } = require("./scraper");
const { processUpdate, isFirstRun } = require("./store");
const { notify } = require("./notifier");

const runOnce = process.argv.includes("--once");
const runTest = process.argv.includes("--test");

async function sendStartupNotification() {
  const axios = require("axios");
  if (!config.telegram.botToken || !config.telegram.chatId) return;

  try {
    const text =
      `<b>Coin Watch Started</b>\n` +
      `Monitoring <a href="${config.targetUrl}">Pinehurst Coins US Mint</a>\n\n` +
      `<b>Schedule:</b> <code>${config.cronSchedule}</code>\n` +
      `<b>Mode:</b> ${config.scraperMode}`;

    await axios.post(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        chat_id: config.telegram.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }
    );
    console.log("  [telegram] Startup notification sent");
  } catch (err) {
    console.error("  [telegram] Startup notification failed:", err.message);
  }
}

async function sendTestNotification() {
  const axios = require("axios");
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env");
    process.exit(1);
  }

  console.log("Sending test notification to Telegram...");

  try {
    const text =
      `<b>Test Notification</b>\n` +
      `If you see this, Telegram notifications are working!\n\n` +
      `<b>URL:</b> ${config.targetUrl}\n` +
      `<b>Schedule:</b> <code>${config.cronSchedule}</code>\n` +
      `<b>Notify Methods:</b> ${config.notify.methods.join(", ")}`;

    await axios.post(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        chat_id: config.telegram.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }
    );
    console.log("\nTest notification sent! Check your Telegram chat.");
  } catch (err) {
    console.error(`\nFailed to send: ${err.message}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Response: ${JSON.stringify(err.response.data)}`);
    }
    process.exit(1);
  }
}

async function check() {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] Checking for new coins...`);

  try {
    const firstRun = isFirstRun();
    const coins = await scrape();

    if (coins.length === 0) {
      console.log(
        "  No coins found on the page. The site may require login, or the page structure may have changed."
      );
      console.log(
        "  Try visiting the URL manually and check the scraper selectors."
      );
      return;
    }

    const { newCoins, removedCoins } = processUpdate(coins);

    if (firstRun) {
      console.log(
        `  First run: saved ${coins.length} coin(s) to watch list.`
      );
    }

    if (newCoins.length > 0) {
      console.log(`  ${newCoins.length} NEW coin(s) detected!`);
      await notify(newCoins);
    } else {
      console.log(`  No new coins. (${coins.length} total on page)`);
    }

    if (removedCoins.length > 0) {
      console.log(`  ${removedCoins.length} coin(s) removed from listing:`);
      removedCoins.forEach((c) => console.log(`    - ${c.name}`));
    }
  } catch (err) {
    console.error("  Error during check:", err.message);
    if (err.message.includes("Could not find browser") || err.message.includes("Failed to launch")) {
      console.error(
        "\n  Puppeteer could not find Chrome. Options:\n" +
        '  1. Set CHROME_PATH in .env to your Chrome/Chromium path\n' +
        '  2. Run: npx puppeteer browsers install chrome\n' +
        '  3. Switch to HTTP mode: set SCRAPER_MODE=http in .env\n'
      );
    }
  }
}

async function main() {
  // Handle --test flag: send a test notification and exit
  if (runTest) {
    await sendTestNotification();
    return;
  }

  console.log("Coin Watch - Monitoring Pinehurst Coins US Mint");
  console.log(`  URL:      ${config.targetUrl}`);
  console.log(`  Mode:     ${config.scraperMode}`);
  console.log(`  Notify:   ${config.notify.methods.join(", ")}`);

  if (runOnce) {
    console.log("  Schedule: one-time check\n");
    await check();
    return;
  }

  console.log(`  Schedule: ${config.cronSchedule}\n`);

  // Send a startup notification to Telegram so user knows the watcher is alive
  if (config.notify.methods.includes("telegram")) {
    await sendStartupNotification();
  }

  // Run immediately on startup
  await check();

  // Then schedule recurring checks
  cron.schedule(config.cronSchedule, check);
  console.log("\nScheduler running. Press Ctrl+C to stop.\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
