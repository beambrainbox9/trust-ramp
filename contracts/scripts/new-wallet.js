#!/usr/bin/env node
/**
 * Generates a fresh BURNER wallet for deploying to X Layer testnet.
 *
 * Run:  npm run new-wallet
 *
 * READ THIS BEFORE USING THE KEY IT PRINTS
 * ----------------------------------------
 * This key is generated locally, in this process, on your machine. It is never
 * transmitted anywhere. Nobody else has seen it — not Claude, not any server.
 *
 * Rules for this key, which are not negotiable:
 *   1. TESTNET ONLY. Never fund it with real money. Never reuse it on mainnet.
 *   2. Never paste it into a chat, an issue, a commit, or a screenshot. If it
 *      ever leaves your machine, generate a new one and redeploy — that costs
 *      you ten minutes, which is cheaper than any alternative.
 *   3. It goes in contracts/.env, which is gitignored. Verify that before you
 *      commit anything.
 *
 * WHAT THIS KEY BECOMES:
 * Whoever deploys TrustRampReputation becomes its `owner`, and `owner` is the
 * only address that can call recordGraduation. So this is not just a deploy
 * convenience — it becomes the admin key your backend uses to write scores.
 * For a hackathon, a burner in an env var is a defensible choice. Just be aware
 * that is the choice you are making. (PROJECT_PLAN flags admin key custody as
 * an open decision; this is where it lands.)
 */

const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");

const w = Wallet.createRandom();
const envPath = path.join(__dirname, "..", ".env");

console.log("\n  New burner wallet generated locally.\n");
console.log("  Address:      " + w.address);
console.log("  Private key:  " + w.privateKey);
console.log("");

if (fs.existsSync(envPath)) {
  const existing = fs.readFileSync(envPath, "utf8");
  if (/^DEPLOYER_PRIVATE_KEY=.+/m.test(existing)) {
    console.log("  contracts/.env already has a DEPLOYER_PRIVATE_KEY.");
    console.log("  NOT overwriting it — if you deploy with a different key you");
    console.log("  lose ownership of anything the old key deployed.");
    console.log("  Replace it by hand only if you know that's what you want.\n");
  } else {
    fs.appendFileSync(envPath, `\nDEPLOYER_PRIVATE_KEY=${w.privateKey}\n`);
    console.log("  Appended DEPLOYER_PRIVATE_KEY to contracts/.env\n");
  }
} else {
  fs.writeFileSync(envPath, `DEPLOYER_PRIVATE_KEY=${w.privateKey}\n`);
  console.log("  Wrote contracts/.env with DEPLOYER_PRIVATE_KEY\n");
}

console.log("  NEXT STEPS");
console.log("  1. Fund this address with X Layer TESTNET OKB from the OKX faucet:");
console.log("     " + w.address);
console.log("  2. Confirm it arrived:  npm run verify -- " + w.address + "   (from backend/)");
console.log("  3. Deploy:              npm run deploy:testnet");
console.log("");
console.log("  Do not send real funds to this address.\n");
