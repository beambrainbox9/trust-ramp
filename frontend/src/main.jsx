// BEFORE ANY OTHER IMPORT. Privy's smart-wallet creation path (viem /
// permissionless internals) does a dynamic `globalThis.Buffer` / `typeof Buffer`
// probe, and if that returns undefined it silently fails and useSmartWallets()
// returns a null client forever. On the deployed site the debug panel confirmed
// bufferGlobal:false, bufferWindow:false, hasClient:false.
//
// Why vite-plugin-node-polyfills alone did NOT cover the production build:
//   - In DEV, the plugin passes `esbuild.inject: [shim/buffer]` via
//     optimizeDeps, which makes Buffer available as a real global during
//     dep pre-bundling. That is why local `vite dev` worked.
//   - In BUILD (Rollup), it configures @rollup/plugin-inject with
//     { Buffer: "vite-plugin-node-polyfills/shims/buffer" }, which ONLY
//     rewrites BARE `Buffer` identifiers into shim imports. It does not
//     install a `globalThis.Buffer` binding, so any code that reads
//     `globalThis.Buffer` or `typeof Buffer` (not `Buffer.foo(...)`) is
//     untouched — verified by grepping dist/*.js, which contains many
//     `globalThis.Buffer != null` READS and zero `globalThis.Buffer =`
//     WRITES.
//
// So we install the global ourselves. Kept in main.jsx (not vite.config.js)
// deliberately: this is a one-line runtime assertion at the entry point, easy
// to see and remove. Import must sit above the Privy imports so it runs before
// SmartWalletsProvider is constructed.
import { Buffer as BufferPolyfill } from "buffer";
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = BufferPolyfill;
}
if (typeof window !== "undefined" && typeof window.Buffer === "undefined") {
  window.Buffer = BufferPolyfill;
}

import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { PurchaseFlowProvider } from "./context/PurchaseFlowContext.jsx";
import App from "./App.jsx";
import { xLayerTestnet } from "./chains.js";
import "./index.css";

// --- Day 2: wiring the actual ERC-4337 smart account (not just an EOA) ---
//
// SIWE-BYPASS (2026-08-17). SmartWalletsProvider REMOVED. It only existed to
// back Privy's own useSmartWallets(), which nothing in this app calls
// anymore — see hooks/useTrustRampSmartWallet.js and lib/smartAccount.js.
// Privy's SIWE-based smart-wallet linking 422s unconditionally on chain
// 1952 regardless of auth method, embedded-wallet state, or retry — full
// history in lib/smartAccount.js. Leaving the provider mounted would just
// keep firing that doomed SIWE request in the background on every login.
//
// PrivyProvider still does the one job we DO need from Privy: creates and
// custodies the embedded EOA (the raw signing key). Everything from "turn
// that key into a smart account" onward is now handled directly via
// permissionless.js against Alchemy's bundler — see lib/smartAccount.js.
//
// The Privy dashboard's Smart Wallets config (bundler/paymaster URL, gas
// policy) is no longer read at runtime by anything — it was only ever
// consumed by the code path just removed. Keep it filled in anyway, since
// it's harmless and documents "this app's bundler is Alchemy" for anyone
// checking the dashboard. The values that now actually matter at runtime
// live in frontend/.env: VITE_ALCHEMY_BUNDLER_URL and
// config/contracts.js's GAS_POLICY_ID_REFERENCE.
//
// PROVIDER HISTORY — read before changing this again:
// thirdweb was chosen originally on the belief that it "explicitly lists X
// Layer support." That was wrong: its marketing pages cover X Layer, but its
// AA bundler rejects the chain outright (`Invalid chain: 1952` AND
// `Invalid chain: 196`). That produced the long-running
// `getAddress returned no data ("0x")` failure — thirdweb's AccountFactory is
// simply not deployed on 1952 (eth_getCode -> 0x on two independent RPCs).
//
// Providers verified live against chain 1952 on Aug 10 2026:
//   thirdweb — NO  (`Invalid chain: 1952`)
//   Pimlico  — NO  (`chain "1952" is not supported`, tested with a valid key)
//   Biconomy — NO  (docs claim legacy-only support; bundler host refuses TCP 443)
//   Alchemy  — YES (eth_supportedEntryPoints returns v0.6 + v0.7;
//                   rundler_maxPriorityFeePerGas -> 0x186a0)
// EntryPoint v0.6 and v0.7 ARE both deployed on 1952, so self-hosting Alto
// remains a fallback if Alchemy is ever dropped. Do not trust a vendor's
// supported-chains page here — confirm with a live bundler request first.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || "REPLACE_WITH_PRIVY_APP_ID"}
      config={{
        loginMethods: ["passkey", "email"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: xLayerTestnet,
        supportedChains: [xLayerTestnet],
        appearance: { theme: "dark", accentColor: "#D8A657" },
      }}
    >
      {/* Shared reactive signal for purchase-flow transactions. Kept innermost
          because only components below <App /> consume it, and it should not
          outlive the authenticated session. */}
      <PurchaseFlowProvider>
        <App />
      </PurchaseFlowProvider>
    </PrivyProvider>
  </React.StrictMode>
);
