import { useCallback, useEffect, useRef, useState } from "react";
import { usePracticePurchase, STEP } from "../hooks/usePracticePurchase.js";
import { GLOSSARY, DEFAULT_BUY_AMOUNT } from "../lib/glossary.js";
import {
  ACTIVE_NETWORK,
  ASSET_SYMBOL,
  PAYMENT_SYMBOL,
  txUrl,
} from "../config/contracts.js";
import { apiUrl } from "../config/api.js";

// Day 5-6 practice sandbox: AI-narrated approve -> buy on testnet.
//
// The narration is fetched from /api/narrate (server-side, so the Anthropic key
// stays off the client) and is passed the SAME glossary entries the later quiz
// will use, so the vocabulary cannot drift between teaching and testing.
//
// Each step is gated: the tutor explains BEFORE the user acts, never after.

const GLOSSARY_FOR = {
  overview: [GLOSSARY.approval, GLOSSARY.maxPaymentIn],
  approval: [GLOSSARY.approval],
  approval_done: [GLOSSARY.approval],
  purchase: [GLOSSARY.maxPaymentIn, GLOSSARY.slippage],
  purchase_done: [GLOSSARY.maxPaymentIn],
};

function Narration({ text, loading, error, onRetry }) {
  if (loading) {
    return <p className="text-paper/40 text-sm italic">The tutor is thinking…</p>;
  }
  if (error) {
    return (
      <div>
        <p className="text-guide/80 text-sm">
          The tutor couldn&apos;t load this explanation just now. Your account and your funds are
          unaffected — this is only the guidance text.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-guide text-sm underline hover:brightness-125"
          >
            Try loading it again
          </button>
        )}
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className="text-sm text-paper/80 leading-relaxed space-y-3">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((para, i) => (
          <p key={i}>{para}</p>
        ))}
    </div>
  );
}

function TxLink({ hash, label }) {
  if (!hash) return null;
  return (
    <p className="text-xs font-data text-paper/40 mt-2">
      {label}:{" "}
      <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="underline hover:text-guide">
        {hash.slice(0, 10)}…{hash.slice(-8)}
      </a>
    </p>
  );
}

