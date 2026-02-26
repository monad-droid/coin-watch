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
 * The Pinehurst site shows coin cards with:
 *   - Heading: coin name (e.g. "2026-P Proof $1 American Silver Eagle...")
 *   - SKU code (e.g. "26RF")
 *   - Price with $ (e.g. "$285")
 *   - "Create Purchase Order" link pointing to coin page
 */
function extractCoins($, baseUrl) {
  const results = [];
  const seen = new Set();

  // Strategy 1: Find "Create Purchase Order" links (the main CTA on each coin card)
  // then walk up the DOM to find the associated name and price
  $('a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";
    const linkText = $a.text().trim();

    // Look for links that point to coin pages
    let fullUrl;
    try {
      fullUrl = new URL(href, baseUrl).href;
    } catch {
      return;
    }

    if (!isCoinPage(fullUrl, baseUrl) || seen.has(fullUrl)) return;

    // Walk up through parent elements to find the card container
    // Look for the nearest parent that contains both a heading and price text
    let container = $a.parent();
    let name = "";
    let price = "";
    let sku = "";
    let image = "";

    // Walk up at most 10 levels to find the card
    for (let i = 0; i < 10 && container.length; i++) {
      const containerText = container.text();

      // Check if this container has a price ($ followed by digits)
      const priceMatch = containerText.match(/\$\s*[\d,]+(?:\.\d{2})?/);

      // Check if this container has a heading with a coin name
      const heading = container.find("h1, h2, h3, h4, h5, h6").first();
      const headingText = heading.text().trim();

      if (priceMatch && headingText && headingText.length > 5) {
        name = headingText;
        price = priceMatch[0].trim();

        // Look for SKU - typically a short alphanumeric code near the price
        // Pattern: 2-6 character code like "26RF", "25NV", "22EA"
        const allText = container.text();
        const skuMatch = allText.match(/\b(\d{2}[A-Z]{1,4})\b/);
        if (skuMatch) {
          sku = skuMatch[1];
        }

        // Look for image
        const img = container.find("img").first();
        image = img.attr("src") || "";

        break;
      }

      container = container.parent();
    }

    // If we couldn't find a card container with heading+price,
    // fall back to just using the link text or URL slug
    if (!name) {
      // Try siblings / nearby text
      const parentText = $a.parent().parent().text().trim();
      const priceMatch = parentText.match(/\$\s*[\d,]+(?:\.\d{2})?/);
      if (priceMatch) price = priceMatch[0].trim();

      // Derive name from URL slug as fallback
      const slug = new URL(fullUrl).pathname.replace(/\/$/, "").split("/").pop() || "";
      name = slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bOgp\b/g, "OGP")
        .replace(/\bCoa\b/g, "COA")
        .replace(/\b1\b/g, "$1")
        .trim();
    }

    if (!name) return;
    seen.add(fullUrl);

    if (DEBUG) {
      console.log(`  [debug] Coin: "${name}" | Price: ${price || "N/A"} | SKU: ${sku || "N/A"} | ${fullUrl}`);
    }

    results.push({ name, url: fullUrl, price, sku, image });
  });

  // Strategy 2: If no links matched, scan for price patterns and walk up to headings
  if (results.length === 0) {
    // Find any text node containing a dollar price
    $("*").each((_, el) => {
      const $el = $(el);
      const ownText = $el.contents().filter(function() {
        return this.type === "text";
      }).text().trim();

      const priceMatch = ownText.match(/^\$\s*[\d,]+(?:\.\d{2})?$/);
      if (!priceMatch) return;

      const price = priceMatch[0].trim();

      // Walk up to find heading
      let parent = $el.parent();
      for (let i = 0; i < 10 && parent.length; i++) {
        const heading = parent.find("h1, h2, h3, h4, h5, h6").first();
        const link = parent.find("a[href]").first();
        const headingText = heading.text().trim();

        if (headingText && headingText.length > 5) {
          const href = link.attr("href") || "";
          let fullUrl = "";
          try {
            fullUrl = new URL(href, baseUrl).href;
          } catch {}

          if (seen.has(fullUrl || headingText)) break;
          seen.add(fullUrl || headingText);

          const img = parent.find("img").first();
          const skuMatch = parent.text().match(/\b(\d{2}[A-Z]{1,4})\b/);

          results.push({
            name: headingText,
            url: fullUrl,
            price,
            sku: skuMatch ? skuMatch[1] : "",
            image: img.attr("src") || "",
          });
          break;
        }
        parent = parent.parent();
      }
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
