// Replaces `useSmartWallets()` from "@privy-io/react-auth/smart-wallets".
//
// Exposes the same `{ client, getClientForChain }` shape the rest of the app
// already consumes (App.jsx's diagnostics probe, usePracticePurchase.js's
// paymaster-ready poll), so those files only need an import swap, not a
// rewrite. See lib/smartAccount.js for why this exists.
//
// `getClientForChain({ id })` matches Privy's signature: called repeatedly
// from a poll loop, expected to return undefined/null until ready, then the
// client once it is. Here it resolves as soon as the one-time build
// finishes — there's no per-chain lookup since this app only ever targets
// ACTIVE_NETWORK.chainId, but the shape is kept so the callers don't need to
// change their polling logic.

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createTrustRampSmartAccountClient } from "../lib/smartAccount.js";

export function useTrustRampSmartWallet() {
  const { wallets, ready: walletsReady } = useWallets();
  const [client, setClient] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | building | ready | error
  const [error, setError] = useState(null);
  const buildRef = useRef(null); // in-flight promise, so concurrent calls share one build

  const embeddedWallet = walletsReady
    ? wallets.find((w) => w.walletClientType === "privy")
    : null;

  const build = useCallback(async () => {
    if (!embeddedWallet) return null;
    if (buildRef.current) return buildRef.current;

    setStatus("building");
    const promise = createTrustRampSmartAccountClient(embeddedWallet)
      .then((c) => {
        setClient(c);
        setStatus("ready");
        setError(null);
        return c;
      })
      .catch((err) => {
        console.log(`[TR-SMART-ACCOUNT] build FAILED: ${err?.message || err}`);
        setStatus("error");
        setError(err?.message || String(err));
        buildRef.current = null; // allow retry
        return null;
      });

    buildRef.current = promise;
    return promise;
  }, [embeddedWallet]);

  // Auto-build once, as soon as an embedded wallet exists — mirrors how
  // Privy's own SmartWalletsProvider auto-triggered on login.
  useEffect(() => {
    if (embeddedWallet && !client && status === "idle") {
      build();
    }
  }, [embeddedWallet, client, status, build]);

  // Matches Privy's `getClientForChain({ id })` signature. Chain id is
  // accepted for interface compatibility but not branched on — this app
  // only ever targets one chain (ACTIVE_NETWORK.chainId).
  const getClientForChain = useCallback(
    async (_args) => {
      if (client) return client;
      return build();
    },
    [client, build]
  );

  return { client, getClientForChain, status, error };
}
