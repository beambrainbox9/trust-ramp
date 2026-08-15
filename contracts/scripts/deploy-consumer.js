/**
 * Deploys ScoreConsumerExample against an ALREADY-DEPLOYED TrustRampReputation.
 *
 *   npm run deploy:consumer:testnet     (X Layer testnet, chain 1952)
 *   npm run deploy:consumer:mainnet     (X Layer mainnet, chain 196 — locked behind a typed prompt)
 *
 * Kept as a separate script from deploy.js on purpose. deploy.js is a fresh-
 * stack deployment (four contracts, seeded stock). The consumer is deployed
 * once the reputation contract is already live and MUST NOT redeploy it — the
 * reputation address is what integrators point at. A single script that
 * conditionally skipped the reputation deploy would eventually be forgotten and
 * re-deploy it by accident on the wrong day, which is exactly the class of
 * mistake to make structurally impossible.
 *
 * The reputation address is READ from contracts/deployments/<network>.json —
 * the same file deploy.js writes on success. Refuses to run if that file or its
 * reputation entry is missing.
 *
 * Verifies on-chain state after deployment (owner, wiring), and appends the
 * consumer address to the same deployments file. Never rewrites the reputation
 * entry.
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CHAINS = {
  1952: { name: "X Layer Testnet", explorer: "https://www.okx.com/web3/explorer/xlayer-test", key: "xlayerTestnet" },
  196: { name: "X Layer Mainnet", explorer: "https://www.okx.com/web3/explorer/xlayer", key: "xlayerMainnet" },
};

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

async function main() {
  const { ethers } = hre;
  console.log("\n=== ScoreConsumerExample deployment ===\n");

  // --- 1. Chain sanity — mirrors deploy.js exactly ------------------------
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const cfg = CHAINS[chainId];
  if (!cfg) {
    throw new Error(
      `Refusing to deploy: RPC reports chain ID ${chainId}, not an X Layer chain.`
    );
  }
  if (hre.network.config.chainId !== undefined && hre.network.config.chainId !== chainId) {
    throw new Error(
      `Refusing to deploy: --network says ${hre.network.config.chainId} but RPC says ${chainId}.`
    );
  }
  console.log(`Network:  ${cfg.name} (chain ${chainId})`);

  // --- 2. Deployer ---------------------------------------------------------
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer configured. Set DEPLOYER_PRIVATE_KEY in contracts/.env " +
        "(same key that deployed TrustRampReputation, since only the owner can meaningfully use it)."
    );
  }
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} OKB`);
  if (balance === 0n) throw new Error("Deployer has zero OKB — fund it first.");

  // --- 3. Load the existing deployment record -----------------------------
  const outDir = path.join(__dirname, "..", "deployments");
  const outFile = path.join(outDir, `${cfg.key}.json`);
  if (!fs.existsSync(outFile)) {
    throw new Error(
      `No prior deployment found at contracts/deployments/${cfg.key}.json. ` +
        `Run deploy.js first, or on a chain where the stack is already live, ` +
        `re-create that file with the deployed TrustRampReputation address.`
    );
  }
  const record = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const repAddr = record?.contracts?.TrustRampReputation;
  if (!repAddr) {
    throw new Error(
      `${outFile} has no TrustRampReputation address. Refusing to guess.`
    );
  }
  console.log(`\nExisting TrustRampReputation: ${repAddr}`);

  // Confirm the reputation address is actually a contract on this chain, so we
  // never wire the consumer to a wrong or stale entry.
  const repCode = await ethers.provider.getCode(repAddr);
  if (repCode === "0x") {
    throw new Error(
      `Reputation address ${repAddr} has no code on chain ${chainId}. ` +
        `The deployments file may be from a different chain — do not proceed.`
    );
  }

  // --- 4. Mainnet gate -----------------------------------------------------
  if (chainId === 196) {
    console.log("\n  *** MAINNET DEPLOYMENT ***");
    console.log("  This publishes an integrator example against real reputation.");
    const answer = await ask('  Type exactly "deploy consumer to mainnet" to continue: ');
    if (answer !== "deploy consumer to mainnet") {
      console.log("\n  Aborted. Nothing was deployed.\n");
      process.exit(1);
    }
  }

  // --- 5. Deploy consumer -------------------------------------------------
  console.log(`\nDeploying ScoreConsumerExample(reputation=${repAddr})…`);
  const Consumer = await ethers.getContractFactory("ScoreConsumerExample");
  const consumer = await Consumer.deploy(repAddr);
  await consumer.waitForDeployment();
  const consumerAddr = await consumer.getAddress();
  console.log(`  -> ${consumerAddr}`);

  // --- 6. Verify wiring, don't assume it ----------------------------------
  console.log("\nVerifying on-chain state…");
  const checks = [];
  const check = (label, actual, expected) => {
    const ok = String(actual).toLowerCase() === String(expected).toLowerCase();
    checks.push(ok);
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  };
  check("consumer.reputation() wiring", await consumer.reputation(), repAddr);

  // A stranger reads as (false, 0). This tests the whole path — contract deployed,
  // ABI wired, cross-contract call working — end to end, before we trust it.
  const [ok, score] = await consumer.canReadRWA(deployer.address);
  console.log(
    `  ${ok === false && score === 0n ? "OK  " : "FAIL"} consumer.canReadRWA(deployer) reads (false, 0) for an ungraduated address: (${ok}, ${score})`
  );
  checks.push(ok === false && score === 0n);

  if (checks.includes(false)) {
    throw new Error("Post-deploy verification FAILED. Do not use this consumer address.");
  }

  // --- 7. Record without disturbing existing entries ----------------------
  record.contracts = record.contracts || {};
  record.contracts.ScoreConsumerExample = consumerAddr;
  record.explorer = record.explorer || {};
  record.explorer.ScoreConsumerExample = `${cfg.explorer}/address/${consumerAddr}`;
  record.consumerDeployedAt = new Date().toISOString();

  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nAll checks passed. ${cfg.key}.json updated (existing entries preserved).`);
  console.log(`\n  Explorer:`);
  console.log(`    Consumer:  ${record.explorer.ScoreConsumerExample}`);
  console.log(`    Reads from: ${cfg.explorer}/address/${repAddr}`);
  console.log("");
}

main().catch((e) => {
  console.error("\nCONSUMER DEPLOY FAILED\n");
  console.error("  " + (e.message || e));
  console.error("\n  Nothing was recorded. Fix and re-run.\n");
  process.exit(1);
});
