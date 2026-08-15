/**
 * Deploys TrustRampReputation and MockRWAYieldToken to X Layer.
 *
 *   npm run deploy:testnet     (X Layer testnet, chain 1952)
 *   npm run deploy:mainnet     (X Layer mainnet, chain 196 — read the warnings)
 *
 * Design notes, because a deploy script is the easiest place to lose money or
 * an afternoon:
 *
 * - It REFUSES to run if the chain the RPC reports doesn't match the network
 *   you asked for. A wrong-network deploy is silent, costs gas, and produces
 *   addresses that look fine until nothing works.
 * - The faucet flag on MockRWAYieldToken is derived from the chain ID, not from
 *   a variable you might forget to change. Deploying a live faucet to mainnet
 *   is the highest-severity mistake available here, so it is made structurally
 *   difficult rather than documented.
 * - Mainnet requires an explicit typed confirmation.
 * - Every deployment is read back and verified on-chain before the script
 *   reports success. "The transaction was mined" is not the same as "the
 *   contract works".
 * - Addresses are written to deployments/<network>.json for the app to consume,
 *   so nobody is copy-pasting hex by hand.
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CHAINS = {
  1952: { name: "X Layer Testnet", faucet: true, explorer: "https://www.okx.com/web3/explorer/xlayer-test", key: "xlayerTestnet" },
  196: { name: "X Layer Mainnet", faucet: false, explorer: "https://www.okx.com/web3/explorer/xlayer", key: "xlayerMainnet" },
};

// --- MockRWASale parameters ---------------------------------------------------
//
// Payment is MockUSDC (6 decimals), NOT native OKB — so the practice flow
// contains a real ERC-20 approval, which is the "Approvals" concept the
// reputation contract scores. See the header of MockRWASale.sol.
//
// Price is payment base units per WHOLE (1e18) asset token. 2_000_000 = 2.00
// DEMO-USDC, which keeps a practice purchase small enough that a learner can run
// the flow repeatedly on one faucet claim (1,000 DEMO-USDC = 500 purchases).
//
// The same value is used on mainnet deliberately: practice should rehearse the
// real thing (see PROJECT_PLAN Day 5-6 note). The mainnet SAFETY limit is the
// server-side $25 lifetime cap added on Day 11-12, not a different price here.
const PRICE_PER_TOKEN_UNITS = 2_000_000n; // 2.00 DEMO-USDC per whole token

// Asset tokens moved from the deployer into the sale's stock at deploy time.
// The deployer holds 1,000,000 from the token constructor, so this is 1% of it —
// enough for the demo, and leaves headroom to re-seed via addSupply() without
// redeploying.
const SALE_SEED_TOKENS = 10_000n * 10n ** 18n;

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

async function main() {
  const { ethers } = hre;

  console.log("\n=== TrustRamp deployment ===\n");

  // --- 1. Confirm which chain we are ACTUALLY talking to -------------------
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const cfg = CHAINS[chainId];

  if (!cfg) {
    throw new Error(
      `Refusing to deploy: RPC reports chain ID ${chainId}, which is not X Layer ` +
        `(expected 1952 testnet or 196 mainnet). Check the --network flag and your RPC URL.`
    );
  }
  if (hre.network.config.chainId !== undefined && hre.network.config.chainId !== chainId) {
    throw new Error(
      `Refusing to deploy: you asked for network "${hre.network.name}" (chain ` +
        `${hre.network.config.chainId}) but the RPC reports chain ${chainId}. ` +
        `One of them is wrong — resolve before deploying.`
    );
  }
  console.log(`Network:  ${cfg.name} (chain ${chainId})`);

  // --- 2. Deployer and balance --------------------------------------------
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "No deployer account configured. Set DEPLOYER_PRIVATE_KEY in contracts/.env " +
        "(run `npm run new-wallet` to generate a burner)."
    );
  }
  const deployer = signers[0];
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} OKB`);

  if (balance === 0n) {
    throw new Error(
      `Deployer has zero OKB and cannot pay gas.\n` +
        (chainId === 1952
          ? `  Claim X Layer testnet OKB from the OKX faucet for ${deployer.address}, then retry.`
          : `  Fund ${deployer.address} with mainnet OKB, then retry.`)
    );
  }

  // --- 3. Mainnet gate -----------------------------------------------------
  if (chainId === 196) {
    console.log("\n  *** MAINNET DEPLOYMENT ***");
    console.log("  This spends real OKB and publishes contracts users can send real money to.");
    console.log(`  The demo token's faucet will be permanently DISABLED (faucetEnabled=false).`);
    console.log("  This cannot be changed after deployment.\n");
    const answer = await ask('  Type exactly "deploy to mainnet" to continue: ');
    if (answer !== "deploy to mainnet") {
      console.log("\n  Aborted. Nothing was deployed.\n");
      process.exit(1);
    }
  }

  // --- 4. Deploy -----------------------------------------------------------
  console.log("\nDeploying TrustRampReputation…");
  const Rep = await ethers.getContractFactory("TrustRampReputation");
  const rep = await Rep.deploy();
  await rep.waitForDeployment();
  const repAddr = await rep.getAddress();
  console.log(`  -> ${repAddr}`);

  // faucetEnabled comes from the chain ID, never from a hand-edited variable.
  console.log(`\nDeploying MockRWAYieldToken (faucetEnabled=${cfg.faucet})…`);
  const Tok = await ethers.getContractFactory("MockRWAYieldToken");
  const tok = await Tok.deploy(cfg.faucet);
  await tok.waitForDeployment();
  const tokAddr = await tok.getAddress();
  console.log(`  -> ${tokAddr}`);

  // Payment token. Same faucet-flag-from-chain-id rule as the demo asset: a
  // free-mint stablecoin on mainnet would be the same class of mistake.
  console.log(`\nDeploying MockUSDC (faucetEnabled=${cfg.faucet})…`);
  const Usdc = await ethers.getContractFactory("MockUSDC");
  const usdc = await Usdc.deploy(cfg.faucet);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`  -> ${usdcAddr}`);

  console.log(
    `\nDeploying MockRWASale (price ${ethers.formatUnits(PRICE_PER_TOKEN_UNITS, 6)} DEMO-USDC/token)…`
  );
  const Sale = await ethers.getContractFactory("MockRWASale");
  const sale = await Sale.deploy(tokAddr, usdcAddr, PRICE_PER_TOKEN_UNITS);
  await sale.waitForDeployment();
  const saleAddr = await sale.getAddress();
  console.log(`  -> ${saleAddr}`);

  // Seed the sale's stock. addSupply() PULLS, so it needs an allowance first —
  // two transactions, both awaited, because a sale contract holding zero tokens
  // would deploy "successfully" and then revert on every purchase.
  console.log(`\nSeeding sale with ${ethers.formatEther(SALE_SEED_TOKENS)} DEMO-xTBILL…`);
  const approveTx = await tok.approve(saleAddr, SALE_SEED_TOKENS);
  await approveTx.wait();
  const seedTx = await sale.addSupply(SALE_SEED_TOKENS);
  await seedTx.wait();
  console.log(`  -> seeded`);

  // --- 5. Verify the deployed state, don't assume it ----------------------
  console.log("\nVerifying on-chain state…");
  const checks = [];
  const check = (label, actual, expected) => {
    const ok = String(actual) === String(expected);
    checks.push(ok);
    console.log(`  ${ok ? "OK  " : "FAIL"} ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
  };

  check("reputation name", await rep.name(), "TrustRamp Onchain Score");
  check("reputation symbol", await rep.symbol(), "TRS");
  check("reputation owner", await rep.owner(), deployer.address);
  check("concept count", await rep.CONCEPT_COUNT(), "4");
  check("token symbol", await tok.symbol(), "DEMO-xTBILL");
  check("faucetEnabled", await tok.faucetEnabled(), String(cfg.faucet));
  check("usdc symbol", await usdc.symbol(), "DEMO-USDC");
  check("usdc decimals", await usdc.decimals(), "6");
  check("usdc faucetEnabled", await usdc.faucetEnabled(), String(cfg.faucet));
  check("sale asset wiring", await sale.token(), tokAddr);
  check("sale payment wiring", await sale.paymentToken(), usdcAddr);
  check("sale price", await sale.pricePerTokenUnits(), PRICE_PER_TOKEN_UNITS);
  check("sale owner", await sale.owner(), deployer.address);
  // The check that actually matters: stock is present, so buy() can succeed.
  check("sale seeded supply", await sale.availableSupply(), SALE_SEED_TOKENS);

  if (checks.includes(false)) {
    throw new Error("Post-deploy verification FAILED. Do not use these addresses.");
  }

  // --- 6. Record addresses for the app ------------------------------------
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const record = {
    network: cfg.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      TrustRampReputation: repAddr,
      MockRWAYieldToken: tokAddr,
      MockUSDC: usdcAddr,
      MockRWASale: saleAddr,
    },
    faucetEnabled: cfg.faucet,
    sale: {
      paymentToken: usdcAddr,
      paymentSymbol: "DEMO-USDC",
      paymentDecimals: 6,
      pricePerTokenUnits: PRICE_PER_TOKEN_UNITS.toString(),
      pricePerTokenDisplay: `${ethers.formatUnits(PRICE_PER_TOKEN_UNITS, 6)} DEMO-USDC`,
      seededTokens: ethers.formatEther(SALE_SEED_TOKENS),
      buySignature: "buy(uint256 tokenAmount, uint256 maxPaymentIn)",
      requiresApproval: true,
    },
    explorer: {
      TrustRampReputation: `${cfg.explorer}/address/${repAddr}`,
      MockRWAYieldToken: `${cfg.explorer}/address/${tokAddr}`,
      MockUSDC: `${cfg.explorer}/address/${usdcAddr}`,
      MockRWASale: `${cfg.explorer}/address/${saleAddr}`,
    },
    compiler: { version: "0.8.20", evmVersion: "paris", optimizer: { enabled: true, runs: 200 } },
  };
  const outFile = path.join(outDir, `${cfg.key}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n");

  console.log(`\nAll checks passed. Addresses saved to contracts/deployments/${cfg.key}.json`);
  console.log("\n  Explorer links:");
  console.log(`    Reputation: ${record.explorer.TrustRampReputation}`);
  console.log(`    Demo token: ${record.explorer.MockRWAYieldToken}`);
  console.log(`    Demo USDC:  ${record.explorer.MockUSDC}`);
  console.log(`    Sale:       ${record.explorer.MockRWASale}`);
  console.log("\n  Send me the contents of that JSON file and I'll wire the app to it.\n");
}

main().catch((e) => {
  console.error("\nDEPLOY FAILED\n");
  console.error("  " + (e.message || e));
  console.error("\n  Nothing further was deployed. Fix the above and re-run.\n");
  process.exit(1);
});
