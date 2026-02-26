const fs = require("fs");
const path = require("path");
const config = require("./config");

const DEBUG = process.argv.includes("--debug");
const DUMP_DIR = path.join(__dirname, "..", "data");

// Known non-coin URL paths on usmint.pinehurstcoins.com
const SKIP_PATHS = [
  "/wp-login", "/wp-admin", "/wp-content", "/wp-includes",
  "/seller-registration", "/new-seller-confirmation",
  "/my-purchase-orders", "/my-account",
  "/purchase-shipping-labels",
  "/home-back-up-testing",
  "/cart", "/checkout",
];

function isCoinPage(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    const base = new URL(baseUrl);
    if (url.hostname !== base.hostname) return false;
    const pathname = url.pathname.replace(/\/$/, "");
    if (!pathname || pathname === "") return false;
    for (const skip of SKIP_PATHS) {
      if (pathname.startsWith(skip)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dumpHtml(html, label) {
  if (!DEBUG) return;
  const file = path.join(DUMP_DIR, `debug-${label}-${Date.now()}.html`);
  fs.writeFileSync(file, html, "utf-8");
  console.log(`  [debug] HTML dumped to ${file}`);
}

/**
 * Extract coin listings from HTML using Cheerio.
 *
 * The site uses Atomic Blocks pricing tables (Genesis framework).
 * Each coin card is a div.ab-block-pricing-table with:
 *   - Title (h5): coin name
 *   - div.ab-pricing-table-subtitle: SKU code (e.g. "26RF")
 *   - div.ab-pricing-table-price-wrap: price (e.g. "$285")
 *   - div.ab-pricing-table-button a: "Create Purchase Order" link
 */
function extractCoins($, baseUrl) {
  const results = [];
  const seen = new Set();

  // Primary strategy: Atomic Blocks pricing table cards
  $(".ab-block-pricing-table").each((_, el) => {
    const $card = $(el);

    // Coin name from the pricing table title div
    const name = $card.find(".ab-pricing-table-title").first().text().trim();

    // SKU from subtitle
    const sku = $card.find(".ab-pricing-table-subtitle").first().text().trim();

    // Price: Atomic Blocks splits currency symbol and amount into separate spans
    const priceWrap = $card.find(".ab-pricing-table-price-wrap, .ab-pricing-table-price").first();
    const currency = priceWrap.find(".ab-pricing-table-currency").text().trim() || "$";
    const amount = priceWrap.find(".ab-pricing-table-amount").text().trim();
    let price = "";
    if (amount) {
      price = `${currency}${amount}`;
    } else {
      // Fallback: grab combined text and extract price
      const priceText = priceWrap.text().trim();
      const priceMatch = priceText.match(/\$\s*[\d,]+(?:\.\d{2})?/);
      price = priceMatch ? priceMatch[0].trim() : "";
    }

    // Link from the button
    const link = $card.find(".ab-pricing-table-button a, a.ab-button").first();
    const href = link.attr("href") || "";
    let fullUrl = "";
    try {
      fullUrl = new URL(href, baseUrl).href;
    } catch {}

    // Image if present
    const image = $card.find("img").first().attr("src") || "";

    if (!name && !fullUrl) return;
    const key = fullUrl || name;
    if (seen.has(key)) return;
    seen.add(key);

    if (DEBUG) {
      console.log(`  [debug] Coin: "${name}" | Price: ${price} | SKU: ${sku} | ${fullUrl}`);
    }

    results.push({ name: name || sku, url: fullUrl, price, sku, image });
  });

  // Fallback: if no Atomic Blocks cards found, scan for any internal coin page links
  if (results.length === 0) {
    $("a[href]").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      let fullUrl;
      try {
        fullUrl = new URL(href, baseUrl).href;
      } catch {
        return;
      }

      if (!isCoinPage(fullUrl, baseUrl) || seen.has(fullUrl)) return;
      seen.add(fullUrl);

      // Derive name from URL slug
      const slug = new URL(fullUrl).pathname.replace(/\/$/, "").split("/").pop() || "";
      const name = slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bOgp\b/g, "OGP")
        .replace(/\bCoa\b/g, "COA")
        .trim();

      if (DEBUG) {
        console.log(`  [debug] Fallback coin: "${name}" | ${fullUrl}`);
      }

      results.push({ name, url: fullUrl, price: "", sku: "", image: "" });
    });
  }

  return results;
}

/**
 * Scrape coins using Puppeteer (headless browser).
 */
async function scrapeWithBrowser(url) {
  const puppeteer = require("puppeteer");

  const launchOpts = {
    headless: config.browser.headless ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (config.browser.chromePath) {
    launchOpts.executablePath = config.browser.chromePath;
  }

  const browser = await puppeteer.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    console.log(`  Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: config.browser.pageTimeout,
    });

    await new Promise((r) => setTimeout(r, 2000));

    const html = await page.content();
    dumpHtml(html, "browser");

    const cheerio = require("cheerio");
    const $ = cheerio.load(html);
    const coins = extractCoins($, url);

    console.log(`  Found ${coins.length} coin listing(s)`);
    return coins;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape coins using Axios + Cheerio (HTTP-based, no browser needed).
 */
async function scrapeWithHttp(url) {
  const axios = require("axios");
  const cheerio = require("cheerio");

  console.log(`  Fetching ${url}...`);
  const { data: html } = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: config.browser.pageTimeout,
  });

  dumpHtml(html, "http");

  const $ = cheerio.load(html);
  const coins = extractCoins($, url);

  console.log(`  Found ${coins.length} coin listing(s)`);
  return coins;
}

/**
 * Main scrape function - delegates to the configured method.
 */
async function scrape(url) {
  url = url || config.targetUrl;

  if (config.scraperMode === "browser") {
    return scrapeWithBrowser(url);
  } else {
    return scrapeWithHttp(url);
  }
}

module.exports = { scrape, scrapeWithBrowser, scrapeWithHttp };
