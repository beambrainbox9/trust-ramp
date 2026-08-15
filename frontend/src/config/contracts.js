// SINGLE CONFIG POINT for chain + contract addresses.
//
// Nothing else in the app hardcodes an address or a chain id. Day 11-12 switches
// the practice flow to mainnet by changing ACTIVE_NETWORK here (plus deploying
// the contracts and adding the cap + approval gate server-side) — not by editing
// components.
//
// PROJECT_PLAN §1d records the decision this file implements: practice (testnet)
// and the real purchase (mainnet) use the SAME MockRWASale contract pattern and
// the SAME frontend code path, differing only by chain id, the server-side
// spending cap, and the human-approval gate.

import { xLayerTestnet, xLayerMainnet } from "../chains.js";

/**
 * Deployed addresses, verified on-chain via eth_getCode on 2026-08-11.
 * Source of truth: contracts/deployments/<network>.json, written by
 * contracts/scripts/deploy.js after it verifies deployed state.
 *
 * mainnet is null on purpose. Nothing is deployed there yet, and a null makes
 * the UI fail loudly rather than silently pointing at a zero address — the same
 * fail-closed posture server.js uses for prepare-transaction.
 */
export const NETWORKS = {
  testnet: {
    key: "testnet",
    chain: xLayerTestnet,
    chainId: 1952,
    label: "X Layer Testnet",
    isPractice: true,
    explorer: "https://www.okx.com/web3/explorer/xlayer-test",
    contracts: {
      reputation: "0x1C51dec8a42e425f79C4584bDbf00A5958b87F7d",
      assetToken: "0x4BF84298151514512cB008B48f439d71DB1Cd6c4", // DEMO-xTBILL, 18 dp
      paymentToken: "0xa9B8b8Aba1Fc34c790Ec9D7D452d65E4b0A3A9E5", // DEMO-USDC, 6 dp
      sale: "0x6466218A596e7FCB933ED5a02Fe5204dDa46435e",
    },
    // Faucets exist only where MockRWAYieldToken/MockUSDC were deployed with
    // faucetEnabled=true, which the deploy script derives from the chain id.
    faucetsEnabled: true,
  },
  mainnet: {
    key: "mainnet",
    chain: xLayerMainnet,
    chainId: 196,
    label: "X Layer Mainnet",
    isPractice: false,
    explorer: "https://www.okx.com/web3/explorer/xlayer",
    contracts: {
      reputation: null,
      assetToken: null,
      paymentToken: null,
      sale: null,
    },
    faucetsEnabled: false,
  },
};

/** The network the practice flow runs against. Day 11-12 adds a mainnet path. */
export const ACTIVE_NETWORK = NETWORKS.testnet;

export const ASSET_DECIMALS = 18;
export const PAYMENT_DECIMALS = 6;
export const ASSET_SYMBOL = "DEMO-xTBILL";
export const PAYMENT_SYMBOL = "DEMO-USDC";

/**
 * Alchemy Gas Manager policy that sponsors gas for UserOperations.
 *
 * Recorded here for reference only — Privy reads the policy from its own
 * dashboard, and passing it from code would override that (see main.jsx). The
 * first policy was the wrong TYPE ("Bundler Sponsored Operations") and was
 * rejected by every paymaster method; this one is an "Onchain Paymaster Policy"
 * and is confirmed working. See PROJECT_PLAN §1d.
 */
export const GAS_POLICY_ID_REFERENCE = "655835a1-eb5d-4045-b10e-24fabf56dd64";

export const txUrl = (hash) => `${ACTIVE_NETWORK.explorer}/tx/${hash}`;

// --- Minimal ABIs. Only the functions this flow actually calls. --------------

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "claimFaucet",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "faucetRemainingFor",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

export const SALE_ABI = [
  {
    name: "costFor",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenAmount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "availableSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "pricePerTokenUnits",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "buy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenAmount", type: "uint256" },
      { name: "maxPaymentIn", type: "uint256" },
    ],
    outputs: [],
  },
];
