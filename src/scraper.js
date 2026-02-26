const fs = require("fs");
const path = require("path");
const config = require("./config");

const DEBUG = process.argv.includes("--debug");
const DUMP_DIR = path.join(__dirname, "..", "data");

// URLs and link text that are definitely NOT coin listings
const SKIP_URL_PATTERNS = [
  "login", "log-in", "register", "registration", "account", "wp-admin",
  "cart", "checkout", "seller", "purchase-order", "packing-slip",
  "shipping-label", "confirmation", "my-purchase", "my-account",
  "#", "javascript:", "mailto:", "tel:",
];

const SKIP_TEXT_PATTERNS = [
  "login", "log in", "sign in", "register", "sign up", "create account",
  "seller registration", "purchase order", "packing slip", "shipping label",
  "forgot password", "reset password", "contact us", "privacy policy",
  "terms of service", "terms and conditions", "cookie", "about us",
  "home", "menu", "navigation", "search", "close", "open", "toggle",
];

function shouldSkipLink(href, text) {
  const hrefLower = (href || "").toLowerCase();
  const textLower = (text || "").toLowerCase();

  for (const pattern of SKIP_URL_PATTERNS) {
    if (hrefLower.includes(pattern)) return true;
  }
  for (const pattern of SKIP_TEXT_PATTERNS) {
    if (textLower === pattern || textLower.includes(pattern)) return true;
  }
  return false;
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

    const coins = await page.evaluate(() => {
      const results = [];

      // Strategy 1: WooCommerce product listings
      const wooProducts = document.querySelectorAll(
        ".product, .woocommerce-loop-product, .type-product"
      );
      if (wooProducts.length > 0) {
        wooProducts.forEach((el) => {
          const nameEl =
            el.querySelector(".woocommerce-loop-product__title") ||
            el.querySelector(".product-title") ||
            el.querySelector("h2") ||
            el.querySelector("h3");
          const linkEl = el.querySelector("a[href]");
          const priceEl =
            el.querySelector(".price") ||
            el.querySelector(".woocommerce-Price-amount");
          const imgEl = el.querySelector("img");

          if (nameEl) {
            results.push({
              name: nameEl.textContent.trim(),
              url: linkEl ? linkEl.href : "",
              price: priceEl ? priceEl.textContent.trim() : "",
              image: imgEl ? imgEl.src : "",
            });
          }
        });
      }

      // Strategy 2: Generic product cards / listing items
      if (results.length === 0) {
        const cards = document.querySelectorAll(
          ".product-card, .listing-item, .coin-item, .item-card, article.post, .wp-block-post"
        );
        cards.forEach((el) => {
          const nameEl =
            el.querySelector("h2, h3, h4, .title, .name, .product-name");
          const linkEl = el.querySelector("a[href]");
          const priceEl = el.querySelector(
            ".price, .amount, .cost, [class*='price']"
          );
          const imgEl = el.querySelector("img");

          if (nameEl) {
            results.push({
              name: nameEl.textContent.trim(),
              url: linkEl ? linkEl.href : "",
              price: priceEl ? priceEl.textContent.trim() : "",
              image: imgEl ? imgEl.src : "",
            });
          }
        });
      }

      // Strategy 3: Look for any links that look like coin product pages
      if (results.length === 0) {
        const allLinks = document.querySelectorAll("a[href]");
        const seen = new Set();
        allLinks.forEach((a) => {
          const href = a.href;
          const text = a.textContent.trim();
          // Skip navigation, login, generic links
          if (
            !text ||
            text.length < 5 ||
            text.length > 200 ||
            seen.has(href) ||
            href.includes("login") ||
            href.includes("register") ||
            href.includes("cart") ||
            href.includes("account") ||
            href.includes("wp-admin") ||
            href === window.location.href
          ) {
            return;
          }
          // Look for links that seem like coin/product pages
          if (
            href.includes("/product") ||
            href.includes("/coin") ||
            href.includes("proof") ||
            href.includes("silver") ||
            href.includes("gold") ||
            href.includes("eagle") ||
            href.includes("dollar") ||
            href.includes("mint") ||
            href.includes("morgan") ||
            href.includes("peace") ||
            /\d{4}/.test(href)
          ) {
            seen.add(href);
            const imgEl = a.querySelector("img") || a.closest("div")?.querySelector("img");
            results.push({
              name: text.replace(/\s+/g, " "),
              url: href,
              price: "",
              image: imgEl ? imgEl.src : "",
            });
          }
        });
      }

      return results;
    });

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

  // Strategy 1: WooCommerce products
  $(".product, .woocommerce-loop-product, .type-product").each((_, el) => {
    const $el = $(el);
    const nameEl =
      $el.find(".woocommerce-loop-product__title").first() ||
      $el.find(".product-title").first() ||
      $el.find("h2").first() ||
      $el.find("h3").first();
    const name = nameEl.text().trim();
    const link = $el.find("a[href]").first().attr("href") || "";
    const price =
      $el.find(".price, .woocommerce-Price-amount").first().text().trim() || "";
    const image = $el.find("img").first().attr("src") || "";

    if (name && !shouldSkipLink(link, name)) {
      results.push({ name, url: link, price, image });
    }
  });

  // Strategy 2: Generic product cards
  if (results.length === 0) {
    $(
      ".product-card, .listing-item, .coin-item, .item-card, article.post, .wp-block-post"
    ).each((_, el) => {
      const $el = $(el);
      const name = $el
        .find("h2, h3, h4, .title, .name, .product-name")
        .first()
        .text()
        .trim();
      const link = $el.find("a[href]").first().attr("href") || "";
      const price = $el
        .find(".price, .amount, .cost, [class*='price']")
        .first()
        .text()
        .trim();
      const image = $el.find("img").first().attr("src") || "";

      if (name && !shouldSkipLink(link, name)) {
        results.push({ name, url: link, price, image });
      }
    });
  }

  // Strategy 3: Product-like links (with strict filtering)
  if (results.length === 0) {
    const seen = new Set();
    $("a[href]").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      const text = $a.text().trim().replace(/\s+/g, " ");

      if (
        !text ||
        text.length < 5 ||
        text.length > 200 ||
        seen.has(href) ||
        shouldSkipLink(href, text)
      ) {
        return;
      }

      // Only match links that look like actual coin product pages
      const hrefLower = href.toLowerCase();
      if (
        hrefLower.includes("/product") ||
        hrefLower.includes("proof") ||
        hrefLower.includes("silver") ||
        hrefLower.includes("gold") ||
        hrefLower.includes("eagle") ||
        hrefLower.includes("dollar") ||
        hrefLower.includes("morgan") ||
        hrefLower.includes("peace") ||
        hrefLower.includes("quarter") ||
        hrefLower.includes("penny") ||
        hrefLower.includes("nickel") ||
        hrefLower.includes("dime") ||
        hrefLower.includes("half-dollar") ||
        hrefLower.includes("bullion") ||
        hrefLower.includes("commemorative") ||
        hrefLower.includes("uncirculated") ||
        hrefLower.includes("burnished") ||
        hrefLower.includes("ogp") ||
        hrefLower.includes("coa") ||
        /\/\d{4}[-/]/.test(hrefLower)
      ) {
        seen.add(href);
        const image = $a.find("img").first().attr("src") || "";
        results.push({ name: text, url: href, price: "", image });
      }
    });
  }

  // Strategy 4: If still nothing, grab all links on the page for debug
  if (results.length === 0 && DEBUG) {
    console.log("  [debug] No coins found. All links on page:");
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim().replace(/\s+/g, " ");
      if (text && text.length > 2) {
        console.log(`    "${text}" -> ${href}`);
      }
    });
  }

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
