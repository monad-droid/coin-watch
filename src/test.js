/**
 * Simple test to verify modules load correctly and store logic works.
 */
const { compareCoins, saveCoins, loadCoins, isFirstRun } = require("./store");
const { notify } = require("./notifier");
const fs = require("fs");
const path = require("path");

const TEST_FILE = path.join(__dirname, "..", "data", "coins.json");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

async function runTests() {
  console.log("Running tests...\n");

  // Clean up any existing test data
  if (fs.existsSync(TEST_FILE)) {
    fs.unlinkSync(TEST_FILE);
  }

  // Test 1: First run detection
  assert(isFirstRun() === true, "isFirstRun() returns true when no data file");

  // Test 2: Compare with no stored data (first run scenario)
  const coins1 = [
    { name: "2025 Silver Eagle", url: "https://example.com/silver-eagle", price: "$50" },
    { name: "2025 Gold Eagle", url: "https://example.com/gold-eagle", price: "$2000" },
  ];

  const result1 = compareCoins(coins1);
  assert(result1.newCoins.length === 2, "First run: all coins are new");
  assert(result1.removedCoins.length === 0, "First run: no removed coins");

  // Save the coins
  saveCoins(result1.allCoins);
  assert(isFirstRun() === false, "isFirstRun() returns false after saving");

  // Test 3: Same coins, no changes
  const result2 = compareCoins(coins1);
  assert(result2.newCoins.length === 0, "Same coins: no new coins");
  assert(result2.removedCoins.length === 0, "Same coins: no removed coins");

  // Test 4: One new coin added
  const coins2 = [
    ...coins1,
    { name: "2025 Morgan Dollar", url: "https://example.com/morgan", price: "$75" },
  ];
  saveCoins(result2.allCoins);
  const result3 = compareCoins(coins2);
  assert(result3.newCoins.length === 1, "One new coin detected");
  assert(result3.newCoins[0].name === "2025 Morgan Dollar", "Correct new coin name");

  // Test 5: One coin removed
  const coins3 = [coins1[0]]; // Only Silver Eagle
  saveCoins(result3.allCoins);
  const result4 = compareCoins(coins3);
  assert(result4.removedCoins.length === 2, "Two coins removed");
  assert(result4.newCoins.length === 0, "No new coins when removing");

  // Test 6: Console notification
  process.env.NOTIFY_METHODS = "console";
  await notify([
    { name: "Test Coin", url: "https://example.com/test", price: "$100" },
  ]);
  assert(true, "Console notification runs without error");

  // Test 7: Load saved coins
  saveCoins(result4.allCoins);
  const loaded = loadCoins();
  assert(Object.keys(loaded).length === 1, "Loaded coins has correct count");

  // Cleanup
  if (fs.existsSync(TEST_FILE)) {
    fs.unlinkSync(TEST_FILE);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
