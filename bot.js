// ============================================================
//  CHECKPOINT EXCHANGE TESTNET AUTO BOT (CommonJS)
//  Multi-Wallet | Arbitrum Sepolia | Gas Sponsored
// ============================================================

const ethers = require("ethers");
const axios = require("axios");
const accounts  = require('evm_accounts');
const fs = require("fs");
const path = require("path");

// ============================================================
//  CONFIG
// ============================================================
const CONFIG = {
  rpc: "https://arbitrum-sepolia.publicnode.com/",
  chainId: 421614,

  contracts: {
    market:    "0xf2869aCE6170F7Ab1aba1C55a3483eD7E2f8AaAE",
    usdc:      "0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773",
    deposit:   "0xE98C0EbF9B251d534c58DAC4e042FB5b827A00bE",
    registry:  "0xC9b2b7138ECF35f980036BbDB466d8e6437B4d9F",
    settlement:"0x15dfE078EAF103640e85B0e120E138E73D639C70",
  },

  api: {
    market: "https://checkpoint-data-market-api.dorimebest.workers.dev",
    oracle: "https://oracle.checkpoint.exchange",
  },

  protocols: {
    1: "Jumper XP",
    2: "DeBridge S2",
    3: "DeBridge S3",
    4: "Galxe",
    5: "Checkpoint",
    6: "Blockscout",
    7: "Cap",
  },

  // Trading params
  maxUsdcPerTrade: 5000000,      // 5 USDC (6 decimals)
  buyDiscountPct:  5.0,          // buy 5% below best price
  sellPremiumPct:  10.0,         // sell 10% above buy price
  maxPositions:    10,
  pollInterval:    30000,         // ms
  minPointsWei:    ethers.BigNumber.from("100000000000000000"), // 0.1 pts
  txGas:           500000,
  maxCycles:       999,
};

// ============================================================
//  ABI
// ============================================================
const ABI = {
  market: JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "market.json"), "utf8")),
  erc20:  JSON.parse(fs.readFileSync(path.join(__dirname, "abi", "erc20.json"),  "utf8")),
};

