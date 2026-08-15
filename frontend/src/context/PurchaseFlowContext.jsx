import { createContext, useCallback, useContext, useRef, useState } from "react";

// Shared reactive signal for the purchase flow.
//
// Two sibling components (PracticeFlow and ReputationQuiz today, more coming on
// Day 11-12) need to know when a purchase-flow transaction lands on the same
// smart account, without one component being told the other exists. That's the
// classic case for a shared context — light, no runtime cost, no dependency,
// and Day 11-12's mainnet purchase can inherit the same mechanism without
// reshaping any of this.
//
// DESIGN CONSTRAINT (approved Aug 15): the signal is emitted for EVERY tx kind
// (faucet, approve, buy) — filtering is the consumer's job. The reason is that
// Day 11-12 needs consumers with different filtering needs (a receipt UI wants
// only `buy`; a spending-cap indicator wants only `buy` too but on mainnet; a
// future gas-usage widget might want all three). Filtering at emission would
// force us to add a new event type every time a new consumer appears.

const PurchaseFlowContext = createContext(null);

/**
 * Provider. Owns the "last-transaction" state and exposes:
 *   - lastTx:            { kind, address, hash, at } | null   for consumers to react to
 *   - emitTransaction:   ({ kind, address, hash }) => void    for producers
 *
 * lastTx is a REPLACEMENT rather than a queue. A consumer only ever cares about
 * "is there fresh news since the last time I looked", and the timestamp/hash
 * combined form a stable dependency key. Queues would need a per-consumer read
 * cursor, which is more mechanism than this needs.
 */
export function PurchaseFlowProvider({ children }) {
  const [lastTx, setLastTx] = useState(null);
  // Monotonic tick so an identical (kind,address,hash) tuple — which shouldn't
  // happen but is cheap to defend against — still re-triggers a consumer that
  // depends on lastTx.at.
  const seqRef = useRef(0);

  const emitTransaction = useCallback((event) => {
    if (!event || typeof event !== "object") return;
    const { kind, address, hash } = event;
    if (!kind || !address) return;
    seqRef.current += 1;
    const payload = { kind, address, hash: hash || null, at: Date.now(), seq: seqRef.current };
    // Producer-side log. Consumers add their own [TR-*] lines so the trail
    // shows which side of the signal is doing what.
    console.log(
      `[TR-PURCHASE-EVENT] EMITTED kind=${kind} address=${address} hash=${hash ? hash.slice(0, 10) + "…" : "(none)"} seq=${payload.seq}`
    );
    setLastTx(payload);
  }, []);

  return (
    <PurchaseFlowContext.Provider value={{ lastTx, emitTransaction }}>
      {children}
    </PurchaseFlowContext.Provider>
  );
}

/**
 * Consumers. Safe to call outside the provider — returns inert no-ops so a
 * component that mounts before the tree is fully wired up doesn't crash and
 * doesn't accidentally start firing events into the void.
 */
export function usePurchaseFlow() {
  const ctx = useContext(PurchaseFlowContext);
  if (ctx) return ctx;
  return { lastTx: null, emitTransaction: () => {} };
}