// Persistence key for narration text. Mirrors trustramp.practicestep.v1 and
// trustramp.quiz.v1 — same address-scoped pattern, same instrumentation, so
// [TR-STEP] / [TR-QUIZ-STATE] / [TR-NARRATION] all read the same in the
// console. See §1f of PROJECT_PLAN.md.
//
// SHAPE: { [stepName]: { text, generatedAt } }. Includes ALL narrated steps
// (overview, approval, approval_done, purchase, purchase_done) — Done is not
// special-cased. Before this, Done "worked" on restore only because it was
// re-generated from a fresh AI call against possibly-since-changed on-chain
// state, which is the exact latent Bug-3 pattern (stale-summary vs live-quote).
// Bringing Done into the cache-replay path closes that regression window.
const NARRATION_STORAGE_KEY = "trustramp.stepnarration.v1";
// Cached text older than this is silently ignored — the on-chain state the
// narration described may have moved. 24h buffers against a returning user
// picking up the next day; older than that we prefer the static fallback.
const NARRATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readNarrationCache(address) {
  if (!address) return {};
  try {
    const raw = window.localStorage.getItem(`${NARRATION_STORAGE_KEY}:${address}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Prune entries older than the cap so this map doesn't grow stale silently.
    const now = Date.now();
    const fresh = {};
    for (const [step, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.text === "string" && typeof entry.generatedAt === "number") {
        if (now - entry.generatedAt <= NARRATION_MAX_AGE_MS) fresh[step] = entry;
      }
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeNarrationCache(address, cache) {
  if (!address) return;
  try {
    window.localStorage.setItem(`${NARRATION_STORAGE_KEY}:${address}`, JSON.stringify(cache));
  } catch {
    /* non-fatal */
  }
}

export default function PracticeFlow({ smartAccountAddress }) {
  const p = usePracticePurchase(smartAccountAddress);
  // Seeded lazily from cache so restore doesn't need a paint-and-swap. The
  // initializer runs before the first render, and any missing entries fall back
  // to the static line (see the Narration component). Cache is address-keyed,
  // so a switch of account doesn't inherit the previous account's paragraphs.
  const [narration, setNarration] = useState(() => {
    const cache = readNarrationCache(smartAccountAddress);
    const seeded = {};
    for (const [step, entry] of Object.entries(cache)) seeded[step] = entry.text;
    console.log(
      `[TR-NARRATION] INIT address=${smartAccountAddress || "(none)"} restored=[${Object.keys(seeded).join(",")}]`
    );
    return seeded;
  });
  // PER-STEP status, not a single shared flag. Previously one boolean covered
  // every step and the error was only rendered while that step was current — so
  // a step whose narration failed went permanently BLANK once the user moved on,
  // with no error, no explanation and no way to recover it. Seen live: a
  // transient "Connection error" to Anthropic left "What you're about to do"
  // empty for the rest of the session.
  const [narrationStatus, setNarrationStatus] = useState({}); // step -> loading|error|done
  const [cost, setCost] = useState(0n);
  // Declared here (not further down) because the restore effect below reads it
  // to mark cached steps as "already requested" so the fetch effect doesn't
  // re-request them. Refs are safe to reference from effects in any declaration
  // order, but keeping them source-adjacent to the effect that uses them makes
  // the intent obvious.
  const requestedRef = useRef(new Set());

  // Address-change restore. The useState initializer above runs ONCE at mount,
  // when smartAccountAddress may still be undefined (Privy resolves it a beat
  // later). This effect fills the cache in once the real address arrives.
  // Same trap that caught chat history persistence, same fix.
  const narrationLoadedForRef = useRef(null);
  useEffect(() => {
    if (!smartAccountAddress) return;
    if (narrationLoadedForRef.current === smartAccountAddress) return;
    narrationLoadedForRef.current = smartAccountAddress;
    const cache = readNarrationCache(smartAccountAddress);
    const seeded = {};
    for (const [step, entry] of Object.entries(cache)) seeded[step] = entry.text;
    if (Object.keys(seeded).length === 0) {
      console.log(`[TR-NARRATION] READ address=${smartAccountAddress} saved=(none)`);
      return;
    }
    console.log(
      `[TR-NARRATION] READ address=${smartAccountAddress} restored=[${Object.keys(seeded).join(",")}]`
    );
    // Merge rather than replace: if the user has already generated a step this
    // session, prefer the live copy. The cache is a floor, not a ceiling.
    setNarration((current) => ({ ...seeded, ...current }));
    // Mark restored steps as "done" so the Narration component doesn't flash a
    // spinner or a stale error state for them.
    setNarrationStatus((current) => {
      const next = { ...current };
      for (const step of Object.keys(seeded)) if (!next[step]) next[step] = "done";
      return next;
    });
    // Steps whose narration we already have should NOT be re-requested by the
    // fetch effect further down. Populate the ref-guard the same way.
    for (const step of Object.keys(seeded)) requestedRef.current.add(step);
  }, [smartAccountAddress]);

  const buyAmountWei = p.parseAsset(DEFAULT_BUY_AMOUNT);

  // Quote from the contract, never recomputed in JS — the contract rounds up and
  // reconciles 6-vs-18 decimals, and duplicating that here would eventually drift.
  useEffect(() => {
    let cancelled = false;
    p.quote(buyAmountWei)
      .then((c) => !cancelled && setCost(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [p.quote, buyAmountWei]);

  // requestedRef is declared higher up (alongside narrationStatus) because the
  // narration restore effect populates it. Narrate clears entries from it on
  // failure — see the catch branch below.

  const narrate = useCallback(
    async (stepName, attempt = 1) => {
      if (narration[stepName]) return; // already have it
      setNarrationStatus((s) => ({ ...s, [stepName]: "loading" }));
      try {
        const res = await fetch(apiUrl("/api/narrate"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
          },
          body: JSON.stringify({
            step: stepName,
            glossary: GLOSSARY_FOR[stepName] ?? [],
            context: {
              networkLabel: ACTIVE_NETWORK.label,
              paymentSymbol: PAYMENT_SYMBOL,
              assetSymbol: ASSET_SYMBOL,
              paymentBalance: Number(p.fmtPayment(p.paymentBalance)),
              assetBalance: Number(p.fmtAsset(p.assetBalance)),
              allowance: Number(p.fmtPayment(p.allowance)),
              buyAmount: DEFAULT_BUY_AMOUNT,
              cost: Number(p.fmtPayment(cost)),
              txHash: p.txHashes.approve || p.txHashes.buy || null,
            },
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setNarration((n) => ({ ...n, [stepName]: data.narration }));
        // Cache-through. Written per step as it arrives so a reload mid-flow
        // has everything to that point on hand. Address-keyed like the practice
        // step and quiz caches — no session leak between accounts. Empty
        // address means we can't cache; the user gets live text only for that
        // render, and the address-change restore effect will pick it up later.
        if (smartAccountAddress) {
          const existing = readNarrationCache(smartAccountAddress);
          const next = { ...existing, [stepName]: { text: data.narration, generatedAt: Date.now() } };
          writeNarrationCache(smartAccountAddress, next);
          console.log(
            `[TR-NARRATION] WROTE address=${smartAccountAddress} step=${stepName} chars=${data.narration.length}`
          );
        }
        setNarrationStatus((s) => ({ ...s, [stepName]: "done" }));
      } catch (err) {
        // The tutor's own upstream can blip — seen live as a 502 from
        // /api/narrate with "Narration error: Connection error." on the server,
        // i.e. Anthropic was briefly unreachable. One transient failure should
        // not permanently blank a teaching step, so retry twice before giving up.
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 900 * attempt));
          return narrate(stepName, attempt + 1);
        }
        console.log(`[TR-NARRATE] ${stepName} failed after ${attempt} attempts:`, err?.message);
        setNarrationStatus((s) => ({ ...s, [stepName]: "error" }));
        // Allow a later manual retry — see the effect below.
        requestedRef.current.delete(stepName);
      }
    },
    [narration, p, cost]
  );

  // Narrate each step as it becomes current.
  //
  // `narrate` closes over `p`, which is a NEW object every render, so listing it
  // as a dependency re-ran this effect on every render and could fire repeated
  // /api/narrate calls for the same step — burning the shared rate-limit budget
  // that /api/chat also draws on. Keyed on the step alone, with a ref guard so a
  // second render mid-flight cannot start a duplicate request.
  useEffect(() => {
    if (p.step === STEP.IDLE) return;
    // BUG 3 FIX (second fault). `cost` starts at the 0n placeholder and is
    // filled asynchronously by the quote effect. Narrating before it resolves
    // sent `cost: 0` to the tutor, which is why a purchase that cost 2
    // DEMO-USDC was narrated as costing 0. Wait for the real quote — and for
    // the chain read behind the balances — before asking for any narration.
    if (cost <= 0n) return;
    if (p.loading) return;
    if (requestedRef.current.has(p.step)) return;
    requestedRef.current.add(p.step);
    narrate(p.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.step, cost, p.loading]);

  // Every narration card reads its OWN status, so one step failing can never
  // blank another — and a failed step keeps a working Try again button rather
  // than silently rendering nothing.
  // Static fallback lines. Shown when a step's card is visible but its
  // narration is absent — an older session from before caching shipped, or an
  // edge case where the cache was pruned. Deliberately DOES NOT re-call
  // /api/narrate (that could produce fresh copy against changed on-chain state,
  // the exact Bug-3 pattern that motivated Done being cached in the first
  // place). A short honest note is safer than plausible-sounding stale prose.
  const STEP_FALLBACK = {
    [STEP.OVERVIEW]: "You completed this step — the walkthrough details aren't available for this older session.",
    [STEP.APPROVAL]: "You completed this approval step — the detailed explanation isn't available for this older session.",
    [STEP.APPROVAL_DONE]: "The approval landed on-chain — the follow-up explanation isn't available for this older session.",
    [STEP.PURCHASE]: "You completed this purchase step — the detailed explanation isn't available for this older session.",
    [STEP.PURCHASE_DONE]: "Your purchase landed on-chain — the summary explanation isn't available for this older session.",
  };

  const narrProps = (step) => {
    const cachedText = narration[step];
    const status = narrationStatus[step];
    // Only show the fallback when we've had a real chance to fetch (or restore)
    // and still have nothing. `loading` and `error` states own their own render
    // and must not be overridden.
    const isPastAndEmpty = !cachedText && status !== "loading" && status !== "error" && p.step !== step;
    return {
      text: cachedText || (isPastAndEmpty ? STEP_FALLBACK[step] : undefined),
      loading: status === "loading",
      error: status === "error",
      onRetry: () => narrate(step),
    };
  };

  if (!smartAccountAddress) return null;

  const needsFunds = p.paymentBalance < cost && cost > 0n;
  const box = "border border-paper/10 rounded-lg p-5 mt-6";

  return (
    <section className="mt-12">
      <h2 className="font-data text-xs tracking-widest text-guide uppercase mb-2">
        Practice purchase · {ACTIVE_NETWORK.label}
      </h2>

      {/* Gate A timed out. Never leave a beginner with a dead spinner and no
          explanation — say what happened, that nothing is broken on their side,
          and give them one concrete action. */}
      {p.readyPhase === "timeout" && (
        <div className="border border-guide/40 rounded-lg p-4 mt-4">
          <p className="text-guide text-sm font-medium mb-1">
            Your account isn't ready to transact yet
          </p>
          <p className="text-paper/70 text-sm mb-3">
            Gas for this practice round is paid for you, and that sponsorship hasn't finished
            connecting. Nothing is wrong with your account and nothing has been spent — this is on
            our side. Reloading the page usually sorts it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm"
          >
            Reload and try again
          </button>
          <p className="text-paper/40 text-xs font-data mt-3">
            If it keeps happening, the Alchemy Gas Manager policy for chain {ACTIVE_NETWORK.chainId}{" "}
            is the thing to check.
          </p>
        </div>
      )}
      <p className="text-paper/50 text-sm">
        A real transaction on a test network. The tokens are demo tokens and the money is not
        real — nothing here can cost you anything.
      </p>

      {/* --- 1. Current state --- */}
      <div className={box}>
        <h3 className="text-paper font-medium mb-3">Where you are now</h3>
        {p.loading ? (
          <p className="text-paper/40 text-sm">Reading the chain…</p>
        ) : p.error ? (
          <p className="text-guide/80 text-sm">Could not read your balances: {p.error}</p>
        ) : (
          <dl className="text-sm font-data space-y-1 text-paper/70">
            <div className="flex justify-between">
              <dt>{PAYMENT_SYMBOL} (what you pay with)</dt>
              <dd>{p.fmtPayment(p.paymentBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{ASSET_SYMBOL} (what you're buying)</dt>
              <dd>{p.fmtAsset(p.assetBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Price for {DEFAULT_BUY_AMOUNT} {ASSET_SYMBOL}</dt>
              <dd>{p.fmtPayment(cost)} {PAYMENT_SYMBOL}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Already approved</dt>
              <dd>{p.fmtPayment(p.allowance)} {PAYMENT_SYMBOL}</dd>
            </div>
          </dl>
        )}

        {needsFunds && (
          <div className="mt-4">
            <p className="text-paper/60 text-sm mb-2">
              You don't have enough {PAYMENT_SYMBOL} yet. On a test network you can mint some for
              free — a "faucet" is a function that hands out practice tokens. This only works here;
              it does not exist on the real network.
            </p>
            <button
              onClick={p.claimFaucet}
              disabled={p.busy !== null || !p.ready}
              className="bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {p.busy === "faucet"
                ? "Claiming…"
                : !p.ready
                ? "Preparing your account…"
                : `Get practice ${PAYMENT_SYMBOL}`}
            </button>
            <TxLink hash={p.txHashes.faucet} label="Faucet transaction" />
          </div>
        )}

        {p.step === STEP.IDLE && !needsFunds && (
          <button
            onClick={() => p.setStep(STEP.OVERVIEW)}
            className="mt-4 bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm"
          >
            Start the walkthrough
          </button>
        )}
      </div>

      {/* --- 2. Overview --- */}
      {p.step !== STEP.IDLE && (
        <div className={box}>
          <h3 className="text-paper font-medium mb-3">What you're about to do</h3>
          <Narration {...narrProps(STEP.OVERVIEW)} />
          {p.step === STEP.OVERVIEW && (
            <button
              onClick={() => p.setStep(STEP.APPROVAL)}
              className="mt-4 bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm"
            >
              Next: the approval
            </button>
          )}
        </div>
      )}

      {/* --- 3. Approval, explained BEFORE it happens --- */}
      {[STEP.APPROVAL, STEP.APPROVAL_DONE, STEP.PURCHASE, STEP.PURCHASE_DONE].includes(p.step) && (
        <div className={box}>
          <h3 className="text-paper font-medium mb-3">Step 1 — the approval</h3>
          <Narration {...narrProps(STEP.APPROVAL)} />
          <p className="text-xs text-paper/40 font-data mt-3">
            You will approve exactly {p.fmtPayment(cost)} {PAYMENT_SYMBOL} — not an unlimited amount.
          </p>
          {p.step === STEP.APPROVAL && (
            <button
              onClick={async () => {
                await p.approveExact(cost);
                p.setStep(STEP.APPROVAL_DONE);
              }}
              disabled={p.busy !== null || !p.ready}
              className="mt-4 bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {p.busy === "approve"
                ? "Approving…"
                : !p.ready
                ? "Preparing your account…"
                : `Approve ${p.fmtPayment(cost)} ${PAYMENT_SYMBOL}`}
            </button>
          )}
          <TxLink hash={p.txHashes.approve} label="Approval transaction" />
        </div>
      )}

      {/* --- 4. Approval confirmed --- */}
      {[STEP.APPROVAL_DONE, STEP.PURCHASE, STEP.PURCHASE_DONE].includes(p.step) && (
        <div className={box}>
          <h3 className="text-paper font-medium mb-3">What just changed</h3>
          <Narration {...narrProps(STEP.APPROVAL_DONE)} />
          {p.step === STEP.APPROVAL_DONE && (
            <button
              onClick={() => p.setStep(STEP.PURCHASE)}
              className="mt-4 bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm"
            >
              Next: the purchase
            </button>
          )}
        </div>
      )}

      {/* --- 5. Purchase, explained BEFORE it happens --- */}
      {[STEP.PURCHASE, STEP.PURCHASE_DONE].includes(p.step) && (
        <div className={box}>
          <h3 className="text-paper font-medium mb-3">Step 2 — the purchase</h3>
          <Narration {...narrProps(STEP.PURCHASE)} />
          <p className="text-xs text-paper/40 font-data mt-3">
            Maximum you will pay: {p.fmtPayment(cost)} {PAYMENT_SYMBOL}. If the price changed, this
            fails and you keep your funds.
          </p>
          {p.step === STEP.PURCHASE && (
            <button
              onClick={async () => {
                await p.buy(buyAmountWei, cost);
                p.setStep(STEP.PURCHASE_DONE);
              }}
              disabled={p.busy !== null || !p.ready}
              className="mt-4 bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {p.busy === "buy"
                ? "Buying…"
                : !p.ready
                ? "Preparing your account…"
                : `Buy ${DEFAULT_BUY_AMOUNT} ${ASSET_SYMBOL}`}
            </button>
          )}
          <TxLink hash={p.txHashes.buy} label="Purchase transaction" />
        </div>
      )}

      {/* --- 6. Done --- */}
      {p.step === STEP.PURCHASE_DONE && (
        <div className={box}>
          <h3 className="text-safe font-medium mb-3">Done</h3>
          <Narration {...narrProps(STEP.PURCHASE_DONE)} />
          <dl className="text-sm font-data space-y-1 text-paper/70 mt-4">
            <div className="flex justify-between">
              <dt>{ASSET_SYMBOL} now held</dt>
              <dd>{p.fmtAsset(p.assetBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{PAYMENT_SYMBOL} remaining</dt>
              <dd>{p.fmtPayment(p.paymentBalance)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Approval left over</dt>
              <dd>{p.fmtPayment(p.allowance)} {PAYMENT_SYMBOL}</dd>
            </div>
          </dl>

          {/* Repeating is genuinely useful here: rehearsing the exact steps a
              second time before real money is the point of a practice round.
              This resets the UI step only — the tokens you bought stay bought,
              balances and allowances are untouched. Nothing auto-resets; the
              user chooses. */}
          <div className="mt-5 pt-4 border-t border-paper/10">
            <p className="text-paper/50 text-sm mb-3">
              Want to go through it again? Your {ASSET_SYMBOL} stays where it is — this just
              takes you back to the start of the walkthrough.
            </p>
            <button
              onClick={() => {
                // BUG 3 FIX. restartFlow lives in the hook and can only reset
                // hook state; narration lives HERE. Without clearing both, the
                // next run re-displays the PREVIOUS run's narration — which is
                // how "you now hold 1 DEMO-xTBILL... it cost you 0" ended up
                // printed beside live numbers showing 3 held and 994 remaining.
                setNarration({});
                setNarrationStatus({});
                requestedRef.current.clear();
                // Also wipe the persisted cache so the next walkthrough gets
                // fresh narration keyed to fresh chain state, rather than
                // replaying the prior run's paragraphs from disk.
                if (smartAccountAddress) {
                  writeNarrationCache(smartAccountAddress, {});
                  console.log(`[TR-NARRATION] CLEARED address=${smartAccountAddress}`);
                }
                p.restartFlow();
              }}
              disabled={p.busy !== null}
              className="border border-guide/50 text-guide font-medium px-4 py-2 rounded-lg text-sm hover:bg-guide/10 transition disabled:opacity-50"
            >
              Run it again
            </button>
          </div>
        </div>
      )}

      {/* Graceful failure. Before this, a failed transaction left the raw error
          sitting on screen with no way forward — the user had to know to reload
          and start again, which a judge trying the demo cold will not do.
          Nothing here is destructive: retrying re-sends the same call, and an
          approval or purchase that already succeeded is not repeated. */}
      {/* `p.busy` is set for the WHOLE retry window, not per attempt — so this
          guard guarantees a transient failure that is about to be retried can
          never flash on screen, independent of how the hook orders its state
          updates. A user seeing fail -> retry -> success must see only
          "Approving…" then success. The failed attempt is developer-facing
          only, in the [TR-RETRY] console lines. */}
      {p.txError && p.busy === null && (
        <div className="border border-guide/40 rounded-lg p-4 mt-6">
          <p className="text-guide text-sm font-medium mb-1">That step didn't go through</p>
          <p className="text-paper/70 text-sm mb-3">
            Nothing was spent and nothing is broken — the transaction simply didn't complete. This
            is usually a temporary hiccup while your account finishes setting up. Trying again
            almost always works.
          </p>
          {p.canRetry && (
            <button
              onClick={() => p.retryLast().catch(() => {})}
              disabled={p.busy !== null || !p.ready}
              className="bg-guide text-ink font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {p.busy !== null ? "Trying again…" : "Try that step again"}
            </button>
          )}
          <details className="mt-3">
            <summary className="text-paper/40 text-xs cursor-pointer">
              Technical detail (for the developers)
            </summary>
            <p className="text-paper/50 text-xs font-data break-all mt-2">{p.txError}</p>
          </details>
        </div>
      )}
    </section>
  );
}