// ============================================================
//  LOGGER
// ============================================================
const COLORS = {
  reset:   "\x1b[0m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  gray:    "\x1b[90m",
  bold:    "\x1b[1m",
};

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function log(msg, level = "INFO") {
  const c = { INFO: COLORS.cyan, TRADE: COLORS.green, ERROR: COLORS.red, DRY: COLORS.yellow, WARN: COLORS.yellow, OK: COLORS.green };
  console.log(`${c[level] || ""}[${ts()}] [${level}]${COLORS.reset} ${msg}`);
}

// ============================================================
//  LOAD WALLETS
// ============================================================
function loadWallets(filePath) {
  const resolved = path.resolve(filePath || "privatekey.txt");
  if (!fs.existsSync(resolved)) {
    log(`File not found: ${resolved}`, "ERROR");
    log("Create privatekey.txt with one private key per line:", "INFO");
    log("  0xabc123...", "INFO");
    log("  0xdef456...", "INFO");
    process.exit(1);
  }

  const lines = fs.readFileSync(resolved, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#") && l.length >= 64);

  if (lines.length === 0) {
    log("No valid private keys found in " + resolved, "ERROR");
    process.exit(1);
  }

  const wallets = [];
  for (const raw of lines) {
    try {
      const key = raw.startsWith("0x") ? raw : "0x" + raw;
      const w = new ethers.Wallet(key);
      const account  = accounts.wallets(key);
      wallets.push({ key, address: w.address });
      log(`Loaded wallet: ${w.address}`);
    } catch (e) {
      log(`Invalid key: ${raw.substring(0, 10)}...`, "WARN");
    }
  }

  log(`Total wallets: ${wallets.length}`);
  return wallets;
}

// ============================================================
//  API CLIENT
// ============================================================
async function apiGet(url) {
  const { data } = await axios.get(url, { timeout: 15000 });
  return data;
}

async function getMarkets() {
  const d = await apiGet(`${CONFIG.api.market}/market/overview`);
  return d.markets;
}

async function getOffers(pointsId) {
  const d = await apiGet(`${CONFIG.api.market}/market/${pointsId}/offers`);
  return d.offers || [];
}

async function getStats() {
  return apiGet(`${CONFIG.api.market}/market/global-stats`);
}

// ============================================================
//  HELPERS
// ============================================================
function toUsdcWei(usdc) {
  return ethers.BigNumber.from(Math.floor(usdc * 1e6));
}

function fromUsdcWei(bn) {
  return parseFloat(ethers.utils.formatUnits(bn, 6));
}

function fromPtsWei(bn) {
  return parseFloat(ethers.utils.formatUnits(bn, 18));
}

function erc7930(address) {
  const addr = address.toLowerCase().replace("0x", "");
  return "0x000100000014" + addr;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

// ============================================================
//  WALLET AGENT (single wallet worker)
// ============================================================
class WalletAgent {
  constructor(walletInfo, index) {
    this.key = walletInfo.key;
    this.address = walletInfo.address;
    this.index = index;
    this.label = `[W${index}|${this.address.slice(0, 8)}]`;

    this.provider = new ethers.providers.JsonRpcProvider(CONFIG.rpc);
    this.signer = new ethers.Wallet(this.key, this.provider);

    this.market = new ethers.Contract(CONFIG.contracts.market, ABI.market, this.signer);
    this.usdc = new ethers.Contract(CONFIG.contracts.usdc, ABI.erc20, this.signer);

    this.trades = 0;
    this.spent = 0;
  }

  async getBalance() {
    try {
      return await this.usdc.balanceOf(this.address);
    } catch {
      return ethers.BigNumber.from(0);
    }
  }

  async ensureApproval() {
    try {
      const current = await this.usdc.allowance(this.address, CONFIG.contracts.market);
      if (current.gt(ethers.BigNumber.from("1000000000000"))) return true;

      log(`${this.label} Approving USDC...`);
      const tx = await this.usdc.approve(CONFIG.contracts.market, ethers.constants.MaxUint256, {
        gasLimit: 100000,
      });
      const rc = await tx.wait(1);
      if (rc.status === 1) {
        log(`${this.label} USDC approved! TX: ${rc.transactionHash}`, "OK");
        return true;
      }
      return false;
    } catch (e) {
      log(`${this.label} Approval error: ${e.message}`, "ERROR");
      return false;
    }
  }

  async fillOffer(offerId, amount) {
    try {
      let tx;
      if (amount) {
        tx = await this.market.fillOfferPartial(offerId, amount, { gasLimit: CONFIG.txGas });
      } else {
        tx = await this.market.fillOffer(offerId, { gasLimit: CONFIG.txGas });
      }
      const rc = await tx.wait(1);
      if (rc.status === 1) {
        log(`${this.label} Filled offer #${offerId} | TX: ${rc.transactionHash}`, "TRADE");
        this.trades++;
        return true;
      }
      log(`${this.label} Fill REVERTED #${offerId}`, "ERROR");
      return false;
    } catch (e) {
      log(`${this.label} Fill error #${offerId}: ${e.reason || e.message}`, "ERROR");
      return false;
    }
  }

  async createOffer(pointsId, ptsWei, priceWei, collateralWei) {
    try {
      const tx = await this.market.createOffer(
        pointsId,
        erc7930(this.address),
        ptsWei,
        priceWei,
        collateralWei,
        { gasLimit: CONFIG.txGas }
      );
      const rc = await tx.wait(1);
      if (rc.status === 1) {
        log(`${this.label} Created offer | TX: ${rc.transactionHash}`, "TRADE");
        this.trades++;
        return true;
      }
      return false;
    } catch (e) {
      log(`${this.label} CreateOffer error: ${e.reason || e.message}`, "ERROR");
      return false;
    }
  }

  async cancelOffer(offerId) {
    try {
      const tx = await this.market.cancelOffer(offerId, { gasLimit: CONFIG.txGas });
      const rc = await tx.wait(1);
      if (rc.status === 1) {
        log(`${this.label} Cancelled offer #${offerId}`, "OK");
        return true;
      }
      return false;
    } catch (e) {
      log(`${this.label} Cancel error: ${e.reason || e.message}`, "ERROR");
      return false;
    }
  }
}

// ============================================================
//  STRATEGIES
// ============================================================

// --- ACTIVITY: fill random offers across markets ---
async function strategyActivity(agents) {
  log("=".repeat(60));
  log("STRATEGY: Activity Generator (Multi-Wallet)");
  log(`Wallets: ${agents.length}`);
  log("=".repeat(60));

  // Print balances
  for (const a of agents) {
    const bal = await a.getBalance();
    log(`${a.label} USDC: $${fromUsdcWei(bal).toFixed(4)}`);
    await a.ensureApproval();
  }

  let cycle = 0;
  while (cycle < CONFIG.maxCycles) {
    cycle++;
    log(`\n--- Cycle ${cycle} ---`);

    try {
      const stats = await getStats();
      log(`Global: ${stats.activeOffers} offers | $${parseFloat(stats.totalVolume).toLocaleString()} vol`);

      const markets = await getMarkets();
      const active = markets.filter(m => parseInt(m.activeOffers) > 0);
      if (!active.length) { log("No active markets"); await sleep(30000); continue; }

      // Each wallet picks a different random market
      const promises = agents.map(async (agent) => {
        try {
          // Weighted random market
          const weights = active.map(m => parseInt(m.activeOffers));
          const total = weights.reduce((a, b) => a + b, 0);
          let r = Math.random() * total;
          let picked = active[0];
          for (let i = 0; i < active.length; i++) {
            r -= weights[i];
            if (r <= 0) { picked = active[i]; break; }
          }

          const pid = parseInt(picked.pointsId);
          const proto = CONFIG.protocols[pid] || `P${pid}`;
          const best = parseFloat(picked.bestPrice);

          // Get offers
          const offers = await getOffers(pid);
          const openOffers = offers.filter(o => parseInt(o.status) === 0);
          if (!openOffers.length) return;

          // Pick random offer
          const offer = openOffers[randInt(0, openOffers.length - 1)];
          const oid = parseInt(offer.id);
          const pts = ethers.BigNumber.from(offer.pointsAmount);
          const price = ethers.BigNumber.from(offer.price);
          const filled = ethers.BigNumber.from(offer.filledAmount || "0");
          const remaining = price.sub(filled);

          if (pts.lt(CONFIG.minPointsWei)) return;

          const ptsFloat = fromPtsWei(pts);
          const ppp = fromUsdcWei(price) / ptsFloat;

          // Fill with small amount
          const bal = await agent.getBalance();
          let maxFill = remaining.lt(bal) ? remaining : bal;
          if (maxFill.gt(toUsdcWei(10))) maxFill = toUsdcWei(10);
          if (maxFill.lt(100000)) return; // min 0.1 USDC

          const fillPct = randFloat(0.1, 0.8);
          const fillAmt = maxFill.mul(Math.floor(fillPct * 1000)).div(1000);
          if (fillAmt.lt(100000)) return;

          log(`${agent.label} ${proto} | Offer #${oid} | ${ptsFloat.toFixed(2)} pts @ $${ppp.toFixed(2)} | Fill: $${fromUsdcWei(fillAmt).toFixed(4)}`);

          await agent.fillOffer(oid, fillAmt);
          agent.spent += fromUsdcWei(fillAmt);
        } catch (e) {
          log(`${agent.label} Error: ${e.message}`, "ERROR");
        }
      });

      await Promise.all(promises);

    } catch (e) {
      log(`Cycle error: ${e.message}`, "ERROR");
    }

    const delay = randInt(15, 45) * 1000;
    log(`Next cycle in ${delay / 1000}s...`);
    await sleep(delay);
  }
}

// --- ARB: buy below market price ---
async function strategyArb(agents) {
  log("=".repeat(60));
  log("STRATEGY: Arbitrage (Multi-Wallet)");
  log("=".repeat(60));

  for (const a of agents) {
    await a.ensureApproval();
  }

  let cycle = 0;
  while (cycle < CONFIG.maxCycles) {
    cycle++;
    log(`\n--- Cycle ${cycle} ---`);

    try {
      const markets = await getMarkets();
      const bestPrices = {};
      for (const m of markets) {
        const pid = parseInt(m.pointsId);
        const bp = parseFloat(m.bestPrice);
        if (bp > 0) bestPrices[pid] = bp;
      }

      const opportunities = [];
      for (const [pidStr, best] of Object.entries(bestPrices)) {
        const pid = parseInt(pidStr);
        const offers = await getOffers(pid);
        for (const o of offers) {
          if (parseInt(o.status) !== 0) continue;
          const pts = ethers.BigNumber.from(o.pointsAmount);
          const price = ethers.BigNumber.from(o.price);
          const filled = ethers.BigNumber.from(o.filledAmount || "0");
          if (pts.lt(CONFIG.minPointsWei)) continue;

          const ptsF = fromPtsWei(pts);
          const ppp = fromUsdcWei(price) / ptsF;
          const disc = ((best - ppp) / best) * 100;

          if (disc >= 3.0) {
            opportunities.push({
              oid: parseInt(o.id),
              pid,
              pts, ptsF, ppp, best, disc,
              remaining: price.sub(filled),
              proto: CONFIG.protocols[pid] || `P${pid}`,
            });
          }
        }
      }

      opportunities.sort((a, b) => b.disc - a.disc);

      if (opportunities.length) {
        log(`Found ${opportunities.length} discounted offers`);
        for (const [i, opp] of opportunities.slice(0, 5).entries()) {
          log(`  [${i + 1}] #${opp.oid} ${opp.proto}: $${opp.ppp.toFixed(2)} vs $${opp.best.toFixed(2)} (${opp.disc.toFixed(1)}% off)`);
        }

        // Distribute across wallets
        const tasks = opportunities.slice(0, agents.length);
        await Promise.all(tasks.map(async (opp, i) => {
          const agent = agents[i % agents.length];
          const bal = await agent.getBalance();
          let fill = opp.remaining.lt(bal) ? opp.remaining : bal;
          if (fill.gt(toUsdcWei(5))) fill = toUsdcWei(5);
          if (fill.lt(100000)) return;

          log(`${agent.label} Buying #${opp.oid} ${opp.proto} for $${fromUsdcWei(fill).toFixed(4)}`);
          await agent.fillOffer(opp.oid, fill);
        }));
      } else {
        log("No discounted offers");
      }

    } catch (e) {
      log(`Error: ${e.message}`, "ERROR");
    }

    await sleep(30000);
  }
}

// --- MARKET: place buy/sell orders ---
async function strategyMarket(agents) {
  log("=".repeat(60));
  log("STRATEGY: Market Making (Multi-Wallet)");
  log("=".repeat(60));

  for (const a of agents) {
    await a.ensureApproval();
  }

  let cycle = 0;
  while (cycle < CONFIG.maxCycles) {
    cycle++;
    log(`\n--- Cycle ${cycle} ---`);

    try {
      const markets = await getMarkets();
      const best = markets.reduce((a, b) => parseFloat(a.totalVolume) > parseFloat(b.totalVolume) ? a : b);
      const pid = parseInt(best.pointsId);
      const price = parseFloat(best.bestPrice);
      const proto = CONFIG.protocols[pid] || `P${pid}`;

      log(`Market making on ${proto} (best $${price.toFixed(2)})`);

      // Each wallet places orders
      await Promise.all(agents.map(async (agent, i) => {
        try {
          // Sell order above market
          const sellPrice = price * (1 + CONFIG.sellPremiumPct / 100 + i * 0.02);
          const ptsOne = ethers.BigNumber.from("1000000000000000000"); // 1 pt
          const sellTotal = toUsdcWei(sellPrice);
          const collateral = toUsdcWei(price * 0.1);

          log(`${agent.label} Sell: 1 pt @ $${sellPrice.toFixed(2)}`);
          await agent.createOffer(pid, ptsOne, sellTotal, collateral);

          await sleep(3000);

          // Buy order below market
          const buyPrice = price * (1 - CONFIG.buyDiscountPct / 100 - i * 0.02);
          const buyTotal = toUsdcWei(buyPrice);

          log(`${agent.label} Buy: 1 pt @ $${buyPrice.toFixed(2)}`);
          await agent.createOffer(pid, ptsOne, buyTotal, collateral);
        } catch (e) {
          log(`${agent.label} Error: ${e.message}`, "ERROR");
        }
      }));

    } catch (e) {
      log(`Error: ${e.message}`, "ERROR");
    }

    await sleep(60000);
  }
}

// --- SNIPER: quickly fill new cheap offers ---
async function strategySniper(agents) {
  log("=".repeat(60));
  log("STRATEGY: Sniper (Multi-Wallet)");
  log("=".repeat(60));

  for (const a of agents) {
    await a.ensureApproval();
  }

  const seen = new Set();
  let cycle = 0;

  while (cycle < CONFIG.maxCycles) {
    cycle++;

    try {
      const markets = await getMarkets();

      for (const m of markets) {
        const pid = parseInt(m.pointsId);
        const best = parseFloat(m.bestPrice);
        if (best <= 0) continue;

        const offers = await getOffers(pid);
        for (const o of offers) {
          const oid = parseInt(o.id);
          if (seen.has(oid) || parseInt(o.status) !== 0) continue;
          seen.add(oid);

          const pts = ethers.BigNumber.from(o.pointsAmount);
          const price = ethers.BigNumber.from(o.price);
          if (pts.lt(CONFIG.minPointsWei)) continue;

          const ptsF = fromPtsWei(pts);
          const ppp = fromUsdcWei(price) / ptsF;

          if (ppp < best * 0.9) {
            const disc = ((best - ppp) / best) * 100;
            const proto = CONFIG.protocols[pid] || `P${pid}`;
            log(`SNIPER! #${oid} ${proto}: $${ppp.toFixed(2)} (${disc.toFixed(1)}% below $${best.toFixed(2)})`, "TRADE");

            // Use first available wallet with balance
            for (const agent of agents) {
              const bal = await agent.getBalance();
              let fill = price.lt(bal) ? price : bal;
              if (fill.gt(toUsdcWei(5))) fill = toUsdcWei(5);
              if (fill.lt(100000)) continue;

              log(`${agent.label} Sniping #${oid} for $${fromUsdcWei(fill).toFixed(4)}`);
              const ok = await agent.fillOffer(oid, fill);
              if (ok) break; // one wallet fills it
            }
          }
        }
      }

    } catch (e) {
      log(`Error: ${e.message}`, "ERROR");
    }

    await sleep(5000); // fast polling
  }
}

// ============================================================
//  MAIN
// ============================================================
async function main() {
  const args = process.argv.slice(2);

  // Parse args
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run")        flags.dryRun = true;
    else if (args[i] === "--help")      flags.help = true;
    else if (args[i] === "--strategy")  flags.strategy = args[++i];
    else if (args[i] === "--wallets")   flags.wallets = args[++i];
    else if (args[i] === "--cycles")    flags.cycles = parseInt(args[++i]);
    else if (args[i] === "--gen")       flags.gen = true;
  }

  if (flags.help) {
    console.log(`
CHECKPOINT EXCHANGE TESTNET AUTO BOT (CommonJS)
================================================

Usage:
  node bot.js [options]

Options:
  --strategy <name>   Strategy: activity | arb | market | sniper (default: activity)
  --wallets <path>    Path to privatekey.txt (default: ./privatekey.txt)
  --cycles <n>        Number of cycles (default: 999)
  --dry-run           Simulate without sending transactions
  --gen               Generate a new testnet wallet
  --help              Show this help

privatekey.txt format:
  # One private key per line (hex, with or without 0x prefix)
  0xabc123...
  0xdef456...
  # Lines starting with # are comments

Examples:
  node bot.js --strategy activity
  node bot.js --strategy arb --wallets keys.txt
  node bot.js --strategy sniper --cycles 10
  node bot.js --gen
`);
    return;
  }

  if (flags.gen) {
    const w = ethers.Wallet.createRandom();
    console.log("\n" + "=".repeat(60));
    console.log("NEW TESTNET WALLET");
    console.log("=".repeat(60));
    console.log(`  Address:     ${w.address}`);
    console.log(`  Private Key: ${w.privateKey}`);
    console.log("\nAdd the private key to privatekey.txt then run:");
    console.log(`  node bot.js --strategy activity`);
    console.log();
    return;
  }

  console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════╗
║      CHECKPOINT EXCHANGE TESTNET AUTO BOT (CJS)         ║
║      Chain: Arbitrum Sepolia (421614) | Gas: Sponsored   ║
╚══════════════════════════════════════════════════════════╝\x1b[0m
`);

  // Load wallets
  const walletList = loadWallets(flags.wallets);

  // Create agents
  const agents = walletList.map((w, i) => new WalletAgent(w, i + 1));

  // Set max cycles
  if (flags.cycles) CONFIG.maxCycles = flags.cycles;

  // Pick strategy
  const strategies = {
    activity: strategyActivity,
    arb:      strategyArb,
    market:   strategyMarket,
    sniper:   strategySniper,
  };

  const strat = flags.strategy || "activity";
  if (!strategies[strat]) {
    log(`Unknown strategy: ${strat}`, "ERROR");
    log(`Available: ${Object.keys(strategies).join(", ")}`);
    return;
  }

  log(`Strategy: ${strat}`);
  log(`Wallets: ${agents.length}`);
  log(`Cycles: ${CONFIG.maxCycles}`);
  log(`Poll: ${CONFIG.pollInterval / 1000}s`);
  log("Press Ctrl+C to stop\n");

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => {
    log("\nShutting down...");
    running = false;
    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("SESSION SUMMARY");
    console.log("=".repeat(60));
    for (const a of agents) {
      console.log(`  ${a.label} Trades: ${a.trades} | Spent: $${a.spent.toFixed(4)}`);
    }
    console.log("=".repeat(60));
    process.exit(0);
  });

  // Run
  await strategies[strat](agents);
}

main().catch(e => {
  log(`Fatal: ${e.message}`, "ERROR");
  process.exit(1);
});
