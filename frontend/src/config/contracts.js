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
      reputation: "0x3004199d864300d4c6794784E73752F8b0c71085",
      assetToken: "0x07dF6394227216e8b1B878dB15E13CB50F091487",
      paymentToken: "0x096970D0c7Aa0Ac70Afe6e8c2373a07bF03cB12D",
      sale: "0x0825744ef3303bd90335758D5477AAEc557ae303",
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
 * NOTE: despite the name, this is NOT reference-only — smartAccount.js's
 * direct permissionless.js bundler client (added 2026-08-17 to bypass
 * Privy's SIWE linking) sends this value as the live `paymasterContext`
 * policyId, so a stale value here breaks the testnet flow with Alchemy's
 * "Policy not found". main.jsx's Privy-SDK path still reads its own policy
 * from the Privy dashboard, unaffected by this constant. The first policy
 * was the wrong TYPE
 * ("Bundler Sponsored Operations") and was rejected by every paymaster
 * method; the second was an "Onchain Paymaster Policy" of the correct type
 * but the app/policy pair got stuck returning "Must be authenticated!" from
 * Alchemy for unknown reasons (confirmed via direct curl, not a code issue
 * — recreating the app resolved it). This is the third-generation policy
 * on the recreated app. See PROJECT_PLAN §1d.
 */
export const GAS_POLICY_ID_REFERENCE = "555cbdbc-7c3a-49aa-b0bb-123c9204dd5e";

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
