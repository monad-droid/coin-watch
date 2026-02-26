const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const COINS_FILE = path.join(DATA_DIR, "coins.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadCoins() {
  ensureDataDir();
  if (!fs.existsSync(COINS_FILE)) {
    return {};
  }
  const raw = fs.readFileSync(COINS_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveCoins(coins) {
  ensureDataDir();
  fs.writeFileSync(COINS_FILE, JSON.stringify(coins, null, 2), "utf-8");
}

/**
 * Compare scraped coins against stored coins.
 * Returns { newCoins, removedCoins, allCoins }
 *
 * Each coin object: { name, url, price?, image?, description? }
 * Coins are keyed by URL for deduplication.
 */
function compareCoins(scrapedCoins) {
  const stored = loadCoins();
  const storedUrls = new Set(Object.keys(stored));
  const scrapedMap = {};

  for (const coin of scrapedCoins) {
    const key = coin.url || coin.name;
    scrapedMap[key] = {
      ...coin,
      firstSeen: stored[key]?.firstSeen || new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
  }

  const scrapedUrls = new Set(Object.keys(scrapedMap));

  const newCoins = [];
  for (const url of scrapedUrls) {
    if (!storedUrls.has(url)) {
      newCoins.push(scrapedMap[url]);
    }
  }

  const removedCoins = [];
  for (const url of storedUrls) {
    if (!scrapedUrls.has(url)) {
      removedCoins.push(stored[url]);
    }
  }

  // Merge: keep all scraped coins, preserve firstSeen from stored
  const allCoins = { ...scrapedMap };

  return { newCoins, removedCoins, allCoins };
}

/**
 * Process a scrape result: compare, save, return changes.
 */
function processUpdate(scrapedCoins) {
  const result = compareCoins(scrapedCoins);
  saveCoins(result.allCoins);
  return result;
}

/**
 * Check if this is the very first run (no stored data).
 */
function isFirstRun() {
  return !fs.existsSync(COINS_FILE);
}

module.exports = { loadCoins, saveCoins, compareCoins, processUpdate, isFirstRun };
