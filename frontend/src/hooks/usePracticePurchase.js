import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, encodeFunctionData, formatUnits, parseUnits } from "viem";
// SIWE-BYPASS (2026-08-17). See lib/smartAccount.js for why. Same
// `{ client, getClientForChain }` shape as Privy's hook, aliased so nothing
// below this line needs to change.
import { useTrustRampSmartWallet as useSmartWallets } from "./useTrustRampSmartWallet.js";
import { usePurchaseFlow } from "../context/PurchaseFlowContext.jsx";
import {
  ACTIVE_NETWORK,
  ERC20_ABI,
  SALE_ABI,
  ASSET_DECIMALS,
  PAYMENT_DECIMALS,
} from "../config/contracts.js";
import { apiUrl } from "../config/api.js";

// Day 5-6 practice purchase: approve -> buy against MockRWASale.
//
// TESTNET TODAY, SAME PATH ON MAINNET LATER. Everything chain-specific comes
// from config/contracts.js. What Day 11-12 adds is NOT a rewrite of this file:
// it is (a) a server-side spending-cap check before `approve`, and (b) a
// human-approval gate before `buy`. Both are server-enforced; see the note on
// `serverGate` below.
//
// PLAIN ENGLISH:
// - "allowance" = how much of your payment token you have permitted the sale
//   contract to take. Zero means it can take nothing.
// - "user operation" = a smart-account transaction. Gas is paid by the Alchemy
//   paymaster, not by the user, so an empty wallet can still transact.

const { contracts } = ACTIVE_NETWORK;

const publicClient = createPublicClient({
  chain: ACTIVE_NETWORK.chain,
  transport: http(undefined, { retryCount: 2, timeout: 10_000 }),
});

const STEP_STORAGE_KEY = "trustramp.practicestep.v1";

export const STEP = {
  IDLE: "idle",
  OVERVIEW: "overview",
  APPROVAL: "approval",
  APPROVAL_DONE: "approval_done",
  PURCHASE: "purchase",
  PURCHASE_DONE: "purchase_done",
};

