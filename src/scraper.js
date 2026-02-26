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

/**
 * Parse a coin name from a URL slug.
 * e.g. "2026-p-proof-1-american-silver-eagle-congratulations-set-box-ogp-coa"
 * becomes "2026 P Proof 1 American Silver Eagle Congratulations Set Box OGP COA"
 */
function coinNameFromSlug(slug) {
  return slug
    .replace(/\/$/, "")        // remove trailing slash
    .split("/").pop()          // get last path segment
    .replace(/-/g, " ")       // dashes to spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()) // title case
    .replace(/\bOgp\b/g, "OGP")
    .replace(/\bCoa\b/g, "COA")
    .trim();
}

/**
 * Check if a URL is an internal coin product page (not a utility page).
 */
function isCoinPage(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    const base = new URL(baseUrl);

    // Must be same domain
    if (url.hostname !== base.hostname) return false;

    // Must have a real path (not just "/" or "")
    const pathname = url.pathname.replace(/\/$/, "");
    if (!pathname || pathname === "") return false;

    // Skip known utility paths
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
 * Scrape coins using Puppeteer (headless browser).
 * Best for JavaScript-rendered pages or sites with anti-bot measures.
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

    // Wait a moment for any dynamic content to load
    await new Promise((r) => setTimeout(r, 2000));

    const pageUrl = page.url();
    const coins = await page.evaluate((skipPaths) => {
      const results = [];
      const seen = new Set();
      const base = new URL(window.location.href);

      document.querySelectorAll("a[href]").forEach((a) => {
        try {
          const resolved = new URL(a.href, base);
          if (resolved.hostname !== base.hostname) return;

          const pathname = resolved.pathname.replace(/\/$/, "");
          if (!pathname) return;

          for (const skip of skipPaths) {
            if (pathname.startsWith(skip)) return;
          }

          const fullUrl = resolved.href;
          if (seen.has(fullUrl)) return;
          seen.add(fullUrl);

          // Derive name from URL slug
          const slug = pathname.split("/").pop() || "";
          const name = slug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .replace(/\bOgp\b/g, "OGP")
            .replace(/\bCoa\b/g, "COA")
            .trim();

          const imgEl = a.querySelector("img") || a.closest("div")?.querySelector("img");

          results.push({
            name,
            url: fullUrl,
            price: "",
            image: imgEl ? imgEl.src : "",
          });
        } catch {}
      });

      return results;
    }, SKIP_PATHS);

    console.log(`  Found ${coins.length} coin listing(s)`);
    return coins;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape coins using Axios + Cheerio (HTTP-based, no browser needed).
 * Faster and lighter, but won't work on JavaScript-rendered pages.
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
  const results = [];
  const seen = new Set();

  // Find all internal links that point to coin product pages
  $("a[href]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || "";

    // Resolve relative URLs
    let fullUrl;
    try {
      fullUrl = new URL(href, url).href;
    } catch {
      return;
    }

    if (seen.has(fullUrl) || !isCoinPage(fullUrl, url)) return;
    seen.add(fullUrl);

    // Derive coin name from URL slug (more reliable than link text on this site)
    const name = coinNameFromSlug(fullUrl);
    const image = $a.find("img").first().attr("src") || "";

    if (DEBUG) {
      const linkText = $a.text().trim().replace(/\s+/g, " ");
      console.log(`  [debug] Found coin: "${name}" (link text: "${linkText}") -> ${fullUrl}`);
    }

    results.push({ name, url: fullUrl, price: "", image });
  });

  console.log(`  Found ${results.length} coin listing(s)`);
  return results;
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
