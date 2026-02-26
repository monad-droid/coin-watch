const cron = require("node-cron");
const config = require("./config");
const { scrape } = require("./scraper");
const { processUpdate, isFirstRun } = require("./store");
const { notify } = require("./notifier");

const runOnce = process.argv.includes("--once");

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
      console.log("  You will be notified when new coins appear.");
      coins.forEach((c) => console.log(`    - ${c.name}`));
      return;
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
