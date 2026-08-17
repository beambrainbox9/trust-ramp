// Direct ERC-4337 smart account client — bypasses Privy's `useSmartWallets()`
// entirely.
//
// WHY THIS FILE EXISTS (2026-08-17). Privy's `/siwe/link_smart_wallet`
// endpoint 422s with "Invalid SIWE message and/or signature" on every fresh
// account on chain 1952 (X Layer Testnet), even with a byte-verified correct
// signature (see PROJECT_PLAN / debug session notes). Confirmed NOT caused by:
//   - stale/reused nonce (ruled out — nonce matches siwe/init every time)
//   - double-invocation race (fixed separately, still 422s with a single flow)
//   - missing embedded wallet (still 422s with a confirmed valid embedded
//     wallet and a completed wallets/authenticate handshake)
// Everything Privy's own SDK needs to operate on this chain — RPC access,
// bundler, paymaster — already works and is already configured (see
// main.jsx and config/contracts.js). The only broken piece is Privy's
// internal SIWE-linking bookkeeping, which is NOT required to actually
// operate an ERC-4337 account. So: build the account and send UserOperations
// ourselves via permissionless.js, using Privy's embedded wallet purely as
// the raw owner/signer key. Privy still creates and custodies that key
// (AUTOHEAL / useCreateWallet in App.jsx) — we just stop asking Privy's
// SIWE endpoint to "bless" the smart account on top of it.
//
// Deliberately uses the SAME factory + version + salt Privy's SDK used
// (LightAccount 1.1.0, salt 0, Alchemy's canonical factory address), so this
// computes to the IDENTICAL counterfactual smart account address any user
// already saw on screen. Nobody's progress/address changes.

import { createPublicClient, http } from "viem";
import { entryPoint06Address } from "viem/account-abstraction";
import { toLightSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless";
import { xLayerTestnet } from "../chains.js";
import { GAS_POLICY_ID_REFERENCE } from "../config/contracts.js";

// Alchemy's bundler URL doubles as the paymaster endpoint (Alchemy's Rundler
// exposes the standard ERC-7677 pm_getPaymasterData/Stub methods on the same
// URL as the bundler methods) — this is the same URL that was previously
// ONLY entered into the Privy dashboard (see config/contracts.js comment).
// We now read it at runtime too, since we're calling Alchemy directly.
const ALCHEMY_BUNDLER_URL = import.meta.env.VITE_ALCHEMY_BUNDLER_URL;

if (!ALCHEMY_BUNDLER_URL) {
  console.error(
    "[TR-SMART-ACCOUNT] VITE_ALCHEMY_BUNDLER_URL is not set. Add it to " +
      "frontend/.env — same URL already entered into the Privy dashboard " +
      "(https://xlayer-testnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>)."
  );
}

export const publicClient = createPublicClient({
  chain: xLayerTestnet,
  transport: http(undefined, { retryCount: 2, timeout: 10_000 }),
});

/**
 * Build a ready-to-use SmartAccountClient from a Privy embedded wallet.
 *
 * @param {object} embeddedWallet - the Privy wallet object for the user's
 *   embedded EOA (walletClientType === "privy"), as returned by useWallets().
 * @returns {Promise<import("permissionless").SmartAccountClient>}
 */
export async function createTrustRampSmartAccountClient(embeddedWallet) {
  if (!embeddedWallet) {
    throw new Error("createTrustRampSmartAccountClient: no embedded wallet given");
  }
  if (!ALCHEMY_BUNDLER_URL) {
    throw new Error("VITE_ALCHEMY_BUNDLER_URL is not configured");
  }

  const provider = await embeddedWallet.getEthereumProvider();

  const account = await toLightSmartAccount({
    client: publicClient,
    owner: provider,
    version: "1.1.0", // pairs with EntryPoint v0.6 — matches what Privy used
    entryPoint: { address: entryPoint06Address, version: "0.6" },
    // factoryAddress / index intentionally omitted: defaults to
    // 0x00004EC70002a32400f8ae005A26081065620D20 and salt 0, which is
    // byte-for-byte what Privy's SDK was already using.
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: xLayerTestnet,
    bundlerTransport: http(ALCHEMY_BUNDLER_URL, { retryCount: 3, timeout: 20_000 }),
    paymaster: true,
    paymasterContext: { policyId: GAS_POLICY_ID_REFERENCE },
  });

  console.log(
    `[TR-SMART-ACCOUNT] client ready address=${smartAccountClient.account.address} ` +
      `chain=${xLayerTestnet.id}`
  );

  return smartAccountClient;
}
