#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { PostBridgeClient, formatAccount } from "./post-bridge.js";

// Configuration
const CONFIG_PATH = new URL("./config.json", import.meta.url).pathname;

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("Warning: Could not load config.json", e.message);
  }
  return { asc: {}, postBridge: {} };
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

const config = loadConfig();
const VENDOR_NUMBER = process.env.ASC_VENDOR_NUMBER || config.asc?.vendorNumber || "92465427";

// Approximate exchange rates to USD (update periodically)
const USD_RATES = {
  USD: 1.0,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CNY: 0.14,
  AUD: 0.65,
  CAD: 0.74,
  CHF: 1.13,
  KRW: 0.00075,
  BRL: 0.20,
  MXN: 0.058,
  RUB: 0.011,
  INR: 0.012,
  TWD: 0.031,
  HKD: 0.13,
  SGD: 0.75,
  NZD: 0.61,
  SEK: 0.095,
  NOK: 0.093,
  DKK: 0.145,
  PLN: 0.25,
  CZK: 0.043,
  ILS: 0.27,
  KZT: 0.0022,
  RON: 0.22,
  ZAR: 0.055,
  TRY: 0.031,
  THB: 0.029,
  PHP: 0.018,
  IDR: 0.000063,
  MYR: 0.22,
  VND: 0.00004,
  CLP: 0.001,
  COP: 0.00024,
  PEN: 0.27,
  ARS: 0.001,
  EGP: 0.02,
  PKR: 0.0036,
  BGN: 0.55,
  HRK: 0.14,
  HUF: 0.0027,
  SAR: 0.27,
  AED: 0.27,
  QAR: 0.27,
  KWD: 3.25,
  OMR: 2.60,
  BHD: 2.65,
};

// Product type codes from Apple
const PRODUCT_TYPES = {
  "1": "Free or Paid App (Universal)",
  "1F": "Free iPhone/iPod App",
  "1T": "Paid iPhone/iPod App",
  "3F": "Free iPad App",
  "3T": "Paid iPad App",
  "7": "Update (Universal)",
  "7F": "Free Update",
  "7T": "Paid Update",
  F1: "Free Mac App",
  F3: "Free Mac App Update",
  F7: "Free Mac App Re-download",
  IA1: "In-App Purchase",
  IA9: "In-App Subscription",
  IAY: "Auto-Renewable Subscription",
  IAC: "Free Subscription",
  FI1: "Free In-App Purchase",
};

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function parseDate(dateArg) {
  if (!dateArg || dateArg === "yesterday") {
    return getYesterday();
  }
  // Validate YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
    return dateArg;
  }
  throw new Error(`Invalid date format: ${dateArg}. Use YYYY-MM-DD`);
}

function parseMonth(monthArg) {
  // Handle "last" for previous month
  if (monthArg === "last") {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // Validate YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(monthArg)) {
    return monthArg;
  }
  throw new Error(`Invalid month format: ${monthArg}. Use YYYY-MM or "last"`);
}

function getDatesInMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return dates;
}

function convertToUSD(amount, currency) {
  const rate = USD_RATES[currency] || 1.0;
  return amount * rate;
}

function getParentAppName(sku) {
  // Map SKUs to parent app names
  if (sku.includes("obsidianhealth")) return "Health.md";
  if (sku.includes("Sync-md")) return "Sync.md";
  if (sku.includes("Voxboard")) return "Voxboard";
  if (sku.includes("InstaReply")) return "Instarep.ly";
  if (sku.includes("imghost")) return "imghost";
  if (sku.includes("PocketREPL")) return "PocketREPL";
  return null;
}

