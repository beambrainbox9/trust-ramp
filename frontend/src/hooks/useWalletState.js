import { useState, useEffect } from "react";
import { createPublicClient, http, formatEther } from "viem";
import { xLayerTestnet } from "../chains.js";
import { ACTIVE_NETWORK, ERC20_ABI } from "../config/contracts.js";

// Day 3 — reads the user's ACTUAL on-chain state so the tutor can teach from it.
//
// Closes audit finding M-2: the backend has always accepted a `walletBalance`
// field, but the frontend never sent one, so the tutor believed every user's
// balance was unknown. PROJECT_PLAN §5 item 3 ("chat tutor reads wallet/account
// state") was not actually true until this existed.
//
// PLAIN ENGLISH:
// - "RPC" = the server we ask questions of the blockchain through ("what's this
//   address's balance?"). We never send anything secret to it.
// - "public client" = a read-only connection. It cannot sign or spend. There is
//   no key involved here at all, so nothing on this path can move funds.
// - "transaction count" (a.k.a. nonce) = how many transactions this account has
//   ever sent. For a brand-new account it's 0, which is a reliable signal that
//   someone is a genuine beginner rather than an experienced user who happens
//   to have an empty wallet.

const publicClient = createPublicClient({
  chain: xLayerTestnet,
  // viem falls through the RPC list in chains.js if the first is unreachable.
  transport: http(undefined, { retryCount: 2, timeout: 8000 }),
});

/**
 * Derives a coarse learner level from real chain state.
 *
 * Deliberately coarse. This feeds an AI prompt, not a permissions check —
 * over-precise buckets would produce confidently wrong assumptions about
 * someone's experience, which is exactly the failure mode this product exists
 * to avoid. Three buckets is enough to change how the tutor opens.
 */
/**
 * BUG 1 FIX (Aug 12). This used to key off `eth_getTransactionCount`, which is
 * WRONG for a smart account: for a contract, that call returns the CREATE
 * nonce, which EIP-161 initialises to 1 at deployment and which never moves for
 * user operations. Measured on two accounts each holding 3 DEMO-xTBILL after 3
 * purchases: both reported exactly 1, and would report 1 after a thousand.
 *
 * Token balances answer the question the tutor actually asks — "has this person
 * done anything yet?" — and cannot go stale in the same way. Holding the demo
 * asset can only happen by completing a purchase.
 */
function deriveLevel({ assetBalance, paymentBalance, balanceWei }) {
  if (assetBalance > 0n) return "has_activity";
  if (paymentBalance > 0n || balanceWei > 0n) return "funded_never_transacted";
  return "brand_new";
}

export function useWalletState(address) {
  const [state, setState] = useState({
    loading: false,
    error: null,
    balance: null, // string, in OKB
    level: null,
    chainName: xLayerTestnet.name,
  });

  useEffect(() => {
    if (!address) {
      setState((s) => ({ ...s, loading: false, error: null, balance: null, level: null }));
      return;
    }

    // Guards against a slow request for a previous address landing after a
    // faster one for the current address and overwriting it.
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const [balanceWei, assetBalance, paymentBalance] = await Promise.all([
          publicClient.getBalance({ address }),
          publicClient.readContract({
            address: ACTIVE_NETWORK.contracts.assetToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.readContract({
            address: ACTIVE_NETWORK.contracts.paymentToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
        ]);
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          balance: formatEther(balanceWei),
          level: deriveLevel({ assetBalance, paymentBalance, balanceWei }),
          chainName: xLayerTestnet.name,
        });
      } catch (err) {
        if (cancelled) return;
        // Fail visibly, not silently. If the RPC is unreachable the tutor must
        // NOT quietly fall back to teaching as though the wallet were empty —
        // that is a confident claim about the user's state we cannot support.
        setState({
          loading: false,
          error: err?.shortMessage || err?.message || "Could not reach the X Layer RPC.",
          balance: null,
                level: null,
          chainName: xLayerTestnet.name,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}
