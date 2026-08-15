require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
const path = require("path");
require("dotenv").config();

// ---------------------------------------------------------------------------
// Compiler source: local npm package, not a remote download.
//
// By default Hardhat fetches solc from binaries.soliditylang.org at compile
// time. That means your build depends on a third-party CDN being reachable —
// on a locked-down network, or on submission day if that host has a bad hour,
// `npx hardhat compile` simply fails. We already depend on the npm registry for
// everything else, so we pull the identical compiler from there instead and
// remove one live dependency from the build.
// ---------------------------------------------------------------------------
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.20") {
    // Guard: package.json pins solc to exactly 0.8.20 (no caret). If that pin
    // ever loosens and npm resolves a different patch, this config would still
    // TELL Hardhat it compiled with 0.8.20 while actually using something else —
    // the artifact and its recorded version would disagree, and verifying the
    // contract on the explorer would fail in a confusing way. Fail loudly instead.
    const installed = require("solc/package.json").version;
    if (installed !== "0.8.20") {
      throw new Error(
        `Local solc is ${installed} but this config declares 0.8.20. ` +
          `Run: npm install solc@0.8.20 --save-exact`
      );
    }
    return {
      compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: "0.8.20",
    };
  }
  return runSuper();
});

// ---------------------------------------------------------------------------
// evmVersion is PINNED to "paris" deliberately. Do not remove it.
//
// solc 0.8.20 defaults to "shanghai"; Hardhat 2 overrides that to "paris".
// Same source, DIFFERENT BYTECODE depending on which toolchain compiled it —
// measured on this project: shanghai emits PUSH0 opcodes, paris emits none.
// Leaving it implicit means the artifact you tested locally may not be the
// artifact you deploy.
//
// Paris is chosen over shanghai/cancun because it is the most conservative
// target that still supports everything these contracts use. X Layer migrated
// to the OP Stack (op-geth) in Oct 2025 and does support PUSH0 and MCOPY, so
// shanghai would also work — but paris works on every EVM chain including any
// we might deploy to later, at negligible gas cost, and it removes the entire
// hardfork-compatibility question that the Day 2 audit flagged.
// ---------------------------------------------------------------------------

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_KEY ? [DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      // Local test chain. `chainId` matches X Layer testnet so any chain-id
      // assumption that creeps into a test fails here rather than on-chain.
      chainId: 1952,
    },
    xlayerTestnet: {
      url: process.env.XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon",
      chainId: 1952,
      accounts,
    },
    xlayerMainnet: {
      url: process.env.XLAYER_MAINNET_RPC || "https://rpc.xlayer.tech",
      chainId: 196,
      accounts,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: { timeout: 120000 },
};