export function usePracticePurchase(smartAccountAddress) {
  const { client: smartWalletClient, getClientForChain } = useSmartWallets();
  const { emitTransaction } = usePurchaseFlow();

  const [state, setState] = useState({
    loading: false,
    error: null,
    paymentBalance: 0n,
    assetBalance: 0n,
    allowance: 0n,
    pricePerToken: 0n,
    availableSupply: 0n,
    faucetRemaining: 0n,
  });

  // Step progress persists per account. Previously this was pure in-memory
  // state, so closing the tab dropped a user who had already claimed the faucet
  // and approved back to "Start the walkthrough" — with funds in hand and no
  // sign of the progress they'd made.
  //
  // Same read-timing rule as the chat history: never read or write under a
  // placeholder key before the address resolves, or the value is saved somewhere
  // no later session will look.
  const [step, setStep] = useState(STEP.IDLE);
  const stepLoadedForRef = useRef(null);
  // Gates the WRITE effect until the restore for this address has run.
  //
  // Without it there is a clobber race: on the commit where the address
  // arrives, effects run in declaration order — the read effect calls
  // setStep(saved), which only SCHEDULES a re-render, so `step` in the write
  // effect's closure is still IDLE, and it writes IDLE over the saved value.
  // It self-corrects on the next render, but a tab closed inside that window
  // would persist the wrong step. Cheap to prevent, so prevented.
  const stepRestoredRef = useRef(false);
  // The value the restore decided on. `stepRestoredRef` alone is NOT enough:
  // setStep() only SCHEDULES an update, so the write effect runs later in the
  // SAME commit still holding the old `step` (idle) in its closure and writes
  // idle over the saved value. Proved by the [TR-STEP] log:
  //   READ saved=purchase_done -> WROTE step=idle -> WROTE step=purchase_done
  // The write effect therefore refuses to persist anything until `step` has
  // actually caught up to the restore target.
  const restoreTargetRef = useRef(null);

  /**
   * Where the CHAIN says this account got to. Used only when localStorage has
   * nothing for them — a new browser, cleared storage, or another device.
   *
   * Deliberately conservative: it can only infer positions that leave on-chain
   * evidence. A user who read the overview but approved nothing looks identical
   * to one who never started, because it is — nothing was signed.
   */
  const deriveStepFromChain = useCallback(() => {
    // Holding the asset means at least one purchase completed.
    if (state.assetBalance > 0n) return STEP.PURCHASE_DONE;
    // An outstanding allowance means they approved but have not bought yet.
    if (state.allowance > 0n) return STEP.PURCHASE;
    return STEP.IDLE;
  }, [state.assetBalance, state.allowance]);

  useEffect(() => {
    if (!smartAccountAddress) return;
    if (stepLoadedForRef.current === smartAccountAddress) return;
    // Wait for the first successful chain read, otherwise the derivation runs
    // against zeroed placeholder state and always yields IDLE.
    if (state.loading) return;
    stepLoadedForRef.current = smartAccountAddress;
    try {
      const saved = window.localStorage.getItem(`${STEP_STORAGE_KEY}:${smartAccountAddress}`);
      console.log(
        `[TR-STEP] READ key=${STEP_STORAGE_KEY}:${smartAccountAddress} saved=${saved ?? "(null)"} ` +
          `derived=${deriveStepFromChain()} assetBal=${state.assetBalance} allowance=${state.allowance}`
      );
      // localStorage is AUTHORITATIVE when present, including when it says IDLE
      // — that is what makes "Run it again" survive a reload. Chain derivation
      // is only a fallback for a new browser / cleared storage / another device.
      const target =
        saved && Object.values(STEP).includes(saved) ? saved : deriveStepFromChain();
      restoreTargetRef.current = target;
      setStep((current) => (current === STEP.IDLE ? target : current));
    } catch {
      /* storage unavailable — start from the beginning, no user-visible failure */
    } finally {
      stepRestoredRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAccountAddress, state.loading, deriveStepFromChain]);

  useEffect(() => {
    if (!smartAccountAddress) return;
    if (!stepRestoredRef.current) {
      console.log(`[TR-STEP] WRITE SKIPPED (restore not run yet) step=${step}`);
      return; // never write before restoring
    }
    // The restore has decided on a value but `step` may not have caught up yet
    // (setStep is asynchronous). Writing here would persist the stale default —
    // this is the exact idle-clobber the [TR-STEP] log caught. Once `step`
    // matches the target, the restore is complete and normal writes resume.
    if (restoreTargetRef.current !== null && step !== restoreTargetRef.current) {
      console.log(
        `[TR-STEP] WRITE SKIPPED (awaiting restore to "${restoreTargetRef.current}") step=${step}`
      );
      return;
    }
    restoreTargetRef.current = null;
    try {
      window.localStorage.setItem(`${STEP_STORAGE_KEY}:${smartAccountAddress}`, step);
      console.log(`[TR-STEP] WROTE step=${step} key=${STEP_STORAGE_KEY}:${smartAccountAddress}`);
    } catch {
      /* non-fatal */
    }
  }, [step, smartAccountAddress]);

  const [busy, setBusy] = useState(null); // 'faucet' | 'approve' | 'buy' | null
  const [txHashes, setTxHashes] = useState({ faucet: null, approve: null, buy: null });
  const [txError, setTxError] = useState(null);
  const [lastFailedAction, setLastFailedAction] = useState(null); // for the Retry button
  const [capError, setCapError] = useState(null);

  // Human-approval modal state. `send()` sets this before entering the retry
  // loop and awaits the user's decision. The consuming component renders
  // <ApprovalModal> when this is non-null.
  const [pendingApproval, setPendingApproval] = useState(null);
  const approvalResolveRef = useRef(null);

  /**
   * User-triggered restart of the practice walkthrough.
   *
   * Resets ONLY the UI step and the per-run transaction records. It does not
   * touch the account, the chain, balances, or allowances — a completed purchase
   * stays purchased and the tokens stay held. There is deliberately NO automatic
   * reset anywhere: returning to "Done" and choosing to go again is the user's
   * call, and being silently dumped back to the start would read as the app
   * having forgotten them.
   *
   * Repeat runs are affordable by design: the faucet allows 5,000 DEMO-USDC per
   * address and a purchase costs 2, so roughly 500 runs per account.
   */
  const restartFlow = useCallback(() => {
    setTxError(null);
    setTxHashes({ faucet: null, approve: null, buy: null });
    setStep(STEP.IDLE);
  }, []);

  // --- Smart wallet readiness -----------------------------------------------
  //
  // THE BUG THIS EXISTS TO PREVENT (reproduced on fresh passkey signups,
  // Aug 11): useSmartWallets() returns a client with a resolved account address
  // BEFORE its paymaster is wired up. A send in that window goes out as an
  // ORDINARY transaction from an account holding zero OKB, and the chain
  // answers "gas required exceeds allowance (0)". The user sees a broken app
  // and a retry fixes it — but a judge trying the demo cold will not know to
  // retry, and shouldn't have to.
  //
  // FIRST ATTEMPT (removed): infer readiness from `client.account.address` plus
  // a 1.2s "client reference stopped changing" settle window. It did not work —
  // the raw error still surfaced on a fresh signup and only the retry backstop
  // saved the flow. Object-identity stability is a proxy for initialisation, not
  // a measurement of it, and the proxy is wrong.
  //
  // THIS VERSION uses Privy's own async accessor instead of guessing.
  // useSmartWallets() exposes:
  //   getClientForChain: ({ id }) => Promise<SmartWalletClientType | undefined>
  // It RESOLVES once the client for that chain is fully constructed — including
  // the paymaster, which is the piece whose absence produced
  // "gas required exceeds allowance (0)" by sending unsponsored. Awaiting a
  // promise that Privy resolves is a real readiness signal; a timer is not.
  //
  // We also keep the resolved client and send through IT rather than through the
  // possibly-half-built `client` from the render.
  // ATTEMPT 3 — measure paymaster ATTACHMENT, not client existence.
  //
  // THE CAUSAL CHAIN (from the installed libraries, not inference):
  //   permissionless/clients/createSmartAccountClient.js hangs the paymaster on
  //   the client itself:
  //     Object.assign(createClient({...}), { paymaster, paymasterContext, ... })
  //   Privy only supplies one once its config has arrived:
  //     let y = paymasterUrl ? createPimlicoClient(...) : void 0
  //   and viem's prepareUserOperation.js:65 reads:
  //     const paymaster = parameters.paymaster ?? bundlerClient?.paymaster
  //   So a client built before the paymaster URL lands has paymaster:undefined,
  //   the op is built unsponsored, and the account pays its own gas — which it
  //   cannot, holding 0 OKB. That is "gas required exceeds allowance (0)".
  //
  // Attempts 1 and 2 checked that construction had FINISHED. A client can be
  // fully constructed and still have no paymaster in it. This checks for the
  // paymaster itself, then probes the live service before enabling anything.
  const [readyState, setReadyState] = useState({ ready: false, phase: "waiting", error: null });
  const readyClientRef = useRef(null);
  const READY_TIMEOUT_MS = 20_000;

  // SIWE-RACE FIX (2026-08-17). Previously this effect depended on the
  // `smartWalletClient` OBJECT and started polling `getClientForChain`
  // immediately, even before the smart wallet had been linked with Privy.
  // Concurrent unlinked `getClientForChain` calls (this loop + the diagnostics
  // loop in App.jsx) each triggered Privy's internal `linkSmartWallet` SIWE
  // flow, and the second POST to auth.privy.io/v1/siwe/link_smart_wallet 422'd
  // with "Invalid SIWE message and/or signature" because the first had
  // already consumed the nonce. Symptom: fresh accounts couldn't create a
  // smart wallet on X Layer testnet.
  //
  // Two changes stop the race:
  //   1. Gate on `smartWalletClient?.account?.address` existing — once the
  //      address is populated, Privy has already completed the SIWE link,
  //      so subsequent `getClientForChain` calls hit its cache and don't
  //      retrigger the flow.
  //   2. Depend on the address STRING (not the client object). The client
  //      object reference changes multiple times during construction and
  //      each change restarted the poll loop, producing the two `tMs`-
  //      distinct `[TR-PAYMASTER] hasClient:true` lines seen in the failing
  //      console. A string dep transitions once (null → address) and stays
  //      stable after.
  const smartAccountAddr = smartWalletClient?.account?.address ?? null;
  useEffect(() => {
    let cancelled = false;
    readyClientRef.current = null;
    setReadyState({ ready: false, phase: "waiting", error: null });
    if (!getClientForChain) return;
    if (!smartAccountAddr) return;

    (async () => {
      const started = Date.now();
      // Diagnostic logging is now transition-only. Before 2026-08-17 this
      // printed on EVERY poll (every 500ms) which produced 30+ lines per page
      // load and buried real errors. Once the paymaster wiring was settled the
      // per-poll snapshot stopped earning its keep — but the FIRST snapshot,
      // and any CHANGE in the observable signals, still matter for the next
      // regression report.
      let lastSig = null;
      let lastErr = null;
      while (!cancelled && Date.now() - started < READY_TIMEOUT_MS) {
        try {
          const c = await getClientForChain({ id: ACTIVE_NETWORK.chainId });
          const sig =
            (c ? "1" : "0") +
            (c?.account?.address ? "1" : "0") +
            (c?.paymaster ? "1" : "0");
          if (sig !== lastSig) {
            lastSig = sig;
            console.log(
              "[TR-PAYMASTER] " +
                JSON.stringify({
                  tMs: Date.now() - started,
                  hasClient: Boolean(c),
                  hasAccount: Boolean(c?.account?.address),
                  paymasterTypeof: typeof c?.paymaster,
                  paymasterPresent: Boolean(c?.paymaster),
                  paymasterKeys: c?.paymaster ? Object.keys(c.paymaster).slice(0, 8) : null,
                  paymasterContext: c?.paymasterContext ?? null,
                })
            );
          }

          if (c?.account?.address && c.paymaster) {
            readyClientRef.current = c;
            if (!cancelled) setReadyState({ ready: true, phase: "ready", error: null });
            return;
          }
        } catch (err) {
          const msg = err?.message || String(err);
          if (msg !== lastErr) {
            lastErr = msg;
            console.log("[TR-PAYMASTER] poll error:", msg);
          }
        }
        // Poll for a CONDITION. The button is enabled by an observed value, not
        // by elapsed time — the interval is only how often we look.
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        console.log("[TR-PAYMASTER] TIMEOUT after 20s — gas sponsorship never wired up");
        setReadyState({
          ready: false,
          phase: "timeout",
          error: "Your account's gas sponsorship didn't finish setting up.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getClientForChain, smartAccountAddr]);

  const ready = readyState.ready;

  /**
   * @param {bigint} [atBlock] Read state AS OF this block.
   *
   * WHY THIS PARAMETER EXISTS (Aug 12). After a purchase we call refresh()
   * immediately following waitForTransactionReceipt. The receipt proves the
   * transaction is mined, but the follow-up balance read is a SEPARATE request
   * and the public RPC sits behind a load balancer — it can be served by a node
   * that has not yet caught up, returning the PRE-transaction balance. That is
   * read-your-write inconsistency, and it made the summary block sit exactly one
   * purchase behind.
   *
   * It was invisible in the narration because the tutor is handed both the
   * balance AND the amount being bought, so the model computed the correct
   * post-purchase figure and printed "you now hold 6 (up from 5)" beside a
   * summary line reading 5. The narration was right by accident, not by reading
   * anything fresher — both used the same stale number.
   *
   * Pinning the read to the receipt's block makes it read-your-write consistent:
   * any node answering for that block necessarily includes the transaction.
   */
  const refresh = useCallback(async (atBlock) => {
    if (!smartAccountAddress) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    const at = atBlock !== undefined ? { blockNumber: atBlock } : {};
    try {
      const [paymentBalance, assetBalance, allowance, pricePerToken, availableSupply, faucetRemaining] =
        await Promise.all([
          publicClient.readContract({
            address: contracts.paymentToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [smartAccountAddress],
            ...at,
          }),
          publicClient.readContract({
            address: contracts.assetToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [smartAccountAddress],
            ...at,
          }),
          publicClient.readContract({
            address: contracts.paymentToken,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [smartAccountAddress, contracts.sale],
            ...at,
          }),
          publicClient.readContract({
            address: contracts.sale,
            abi: SALE_ABI,
            functionName: "pricePerTokenUnits",
            ...at,
          }),
          publicClient.readContract({
            address: contracts.sale,
            abi: SALE_ABI,
            functionName: "availableSupply",
            ...at,
          }),
          publicClient.readContract({
            address: contracts.paymentToken,
            abi: ERC20_ABI,
            functionName: "faucetRemainingFor",
            args: [smartAccountAddress],
            ...at,
          }),
        ]);
      console.log(
        `[TR-BALANCE] read @${atBlock !== undefined ? `block ${atBlock}` : "latest"} ` +
          `t=${new Date().toISOString()} asset=${formatUnits(assetBalance, ASSET_DECIMALS)} ` +
          `payment=${formatUnits(paymentBalance, PAYMENT_DECIMALS)} ` +
          `allowance=${formatUnits(allowance, PAYMENT_DECIMALS)}`
      );
      setState({
        loading: false,
        error: null,
        paymentBalance,
        assetBalance,
        allowance,
        pricePerToken,
        availableSupply,
        faucetRemaining,
      });
    } catch (err) {
      // Fail visibly. Showing a zero balance we did not actually read would be a
      // confident claim about the user's own money that we cannot support.
      setState((s) => ({
        ...s,
        loading: false,
        error: err?.shortMessage || err?.message || "Could not read the chain.",
      }));
    }
  }, [smartAccountAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Quote from the contract itself rather than recomputing price in JS. */
  const quote = useCallback(async (tokenAmountWei) => {
    return publicClient.readContract({
      address: contracts.sale,
      abi: SALE_ABI,
      functionName: "costFor",
      args: [tokenAmountWei],
    });
  }, []);

  // Sends one user operation and waits for it to land. Privy's smart wallet
  // client handles fee estimation and the paymaster internally — we deliberately
  // do NOT pass our own gas values here. If a first-ever transaction from a
  // brand-new account fails, PROJECT_PLAN §1d lists the two known culprits
  // (priority-fee floor, verificationGasLimit band) with their exact signatures.
  const send = useCallback(
    async (label, to, data, txMeta, mainnetGate) => {
      // Send through the client Privy RESOLVED, never the one from render — the
      // latter can still be mid-construction. If readiness hasn't landed yet we
      // await it here rather than firing early; the button is disabled in that
      // state anyway, so this is the second line of defence.
      let client = readyClientRef.current;
      if (!client) {
        try {
          client = await getClientForChain?.({ id: ACTIVE_NETWORK.chainId });
          if (client?.account?.address) readyClientRef.current = client;
        } catch {
          /* falls through to the guard below */
        }
      }
      if (!client?.account?.address) {
        throw new Error("Your account is still being set up — give it a moment and try again.");
      }
      setBusy(label);
      setTxError(null);
      setLastFailedAction(null);
      setCapError(null);

      // ==================================================================
      // MAINNET SPENDING-CAP GATE (before the human-approval modal)
      // ==================================================================
      // On mainnet purchases, the server validates the amount against the
      // $25 lifetime cap and HMAC-signs the transaction parameters. If the
      // cap is exceeded, we surface the error and never open the modal.
      let preparedTx = null;
      if (mainnetGate) {
        try {
          const prepRes = await fetch(apiUrl("/api/prepare-transaction"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
            },
            body: JSON.stringify({
              userAddress: mainnetGate.userAddress,
              amountUsd: mainnetGate.amountUsd,
              network: "mainnet",
            }),
          });
          const prepData = await prepRes.json();
          if (!prepRes.ok) {
            const msg = prepData.error || "Transaction could not be prepared.";
            setCapError(msg);
            setBusy(null);
            return;
          }
          preparedTx = prepData.preparedTx;
        } catch (err) {
          setCapError("Could not reach the server to validate this transaction. Please try again.");
          setBusy(null);
          return;
        }
      }

      // ==================================================================
      // HUMAN-APPROVAL GATE
      // ==================================================================
      // The SIWE-bypass (2026-08-17) replaced Privy's smart-wallet client
      // with useTrustRampSmartWallet.js, whose client.sendTransaction has
      // no UI step at all. Every transaction on this path — testnet
      // included — submits with no human click unless gated here.
      //
      // On mainnet, the modal shows the server's plain-language summary and
      // risk notes from prepare-transaction, not client-derived text.
      const modalMeta = preparedTx
        ? {
            ...txMeta,
            label: "Purchase asset tokens (mainnet)",
            amount: `$${preparedTx.valueUsd.toFixed(2)} USD`,
            summary: preparedTx.plainLanguageSummary,
            riskNotes: preparedTx.riskNotes,
            network: "X Layer Mainnet",
          }
        : txMeta;
      //
      // This prompt sits ONCE, before the retry loop — a transient-error
      // retry never re-prompts for the same transaction.
      try {
        await new Promise((resolve, reject) => {
          approvalResolveRef.current = { resolve, reject };
          setPendingApproval(modalMeta);
        });
      } catch {
        setBusy(null);
        setPendingApproval(null);
        approvalResolveRef.current = null;
        return;
      } finally {
        setPendingApproval(null);
        approvalResolveRef.current = null;
      }

      // ==================================================================
      // MAINNET APPROVE GATE (after the human clicked Approve)
      // ==================================================================
      // The server verifies the HMAC, debits the spending cap, and returns
      // { allowed: true } only if everything checks out. The frontend uses
      // preparedTx.to from the server response, not a client-derived address.
      if (preparedTx) {
        try {
          const appRes = await fetch(apiUrl("/api/approve-transaction"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
            },
            body: JSON.stringify({
              preparedTx,
              humanApproved: true,
            }),
          });
          const appData = await appRes.json();
          if (!appData.allowed) {
            setCapError(appData.reason || "Transaction was not approved by the server.");
            setBusy(null);
            return;
          }
          // Use the server-verified contract address for execution.
          to = preparedTx.to;
          // Rebuild calldata with server-verified parameters so the amount
          // that was cap-checked is the amount that executes.
          if (mainnetGate.rebuildData) {
            data = mainnetGate.rebuildData(preparedTx);
          }
        } catch (err) {
          setCapError("Could not reach the server to finalize approval. Please try again.");
          setBusy(null);
          return;
        }
      }

      // The readiness settle window above is a heuristic, not a guarantee, so
      // this is the backstop: retry the KNOWN-transient initialisation failures
      // automatically. Deliberately narrow — a genuine revert (insufficient
      // funds, bad allowance, exhausted supply) must surface immediately rather
      // than being retried three times and reported a minute later.
      const TRANSIENT = [
        "gas required exceeds allowance", // sent unsponsored: paymaster not wired yet
        "invalid auth token", // wallet RPC session not established yet
        "401",
        "403", // intermittent CloudFront throttle on the X Layer RPC
        "failed to get block", // Privy's own fee-estimation guard
        "fetch failed",
        "network request failed",
      ];

      // Match against EVERY text field on the error, not just shortMessage.
      // viem nests the useful detail: shortMessage is often generic
      // ("User operation execution failed") while the substring that identifies
      // the failure lives in .details or .cause.message. Matching on the
      // narrow field silently defeated the retry and surfaced the panel.
      const errText = (e) =>
        [e?.shortMessage, e?.message, e?.details, e?.cause?.message, e?.cause?.details, String(e)]
          .filter(Boolean)
          .join(" | ")
          .toLowerCase();
      const isTransient = (e) => TRANSIENT.some((t) => errText(e).includes(t));

      // REVERTED to sendTransaction (Aug 11). A prepareUserOperation() probe
      // that asserted `prepared.paymaster` was here briefly and BROKE EVERY
      // TRANSACTION IN THE APP — faucet, approve and buy all route through this
      // function.
      //
      // Why it could never work: Privy runs Light Account v1.1.0 on EntryPoint
      // **v0.6**, where sponsorship is carried in the packed `paymasterAndData`
      // field. `paymaster`/`paymasterData` as separate fields are the v0.7
      // format, and viem deletes the v0.7 field on the way out:
      //   prepareUserOperation.js:352  if (typeof request.paymaster !== 'string')
      //                                   delete request.paymaster
      // So the assertion failed 100% of the time and the flow refused to send.
      //
      // sendTransaction lets Privy build and send the operation its own way,
      // which is the path that has completed every purchase this session. Do not
      // reintroduce a paymaster assertion here without first confirming, from a
      // real run, which field carries sponsorship on THIS entrypoint version.
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const hash = await client.sendTransaction({ to, data, value: 0n });
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: 180_000,
          });
          if (receipt.status !== "success") {
            throw new Error(`Transaction reverted on-chain (${hash}).`);
          }
          setTxHashes((h) => ({ ...h, [label]: hash }));
          // Broadcast for any sibling that cares. Emitted for EVERY kind
          // (faucet, approve, buy) — consumers filter. See PurchaseFlowContext.
          emitTransaction({ kind: label, address: smartAccountAddress, hash });
          // Read AS OF the block this transaction landed in, not "latest".
          // "latest" can be answered by a lagging node behind the RPC load
          // balancer, returning pre-transaction balances — which is what put the
          // summary block one purchase behind.
          console.log(
            `[TR-BALANCE] tx ${label} mined in block ${receipt.blockNumber}; refreshing pinned to that block`
          );
          await refresh(receipt.blockNumber);
          setBusy(null);
          return hash;
        } catch (err) {
          lastErr = err;
          // Developer-facing only. The user must NOT see a failure that is
          // about to be retried — `busy` stays set and `txError` stays null
          // until every attempt is exhausted, so the UI holds at "Approving…".
          console.log(
            `[TR-RETRY] attempt ${attempt}/3 failed, transient=${isTransient(err)} :: ${errText(err).slice(0, 200)}`
          );
          if (attempt < 3 && isTransient(err)) {
            // 1.2s, then 2.4s. Long enough for initialisation to finish, short
            // enough that it still feels like one click to the user.
            await new Promise((r) => setTimeout(r, 1200 * attempt));
            continue;
          }
          break;
        }
      }

      setBusy(null);
      setTxError(lastErr?.message || lastErr?.shortMessage || String(lastErr));
      setLastFailedAction({ label, to, data, txMeta, mainnetGate });
      throw lastErr;
    },
    [getClientForChain, refresh, emitTransaction, smartAccountAddress]
  );

  /** Manual retry for the last failed action — see the note on graceful failure
   *  in PracticeFlow. Even with the gate and the auto-retry, a user who hits a
   *  genuine transient (RPC blip, wallet closed) needs a way forward that isn't
   *  "reload the page and start again". */
  const retryLast = useCallback(async () => {
    if (!lastFailedAction) return;
    const { label, to, data, txMeta, mainnetGate: gate } = lastFailedAction;
    return send(label, to, data, txMeta, gate);
  }, [lastFailedAction, send]);

  const claimFaucet = useCallback(
    () =>
      send(
        "faucet",
        contracts.paymentToken,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "claimFaucet", args: [] }),
        {
          label: "Claim faucet tokens",
          amount: "Up to 5,000 DEMO-USDC",
          spender: contracts.paymentToken,
          token: "DEMO-USDC",
          network: ACTIVE_NETWORK.label,
        }
      ),
    [send]
  );

  /**
   * Approve EXACTLY the cost. Not unlimited, and not rounded up.
   *
   * This is the behaviour the tutor teaches and the quiz scores, so the code has
   * to actually do it — an "approve exact amounts" lesson taught over an
   * unlimited approval would be the precise dishonesty this product exists to
   * avoid.
   */
  const approveExact = useCallback(
    async (costUnits) => {
      return send(
        "approve",
        contracts.paymentToken,
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contracts.sale, costUnits],
        }),
        {
          label: "Approve spending",
          amount: `${formatUnits(costUnits, PAYMENT_DECIMALS)} DEMO-USDC`,
          spender: contracts.sale,
          token: "DEMO-USDC",
          network: ACTIVE_NETWORK.label,
        }
      );
    },
    [send]
  );

  const buy = useCallback(
    async (tokenAmountWei, maxPaymentIn) => {
      const isMainnet = ACTIVE_NETWORK.key === "mainnet";
      const gate = isMainnet
        ? {
            userAddress: smartAccountAddress,
            amountUsd: Number(formatUnits(maxPaymentIn, PAYMENT_DECIMALS)),
            rebuildData: (ptx) => {
              const serverMaxPayment = parseUnits(
                (ptx.valueCents / 100).toFixed(PAYMENT_DECIMALS),
                PAYMENT_DECIMALS
              );
              return encodeFunctionData({
                abi: SALE_ABI,
                functionName: "buy",
                args: [tokenAmountWei, serverMaxPayment],
              });
            },
          }
        : undefined;

      return send(
        "buy",
        contracts.sale,
        encodeFunctionData({
          abi: SALE_ABI,
          functionName: "buy",
          args: [tokenAmountWei, maxPaymentIn],
        }),
        {
          label: "Purchase asset tokens",
          amount: `${formatUnits(tokenAmountWei, ASSET_DECIMALS)} DEMO-xTBILL for ${formatUnits(maxPaymentIn, PAYMENT_DECIMALS)} DEMO-USDC`,
          spender: contracts.sale,
          token: "DEMO-xTBILL",
          network: ACTIVE_NETWORK.label,
        },
        gate
      );
    },
    [send, smartAccountAddress]
  );

  const approvePending = useCallback(() => {
    approvalResolveRef.current?.resolve();
  }, []);

  const cancelPending = useCallback(() => {
    approvalResolveRef.current?.reject(new Error("User cancelled"));
  }, []);

  return {
    ...state,
    step,
    setStep,
    busy,
    txHashes,
    txError,
    capError,
    clearCapError: useCallback(() => setCapError(null), []),
    ready,
    restartFlow,
    readyPhase: readyState.phase,
    readyError: readyState.error,
    canRetry: Boolean(lastFailedAction),
    retryLast,
    refresh,
    quote,
    claimFaucet,
    approveExact,
    buy,
    pendingApproval,
    approvePending,
    cancelPending,
    fmtPayment: (v) => formatUnits(v ?? 0n, PAYMENT_DECIMALS),
    fmtAsset: (v) => formatUnits(v ?? 0n, ASSET_DECIMALS),
    parseAsset: (v) => parseUnits(String(v), ASSET_DECIMALS),
  };
}
