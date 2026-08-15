import React from "react";
import ReactDOM from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { PurchaseFlowProvider } from "./context/PurchaseFlowContext.jsx";
import App from "./App.jsx";
import { xLayerTestnet } from "./chains.js";
import "./index.css";

// --- Day 2: wiring the actual ERC-4337 smart account (not just an EOA) ---
//
// Two pieces work together here, and BOTH must be set up before login
// creates a real smart account:
//
// 1. IN CODE (this file): PrivyProvider creates the passkey-signed embedded
//    wallet (the key that approves things). SmartWalletsProvider is what
//    turns that key into a smart contract account (an ERC-4337 wallet) that
//    can actually hold funds and send transactions. Without
//    SmartWalletsProvider, useSmartWallets() in App.jsx would have nothing
//    to return.
//
// 2. ON THE PRIVY DASHBOARD (cannot be done from code — Mo's task):
//    Settings -> Smart Wallets -> provider ALCHEMY (Light Account), then add
//    a custom chain for X Layer Testnet (chain ID 1952) and set:
//      - Bundler URL:   https://xlayer-testnet.g.alchemy.com/v2/<ALCHEMY_API_KEY>
//      - Paymaster URL: same URL, plus an Alchemy Gas Manager policy ID
//        (each policy is tied to one chain and one Alchemy project)
//      - RPC URL: the same Alchemy URL, or one of the URLs in chains.js
//    NOTE: the bundler URL must be set EXPLICITLY. If left blank Privy falls
//    back to Pimlico's public bundler, which returns
//    `chain "1952" is not supported` — verified live, Aug 10 2026.
//    Until this dashboard step is done, useSmartWallets() will not error,
//    but no smart account will be created on login — this is a "flip a
//    switch in a dashboard" step, not something I can wire blind from here.
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
      {/*
        No `config` prop on purpose. SmartWalletsProvider only accepts
        `{ paymasterContext }` (see the props type in
        @privy-io/react-auth/dist/dts/smart-wallets.d.ts) — and Privy already
        builds that from the Alchemy Gas Manager policy set in the dashboard.
        Passing it from code here would OVERRIDE the dashboard value, so the
        two could silently disagree. The dashboard is the single source of
        truth for both the bundler URL and the gas policy.
      */}
      <SmartWalletsProvider>
        {/* Shared reactive signal for purchase-flow transactions. Kept innermost
            because only components below <App /> consume it, and it should not
            outlive the authenticated session. */}
        <PurchaseFlowProvider>
          <App />
        </PurchaseFlowProvider>
      </SmartWalletsProvider>
    </PrivyProvider>
  </React.StrictMode>
);
