# Coin Watch

Monitor [usmint.pinehurstcoins.com](https://usmint.pinehurstcoins.com/) for new coin listings and get notified instantly so you never miss a new release.

## Features

- Scrapes the Pinehurst Coins US Mint page on a configurable schedule
- Detects new coin listings by comparing against previously seen coins
- Multiple notification methods: console, email (SMTP), Discord webhook
- Two scraping modes: headless browser (Puppeteer) or lightweight HTTP (Axios + Cheerio)
- Persistent storage of known coins in JSON

## Quick Start

```bash
# Install dependencies
npm install

# Copy and edit config
cp .env.example .env
# Edit .env with your notification preferences

# Run a one-time check
npm run check

# Run continuous monitoring (checks every 5 minutes by default)
npm start
```

## Configuration

All settings are in `.env` (copy from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `TARGET_URL` | `https://usmint.pinehurstcoins.com/` | URL to monitor |
| `CRON_SCHEDULE` | `*/5 * * * *` | Check frequency ([cron syntax](https://crontab.guru/)) |
| `SCRAPER_MODE` | `browser` | `browser` (Puppeteer) or `http` (Axios+Cheerio) |
| `NOTIFY_METHODS` | `console` | Comma-separated: `console`, `email`, `discord` |

### Email Notifications

Set `NOTIFY_METHODS` to include `email` and configure SMTP settings:

```env
NOTIFY_METHODS=console,email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_TO=your-email@gmail.com
```

For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833).

### Discord Notifications

Set `NOTIFY_METHODS` to include `discord` and add your webhook URL:

```env
NOTIFY_METHODS=console,discord
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Browser Mode

If Puppeteer can't find Chrome, you have three options:

1. Install Chrome for Puppeteer: `npx puppeteer browsers install chrome`
2. Point to an existing Chrome: set `CHROME_PATH=/path/to/chrome` in `.env`
3. Switch to HTTP mode: set `SCRAPER_MODE=http` in `.env`

## How It Works

1. **Scrape**: Fetches the target URL and extracts coin listings using multiple parsing strategies (WooCommerce products, generic product cards, product-like links)
2. **Compare**: Checks scraped coins against the stored list in `data/coins.json`
3. **Notify**: If new coins are found, sends notifications via configured methods
4. **Store**: Saves the updated coin list for future comparisons

On the first run, all found coins are saved as the baseline — no notifications are sent. Subsequent runs will alert you to any new additions.

## Scripts

```bash
npm start       # Start continuous monitoring
npm run check   # One-time check
npm test        # Run tests
```
