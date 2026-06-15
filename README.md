<div align="center">

# Checkpoint Exchange Testnet Auto Bot

**Multi-Wallet Automated Trading Bot for [Checkpoint Exchange](https://checkpoint.exchange/market) Testnet**

![Chain](https://img.shields.io/badge/Chain-Arbitrum%20Sepolia-2D374B?style=for-the-badge&logo=arbitrum)
![Node](https://img.shields.io/badge/Node.js-16+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Testnet-yellow?style=for-the-badge)

Automated trading bot that interacts with the Checkpoint Exchange data marketplace on Arbitrum Sepolia. Supports multi-wallet parallel execution with 4 distinct trading strategies.

</div>

---

## Features

- **Multi-Wallet** — Run unlimited wallets in parallel from a single `privatekey.txt`
- **4 Strategies** — Activity, Arbitrage, Market Making, Sniper
- **Gas Sponsored** — No ETH needed for gas on Arbitrum Sepolia testnet
- **CommonJS** — Pure Node.js with `require()`, no ESM/TypeScript hassle
- **Partial Fills** — Supports `fillOfferPartial` for granular trade sizing
- **Auto Approval** — Handles USDC approval automatically on first run
- **Session Summary** — Trade count & USDC spent per wallet on exit
- **Colored Logs** — Color-coded terminal output (INFO/TRADE/ERROR/WARN)

## Supported Protocols

| ID | Protocol | Description |
|----|----------|-------------|
| 1 | Jumper XP | Jumper exchange points |
| 2 | DeBridge S2 | DeBridge Season 2 |
| 3 | DeBridge S3 | DeBridge Season 3 |
| 4 | Galxe | Galxe loyalty points |
| 5 | Checkpoint | Checkpoint protocol |
| 6 | Blockscout | Blockscout explorer points |
| 7 | Cap | Cap protocol |

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/kevs1799/checkpoint-exchange-testnet-bot.git
cd checkpoint-exchange-testnet-bot
npm install
```

### 2. Wallet(s)

 privatekey.txt Format

```bash
# Lines starting with # are comments
# One private key per line (hex, with or without 0x prefix)
```

The bot reads all keys and runs each wallet as an independent agent in parallel.


### 3. Fund Wallets

Get testnet USDC from [https://checkpoint.exchange](https://checkpoint.exchange) and deposit to each wallet address.

### 4. Run

```bash
node bot.js
or
node bot.js --strategy activity
```


## Strategies

### Activity (default)

Fills random open offers across weighted-random markets. Generates trading volume by distributing small fills (0.1-8 USDC) across multiple protocols. Good for general testnet activity.

```bash
node bot.js --strategy activity
```

### Arbitrage

Scans all markets for offers priced ≥3% below the best available price. Sorts opportunities by discount and fills the top ones. Buys cheap, sells at market.

```bash
node bot.js --strategy arb
```

### Market Making

Places paired buy/sell orders on the highest-volume market. Each wallet offsets its price slightly to avoid self-filling. Sells 10% above, buys 5% below market price.

```bash
node bot.js --strategy market
```

### Sniper

Fast-polling (5s interval) strategy that watches for newly listed offers priced 10%+ below market. Instantly fills cheap offers as they appear. Uses a `seen` set to avoid duplicate fills.

```bash
node bot.js --strategy sniper
```

## CLI Options

```
node bot.js [options]

Options:
  --strategy <name>   Strategy: activity | arb | market | sniper (default: activity)
  --wallets <path>    Path to privatekey.txt (default: ./privatekey.txt)
  --cycles <n>        Max cycles before exit (default: 999)
  --dry-run           Simulate without sending transactions
  --gen               Generate a new testnet wallet
  --help              Show help message
```

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run activity strategy |
| `npm run arb` | Run arbitrage strategy |
| `npm run market` | Run market making strategy |
| `npm run sniper` | Run sniper strategy |
| `npm run gen` | Generate a new wallet |
| `npm run dry` | Dry run (activity, no TX) |

## Example Output

```
╔══════════════════════════════════════════════════════════╗
║      CHECKPOINT EXCHANGE TESTNET AUTO BOT (CJS)         ║
║      Chain: Arbitrum Sepolia (421614) | Gas: Sponsored   ║
╚══════════════════════════════════════════════════════════╝

[12:30:01] [INFO] Loaded wallet: 0xABC...
[12:30:01] [INFO] Loaded wallet: 0xDEF...
[12:30:01] [INFO] Loaded wallet: 0x123...
[12:30:01] [INFO] Total wallets: 3

[12:30:01] [INFO] STRATEGY: Activity Generator (Multi-Wallet)
[12:30:01] [INFO] Wallets: 3

[12:30:02] [TRADE] [W1|0xABC...] Galxe | Offer #4521 | Fill: $2.5000
[12:30:03] [TRADE] [W2|0xDEF...] Blockscout | Offer #13098 | Fill: $1.2000
[12:30:04] [TRADE] [W3|0x123...] Checkpoint | Offer #8891 | Fill: $3.0000

--- Session Summary ---
  [W1|0xABC...] Trades: 12 | Spent: $18.5000
  [W2|0xDEF...] Trades: 8  | Spent: $11.2000
  [W3|0x123...] Trades: 15 | Spent: $22.8000
```

## Project Structure

```
checkpoint-exchange-testnet-bot/
├── bot.js              # Main bot logic (CommonJS)
├── privatekey.txt      # Wallet private keys (gitignored)
├── package.json        # Dependencies & scripts
├── README.md           # This file
└── abi/
    ├── market.json     # Checkpoint Market contract ABI
    └── erc20.json      # USDC token ABI
```

## Contracts (Arbitrum Sepolia)

| Contract | Address |
|----------|---------|
| Market | `0xf2869aCE6170F7Ab1aba1C55a3483eD7E2f8AaAE` |
| USDC | `0x3253a335E7bFfB4790Aa4C25C4250d206E9b9773` |
| Deposit | `0xE98C0EbF9B251d534c58DAC4e042FB5b827A00bE` |
| Registry | `0xC9b2b7138ECF35f980036BbDB466d8e6437B4d9F` |
| Settlement | `0x15dfE078EAF103640e85B0e120E138E73D639C70` |

## API Endpoints

| Service | URL |
|---------|-----|
| Market API | `https://checkpoint-data-market-api.dorimebest.workers.dev` |
| Oracle | `https://oracle.checkpoint.exchange` |

## Trading Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `maxUsdcPerTrade` | 5 USDC | Max USDC per single trade |
| `buyDiscountPct` | 5% | Buy price below market |
| `sellPremiumPct` | 10% | Sell price above buy |
| `maxPositions` | 10 | Max concurrent positions |
| `pollInterval` | 30s | API polling interval |
| `minPointsWei` | 0.1 pts | Minimum points per offer |
| `txGas` | 500,000 | Gas limit per TX |
| `maxCycles` | 999 | Max cycles before exit |

## Dependencies

- **ethers** v5.8 — Ethereum library for contract interaction
- **axios** — HTTP client for API requests
- **eth_accounts** — Ethereum account utilities

## Disclaimer

This bot is for **testnet only**. Do not use on mainnet without thorough testing and auditing. The contracts and tokens are on Arbitrum Sepolia testnet and have no real value.

## License

MIT