function fetchSalesData(date) {
  const outputFile = `sales_report_${date}_SALES.tsv`;
  const gzFile = `${outputFile}.gz`;

  // Clean up any existing files
  [outputFile, gzFile].forEach((f) => {
    if (existsSync(f)) unlinkSync(f);
  });

  try {
    execSync(
      `asc analytics sales --vendor "${VENDOR_NUMBER}" --type SALES --subtype SUMMARY --frequency DAILY --date "${date}" --decompress`,
      { stdio: "pipe" }
    );

    if (!existsSync(outputFile)) {
      return null;
    }

    const content = readFileSync(outputFile, "utf-8");

    // Clean up files
    [outputFile, gzFile].forEach((f) => {
      if (existsSync(f)) unlinkSync(f);
    });

    return content;
  } catch (error) {
    console.error("Error fetching sales data:", error.message);
    return null;
  }
}

function parseTSV(tsvContent) {
  const lines = tsvContent.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t");
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split("\t");
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx]?.trim() || "";
    });
    rows.push(row);
  }

  return rows;
}

function aggregateSales(rows) {
  const apps = {};
  const countries = {};
  let totalRevenue = 0;
  let totalDownloads = 0;
  let totalIAP = 0;

  for (const row of rows) {
    const appName = row["Title"] || "Unknown";
    const units = parseInt(row["Units"]) || 0;
    const proceeds = parseFloat(row["Developer Proceeds"]) || 0;
    const countryCode = row["Country Code"] || "??";
    const productType = row["Product Type Identifier"] || "";
    const parentId = row["Parent Identifier"] || "";

    // Check if it's an IAP/subscription
    const isIAP = productType.startsWith("IA");
    
    // For IAPs, attribute to parent app if we can find it
    // The Parent Identifier contains the parent app's SKU
    let targetApp = appName;
    if (isIAP && parentId) {
      // Find the parent app name by SKU in existing rows or use a lookup
      const parentRow = rows.find(r => r["SKU"] === parentId);
      if (parentRow) {
        targetApp = parentRow["Title"];
      }
    }

    // Initialize app stats (skip IAP-only entries as separate apps)
    if (!apps[targetApp] && !isIAP) {
      apps[targetApp] = {
        downloads: 0,
        revenue: 0,
        iapCount: 0,
        countries: new Set(),
      };
    } else if (!apps[targetApp] && isIAP) {
      // IAP for an app we haven't seen - create entry
      apps[targetApp] = {
        downloads: 0,
        revenue: 0,
        iapCount: 0,
        countries: new Set(),
      };
    }

    // Determine if this is a new download (not update/re-download)
    // 1F, 1T = iPhone app, 3F, 3T = iPad app, F1 = Mac app
    // 7F, 7T, F7 = updates/re-downloads (exclude)
    const isNewDownload = 
      productType === "1F" || productType === "1T" || productType === "1" ||
      productType === "3F" || productType === "3T" ||
      productType === "F1";

    if (isIAP) {
      apps[targetApp].iapCount += units;
      apps[targetApp].revenue += proceeds;
      totalIAP += units;
      totalRevenue += proceeds;
    } else if (isNewDownload) {
      apps[targetApp].downloads += units;
      totalDownloads += units;
    }

    apps[targetApp].countries.add(countryCode);

    // Track country downloads (only new downloads)
    if (isNewDownload) {
      if (!countries[countryCode]) {
        countries[countryCode] = 0;
      }
      countries[countryCode] += units;
    }
  }

  // Convert country Sets to counts
  Object.keys(apps).forEach((app) => {
    apps[app].countryCount = apps[app].countries.size;
    delete apps[app].countries;
  });

  // Sort countries by downloads
  const topCountries = Object.entries(countries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    apps,
    topCountries,
    totalRevenue,
    totalDownloads,
    totalIAP,
  };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function getCountryFlag(code) {
  const flags = {
    US: "🇺🇸",
    JP: "🇯🇵",
    CN: "🇨🇳",
    GB: "🇬🇧",
    DE: "🇩🇪",
    FR: "🇫🇷",
    KR: "🇰🇷",
    BR: "🇧🇷",
    CA: "🇨🇦",
    AU: "🇦🇺",
    NL: "🇳🇱",
    SG: "🇸🇬",
    VN: "🇻🇳",
    TW: "🇹🇼",
    HK: "🇭🇰",
    IN: "🇮🇳",
    MX: "🇲🇽",
    ES: "🇪🇸",
    IT: "🇮🇹",
    RU: "🇷🇺",
    PL: "🇵🇱",
    TH: "🇹🇭",
    MY: "🇲🇾",
    PH: "🇵🇭",
    ID: "🇮🇩",
    NZ: "🇳🇿",
    ZA: "🇿🇦",
    BE: "🇧🇪",
    PT: "🇵🇹",
    KZ: "🇰🇿",
    PK: "🇵🇰",
    JO: "🇯🇴",
  };
  return flags[code] || "🌍";
}

// App-specific emojis (customize these)
const APP_EMOJIS = {
  "Sync.md": "📝",
  "Health.md": "❤️",
  "Instarep.ly": "💬",
  "Voxboard": "🎙️",
  "PocketREPL": "💻",
  "imghost": "🖼️",
};

// Prevent Twitter from auto-linking app names that look like URLs
// Replace "." with "․" (one dot leader) which looks identical but won't trigger links
function sanitizeForTwitter(name) {
  return name.replace(/\./g, "․");
}

function generateTweet(date, stats) {
  const { apps, topCountries, totalRevenue, totalDownloads, totalIAP } = stats;

  // Format date nicely
  const dateObj = new Date(date + "T00:00:00");
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  // Filter to actual apps (exclude IAP-only entries)
  const appEntries = Object.entries(apps)
    .filter(([_, data]) => data.downloads > 0)
    .sort((a, b) => b[1].downloads - a[1].downloads);

  // Opening line - Marc Lou style
  let tweet = ``;
  
  if (totalDownloads === 0 && totalRevenue === 0) {
    tweet = `App Store ${formattedDate} — No sales data.`;
    return tweet;
  }

  // Header - Marc Lou style "I made $X on <day>"
  if (totalRevenue > 0) {
    tweet = `I made ${formatCurrency(totalRevenue)} on ${formattedDate}.\n\n`;
  } else {
    tweet = `${totalDownloads} downloads on ${formattedDate}.\n\n`;
  }

  // App breakdown - emoji + name + em dash + stats
  const appLines = appEntries.map(([name, data]) => {
    const emoji = APP_EMOJIS[name] || "📱";
    const safeName = sanitizeForTwitter(name);
    let line = `${emoji} ${safeName} — ${data.downloads} download${data.downloads !== 1 ? "s" : ""}`;
    if (data.revenue > 0) {
      line += ` (${formatCurrency(data.revenue)})`;
    }
    return line;
  });

  tweet += appLines.join("\n");

  return tweet;
}

function generateJSON(date, stats) {
  return {
    date,
    generatedAt: new Date().toISOString(),
    summary: {
      totalDownloads: stats.totalDownloads,
      totalRevenue: stats.totalRevenue,
      totalIAP: stats.totalIAP,
    },
    apps: stats.apps,
    topCountries: stats.topCountries.map(([code, count]) => ({
      country: code,
      downloads: count,
    })),
  };
}

// Monthly aggregation with USD conversion
async function fetchMonthlyData(yearMonth) {
  const dates = getDatesInMonth(yearMonth);
  const appStats = {};
  const countryStats = {};
  let totalDownloads = 0;
  let totalRevenueUSD = 0;
  let totalUnitsSold = 0;
  let daysWithData = 0;

  console.error(`Fetching daily sales for ${yearMonth}...`);

  for (const date of dates) {
    process.stderr.write(`  ${date}...`);
    const tsv = fetchSalesData(date);
    
    if (!tsv) {
      console.error(" no data");
      continue;
    }
    
    daysWithData++;
    const rows = parseTSV(tsv);
    let dayDownloads = 0;
    let dayRevenue = 0;
    
    for (const row of rows) {
      let appName = row["Title"] || "Unknown";
      const units = parseInt(row["Units"]) || 0;
      const proceeds = parseFloat(row["Developer Proceeds"]) || 0;
      const currency = row["Currency of Proceeds"] || "USD";
      const productType = row["Product Type Identifier"] || "";
      const sku = row["SKU"] || "";
      const countryCode = row["Country Code"] || "??";
      
      // Attribute IAPs to parent app
      const parentApp = getParentAppName(sku);
      if (parentApp) appName = parentApp;
      
      if (!appStats[appName]) {
        appStats[appName] = { downloads: 0, unitsSold: 0, revenueUSD: 0, countries: new Set() };
      }
      
      const isIAP = productType.startsWith("IA");
      const isNewDownload = ["1F", "1T", "1", "3F", "3T", "F1"].includes(productType);
      
      // Convert proceeds to USD
      const proceedsUSD = convertToUSD(proceeds, currency);
      
      if (proceeds !== 0) {
        appStats[appName].unitsSold += units;
        appStats[appName].revenueUSD += proceedsUSD;
        totalUnitsSold += units;
        totalRevenueUSD += proceedsUSD;
        dayRevenue += proceedsUSD;
      }
      
      if (isNewDownload) {
        appStats[appName].downloads += units;
        totalDownloads += units;
        dayDownloads += units;
        appStats[appName].countries.add(countryCode);
        
        // Track country downloads
        if (!countryStats[countryCode]) countryStats[countryCode] = 0;
        countryStats[countryCode] += units;
      }
    }
    
    console.error(` ${dayDownloads} downloads, $${dayRevenue.toFixed(2)}`);
  }

  // Convert country Sets to counts
  Object.keys(appStats).forEach((app) => {
    appStats[app].countryCount = appStats[app].countries.size;
    delete appStats[app].countries;
  });

  // Sort countries by downloads
  const topCountries = Object.entries(countryStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    month: yearMonth,
    daysWithData,
    apps: appStats,
    topCountries,
    totalDownloads,
    totalUnitsSold,
    totalRevenueUSD,
  };
}

function generateMonthlyTweet(stats) {
  const { month, apps, totalDownloads, totalRevenueUSD } = stats;
  
  // Format month nicely
  const [year, monthNum] = month.split("-");
  const monthName = new Date(year, monthNum - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Filter to apps with downloads or revenue
  const appEntries = Object.entries(apps)
    .filter(([_, data]) => data.downloads > 0 || data.revenueUSD > 0)
    .sort((a, b) => b[1].revenueUSD - a[1].revenueUSD || b[1].downloads - a[1].downloads);

  if (totalDownloads === 0 && totalRevenueUSD === 0) {
    return `${monthName} App Store recap — No sales data.`;
  }

  // Header
  let tweet = `${monthName} App Store recap:\n\n`;
  
  if (totalRevenueUSD > 0) {
    tweet = `I made ${formatCurrency(totalRevenueUSD)} in ${monthName}.\n\n`;
  }

  // App breakdown
  const appLines = appEntries.map(([name, data]) => {
    const emoji = APP_EMOJIS[name] || "📱";
    const safeName = sanitizeForTwitter(name);
    let line = `${emoji} ${safeName} — ${data.downloads} downloads`;
    if (data.revenueUSD > 0) {
      line += ` (${formatCurrency(data.revenueUSD)})`;
    }
    return line;
  });

  tweet += appLines.join("\n");

  return tweet;
}

function generateMonthlyJSON(stats) {
  return {
    month: stats.month,
    generatedAt: new Date().toISOString(),
    daysWithData: stats.daysWithData,
    summary: {
      totalDownloads: stats.totalDownloads,
      totalUnitsSold: stats.totalUnitsSold,
      totalRevenueUSD: Math.round(stats.totalRevenueUSD * 100) / 100,
    },
    apps: Object.fromEntries(
      Object.entries(stats.apps).map(([name, data]) => [
        name,
        {
          downloads: data.downloads,
          unitsSold: data.unitsSold,
          revenueUSD: Math.round(data.revenueUSD * 100) / 100,
          countryCount: data.countryCount,
        },
      ])
    ),
    topCountries: stats.topCountries.map(([code, count]) => ({
      country: code,
      downloads: count,
    })),
  };
}

// Main
async function main() {
  const args = process.argv.slice(2);
  let date = getYesterday();
  let month = null;
  let outputFormat = "tweet"; // tweet, json, or both
  let shouldPost = false;
  let accountIds = config.postBridge?.defaultAccountId 
    ? [config.postBridge.defaultAccountId] 
    : [];
  let listAccounts = false;
  let setupApiKey = false;
  let isDraft = false;

  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date" && args[i + 1]) {
      date = parseDate(args[i + 1]);
      i++;
    } else if (args[i] === "--month" && args[i + 1]) {
      month = parseMonth(args[i + 1]);
      i++;
    } else if (args[i] === "--json") {
      outputFormat = "json";
    } else if (args[i] === "--all") {
      outputFormat = "all";
    } else if (args[i] === "--post") {
      shouldPost = true;
    } else if (args[i] === "--draft") {
      shouldPost = true;
      isDraft = true;
    } else if (args[i] === "--account" && args[i + 1]) {
      accountIds = args[i + 1].split(",").map(id => parseInt(id.trim()));
      i++;
    } else if (args[i] === "--accounts") {
      listAccounts = true;
    } else if (args[i] === "--setup") {
      setupApiKey = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  // Setup API key
  if (setupApiKey) {
    await runSetup();
    return;
  }

  // List accounts
  if (listAccounts) {
    await listConnectedAccounts();
    return;
  }

  // Monthly mode
  if (month) {
    const stats = await fetchMonthlyData(month);
    const tweet = generateMonthlyTweet(stats);

    // Output
    if (outputFormat === "json") {
      console.log(JSON.stringify(generateMonthlyJSON(stats), null, 2));
    } else if (outputFormat === "all") {
      const data = generateMonthlyJSON(stats);
      data.tweet = tweet;
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(tweet);
    }

    // Post if requested
    if (shouldPost) {
      await postToSocial(tweet, accountIds, isDraft);
    }
    return;
  }

  console.error(`Fetching sales data for ${date}...`);

  const tsvContent = fetchSalesData(date);
  if (!tsvContent) {
    console.error("No sales data available for this date.");
    process.exit(1);
  }

  const rows = parseTSV(tsvContent);
  const stats = aggregateSales(rows);
  const tweet = generateTweet(date, stats);

  // Output
  if (outputFormat === "json") {
    console.log(JSON.stringify(generateJSON(date, stats), null, 2));
  } else if (outputFormat === "all") {
    const data = generateJSON(date, stats);
    data.tweet = tweet;
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(tweet);
  }

  // Post if requested
  if (shouldPost) {
    await postToSocial(tweet, accountIds, isDraft);
  }
}

function printHelp() {
  console.log(`
ASC Daily Sales Check - Generate tweet-ready App Store sales summaries

Usage: node daily-sales.js [options]

Options:
  --date <YYYY-MM-DD>  Fetch sales for a specific date (default: yesterday)
  --month <YYYY-MM>    Fetch and aggregate sales for an entire month
                       Use "last" for previous month
  --json               Output as JSON
  --all                Output JSON with tweet included
  --post               Post to connected social accounts
  --draft              Create as draft instead of posting
  --account <id,id>    Specify account IDs to post to (comma-separated)
  --accounts           List connected Post Bridge social accounts
  --setup              Configure Post Bridge API key
  --help, -h           Show this help

Examples:
  node daily-sales.js                          # Generate tweet for yesterday
  node daily-sales.js --date 2026-04-04        # Specific date
  node daily-sales.js --month 2026-03          # March 2026 summary
  node daily-sales.js --month last             # Previous month summary
  node daily-sales.js --month last --json      # Monthly summary as JSON
  node daily-sales.js --month last --post      # Post monthly summary
  node daily-sales.js --post                   # Generate and post
  node daily-sales.js --post --account 123     # Post to specific account
  node daily-sales.js --accounts               # List available accounts
  node daily-sales.js --setup                  # Configure API key
`);
}

async function runSetup() {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) =>
    new Promise((resolve) => rl.question(prompt, resolve));

  console.log("\n🔧 ASC Daily Check Setup\n");
  console.log("You need a Post Bridge API key to post to social platforms.");
  console.log("Get your key from: https://post-bridge.com\n");

  const apiKey = await question("Enter your Post Bridge API key: ");

  if (apiKey.trim()) {
    config.postBridge = config.postBridge || {};
    config.postBridge.apiKey = apiKey.trim();
    saveConfig(config);
    console.log("\n✅ API key saved to config.json");

    // List accounts so user can set default
    console.log("\nFetching connected accounts...\n");
    try {
      const client = new PostBridgeClient(apiKey.trim());
      const accounts = await client.listAccounts();

      if (accounts.length === 0) {
        console.log("No accounts connected. Connect accounts at https://post-bridge.com");
      } else {
        console.log("Connected accounts:");
        accounts.forEach((acc) => console.log(`  ${formatAccount(acc)}`));

        const defaultId = await question(
          "\nEnter default account ID for daily posts (or press Enter to skip): "
        );
        if (defaultId.trim()) {
          config.postBridge.defaultAccountId = parseInt(defaultId.trim());
          saveConfig(config);
          console.log("\n✅ Default account saved");
        }
      }
    } catch (e) {
      console.error("Error fetching accounts:", e.message);
    }
  }

  rl.close();
}

async function listConnectedAccounts() {
  const apiKey = config.postBridge?.apiKey;
  if (!apiKey) {
    console.error("Post Bridge not configured. Run: node daily-sales.js --setup");
    process.exit(1);
  }

  try {
    const client = new PostBridgeClient(apiKey);
    const accounts = await client.listAccounts();

    if (accounts.length === 0) {
      console.log("No accounts connected.");
      console.log("Connect accounts at https://post-bridge.com");
    } else {
      console.log("\nConnected accounts:\n");
      accounts.forEach((acc) => console.log(`  ${formatAccount(acc)}`));
      
      if (config.postBridge?.defaultAccountId) {
        console.log(`\nDefault account: ${config.postBridge.defaultAccountId}`);
      }
      console.log("\nUse --account <id> to post to a specific account");
    }
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}

async function postToSocial(tweet, accountIds, isDraft = false) {
  const apiKey = config.postBridge?.apiKey;
  if (!apiKey) {
    console.error("\n❌ Post Bridge not configured. Run: node daily-sales.js --setup");
    process.exit(1);
  }

  if (!accountIds || accountIds.length === 0) {
    console.error("\n❌ No account specified. Use --account <id> or set a default with --setup");
    console.error("   Run: node daily-sales.js --accounts to see available accounts");
    process.exit(1);
  }

  try {
    const client = new PostBridgeClient(apiKey);
    console.error(`\n${isDraft ? "📝 Creating draft" : "📤 Posting"} to account(s): ${accountIds.join(", ")}...`);

    const result = await client.createPost({
      caption: tweet,
      accountIds,
      isDraft,
    });

    if (isDraft) {
      console.error(`✅ Draft created! Post ID: ${result.id}`);
    } else {
      console.error(`✅ Posted! Post ID: ${result.id}`);
      
      // Wait a moment and check results
      await new Promise((r) => setTimeout(r, 2000));
      const results = await client.getPostResults(result.id);
      
      for (const r of results) {
        if (r.success) {
          console.error(`   ✓ ${r.platformData?.url || "Success"}`);
        } else {
          console.error(`   ✗ Failed: ${r.error?.message || "Unknown error"}`);
        }
      }
    }
  } catch (e) {
    console.error("\n❌ Failed to post:", e.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
