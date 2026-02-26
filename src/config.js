require("dotenv").config();

module.exports = {
  targetUrl: process.env.TARGET_URL || "https://usmint.pinehurstcoins.com/",
  cronSchedule: process.env.CRON_SCHEDULE || "*/5 * * * *",
  scraperMode: process.env.SCRAPER_MODE || "browser",

  notify: {
    methods: (process.env.NOTIFY_METHODS || "console")
      .split(",")
      .map((m) => m.trim()),
  },

  email: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    to: process.env.EMAIL_TO || "",
    from: process.env.EMAIL_FROM || "Coin Watch <coinwatch@localhost>",
  },

  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  },

  browser: {
    chromePath: process.env.CHROME_PATH || undefined,
    headless: process.env.HEADLESS !== "false",
    pageTimeout: parseInt(process.env.PAGE_TIMEOUT || "30000", 10),
  },
};
