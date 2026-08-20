import { useEffect, useRef, useState } from "react";
import { createPublicClient, http, parseAbi } from "viem";
import { QUIZ_PHASE } from "../hooks/useQuizFlow.js";
import { ACTIVE_NETWORK, txUrl } from "../config/contracts.js";
import { usePurchaseFlow } from "../context/PurchaseFlowContext.jsx";

// Reads the practice-asset balance directly rather than accepting it as a prop
// so App.jsx doesn't have to pipe state between two sibling flows. A one-shot
// read on mount plus a re-read when the address changes is sufficient — the
// practice component runs its own richer refresh loop, and the quiz only cares
// about "did they buy anything at all".
const ASSET_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const readClient = createPublicClient({
  chain: ACTIVE_NETWORK.chain,
  transport: http(undefined, { retryCount: 2, timeout: 10_000 }),
});

// Day 7-8 — reputation quiz UI.
//
// A sibling to PracticeFlow, not a child of it. The quiz reads the practice
// asset balance on-chain to decide whether to offer entry ("you've done the
// practice — want to be graded?"), rather than being told from above. That
// keeps state ownership local and means the tutor pane and the practice pane
// stay independent components.
//
// Mint is user-initiated. There is no automatic recordGraduation call anywhere
// in this component — the only path to on-chain state is the "Mint my
// reputation score" button, and it is disabled unless a graded result exists.

const CONCEPT_LABEL = {
  slippage: "Slippage",
  approvals: "Approvals",
  custody: "Custody",
  redemption: "Redemption",
};

function box(extra = "") {
  return `border border-paper/10 rounded-lg p-5 mt-6 ${extra}`;
}

/**
 * The panel is only relevant AFTER the practice purchase. We decide "did they
 * do the practice?" from on-chain asset holdings — same signal the tutor's
 * derived learnerLevel uses, and it survives a browser wipe unlike the
 * localStorage step key. If the read fails or the balance is zero, we show
 * nothing (the practice flow is what points them here).
 */
export default function ReputationQuiz({ smartAccountAddress, quizState }) {
  // Owned by App.jsx, not this component — see the comment there. A mint here
  // calls quizState.mint(), which refreshes the SAME onchain state that gates
  // RealPurchaseFlow, so graduation unlocks it immediately, no reload needed.
  const q = quizState;
  const { lastTx } = usePurchaseFlow();
  const [draft, setDraft] = useState("");
  const [assetBalance, setAssetBalance] = useState(null);
  const inputRef = useRef(null);

  // Balance read. Fires on mount AND whenever a purchase-flow transaction lands
  // for this address — closing the gap where a fresh account completing a
  // purchase in-session had to reload the page to see "Ready for the check?".
  //
  // FILTERS ON kind === "buy". The event is emitted for every kind (faucet,
  // approve, buy) by design so future consumers can pick their own rule
  // (spending-cap widgets, receipt views), but faucet and approve don't move
  // the asset balance and re-reading on them wastes an RPC call each.
  useEffect(() => {
    if (!smartAccountAddress) return;
    // Only refetch on a matching-address `buy`. Address match matters: two
    // accounts logged in the same session (rare, but possible during QA) must
    // not cross-trigger each other.
    const trigger =
      lastTx && lastTx.kind === "buy" && lastTx.address?.toLowerCase() === smartAccountAddress.toLowerCase()
        ? `tx ${lastTx.hash?.slice(0, 10)}…`
        : "mount";
    console.log(
      `[TR-REP-BALANCE] REFETCH triggered by=${trigger} address=${smartAccountAddress}`
    );
    let cancelled = false;
    (async () => {
      try {
        const bal = await readClient.readContract({
          address: ACTIVE_NETWORK.contracts.assetToken,
          abi: ASSET_ABI,
          functionName: "balanceOf",
          args: [smartAccountAddress],
        });
        if (!cancelled) setAssetBalance(bal);
      } catch {
        // If the read fails we simply won't offer the quiz automatically;
        // an already-graduated user still sees the retake path below.
      }
    })();
    return () => { cancelled = true; };
    // lastTx?.seq is the stable dependency key — carries kind/address/hash
    // together, and re-runs even if the SAME buy tx is re-emitted (defensive).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartAccountAddress, lastTx?.seq]);

  // Reset the draft when the question changes, and focus the textarea so the
  // user can just type — beginners lose flow scrolling to hunt for the input.
  useEffect(() => {
    setDraft("");
    if (q.phase === QUIZ_PHASE.ANSWERING && inputRef.current) inputRef.current.focus();
  }, [q.currentQuestion?.id, q.phase]);

  if (!smartAccountAddress) return null;
  // Not eligible yet — the practice flow itself is the CTA.
  const hasPracticed = typeof assetBalance === "bigint" && assetBalance > 0n;
  if (!hasPracticed && q.phase === QUIZ_PHASE.IDLE && !q.onchain.graduated) return null;

  return (
    <section className="mt-12">
      <h2 className="font-data text-xs tracking-widest text-guide uppercase mb-2">
        Reputation · {ACTIVE_NETWORK.label}
      </h2>
      <p className="text-paper/50 text-sm">
        A short conversation to check what you took away from the practice round. The result is a
        score you can choose to publish on-chain — nothing is written until you click.
      </p>

      {/* --- Entry point --- */}
      {q.phase === QUIZ_PHASE.IDLE && (
        <div className={box()}>
          {q.onchain.graduated ? (
            <>
              <h3 className="text-paper font-medium mb-2">You already have a reputation on-chain</h3>
              <dl className="text-sm font-data space-y-1 text-paper/70 mb-4">
                <div className="flex justify-between">
                  <dt>Overall score</dt>
                  <dd>{q.onchain.overall} / 100</dd>
                </div>
                <div className="flex justify-between">
                  <dt>RWA-verified</dt>
                  <dd>{q.onchain.verifiedRWA ? "yes" : "no"}</dd>
                </div>
              </dl>
              <p className="text-paper/60 text-sm mb-3">
                You can retake the check any time. A new mint updates your record in place — it does
                not create a second one.
              </p>
              <button
                onClick={q.start}
                className="bg-guide text-ink font-medium px-4 py-3 rounded-lg text-sm"
              >
                Retake the check
              </button>
            </>
          ) : (
            <>
              <h3 className="text-paper font-medium mb-2">Ready for the check?</h3>
              <p className="text-paper/70 text-sm mb-3">
                Eight short questions across four concepts — slippage, approvals, custody, redemption.
                Answer in your own words; there are no multiple-choice answers to pattern-match. Your
                answers are graded by the tutor once you finish; nothing is on-chain unless you choose
                to mint your score.
              </p>
              <button
                onClick={q.start}
                className="bg-guide text-ink font-medium px-4 py-3 rounded-lg text-sm"
              >
                Start the check
              </button>
            </>
          )}
        </div>
      )}

      {/* --- Question in flight --- */}
      {q.phase === QUIZ_PHASE.ANSWERING && q.currentQuestion && (
        <div className={box()}>
          <div className="flex justify-between items-baseline mb-3">
            <h3 className="text-paper font-medium">
              Question {q.progress.current} of {q.progress.total}
            </h3>
            <span className="font-data text-xs uppercase tracking-wide text-paper/40">
              {CONCEPT_LABEL[q.currentQuestion.conceptKey] || q.currentQuestion.conceptLabel}
            </span>
          </div>
          <p className="text-paper text-sm leading-relaxed mb-4">{q.currentQuestion.prompt}</p>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="In your own words…"
            className="w-full bg-ink border border-paper/10 rounded-lg p-3 text-sm text-paper focus:outline-none focus:border-guide/60"
            disabled={q.pendingSubmit}
          />
          <div className="flex justify-between items-center mt-3">
            <span className="text-xs font-data text-paper/40">{draft.length}/2000</span>
            <button
              onClick={() => q.submitAnswer(draft)}
              disabled={q.pendingSubmit || !draft.trim()}
              className="bg-guide text-ink font-medium px-4 py-3 rounded-lg text-sm disabled:opacity-50"
            >
              {q.pendingSubmit
                ? "Sending…"
                : q.progress.current === q.progress.total
                ? "Submit for grading"
                : "Next question"}
            </button>
          </div>
        </div>
      )}

      {/* --- Grading in flight --- */}
      {q.phase === QUIZ_PHASE.GRADING && (
        <div className={box()}>
          <p className="text-paper/60 text-sm italic">
            The tutor is grading your answers — usually a few seconds.
          </p>
        </div>
      )}

      {/* --- Result, awaiting user's mint decision --- */}
      {(q.phase === QUIZ_PHASE.GRADED || q.phase === QUIZ_PHASE.MINTING) && q.result && (
        <div className={box()}>
          <h3 className="text-paper font-medium mb-2">Your results</h3>
          <p className="text-paper/70 text-sm mb-4">
            Concepts graded 0–100. The pass mark on each is {q.result.passThreshold}. Nothing has been
            written to the chain yet — you decide whether to mint.
          </p>
          <dl className="text-sm font-data space-y-1 text-paper/70 mb-4">
            {["slippage", "approvals", "custody", "redemption"].map((k) => (
              <div key={k} className="flex justify-between">
                <dt>
                  {CONCEPT_LABEL[k]}
                  {q.result.scores[k] >= q.result.passThreshold ? (
                    <span className="text-safe ml-2">✓</span>
                  ) : (
                    <span className="text-guide/70 ml-2">·</span>
                  )}
                </dt>
                <dd>{q.result.scores[k]} / 100</dd>
              </div>
            ))}
            <div className="flex justify-between pt-2 mt-2 border-t border-paper/10">
              <dt className="text-paper">Overall</dt>
              <dd className="text-paper">{q.result.overall} / 100</dd>
            </div>
            <div className="flex justify-between">
              <dt>RWA-verified</dt>
              <dd>
                {q.result.passedRWA
                  ? "yes (Custody and Redemption both cleared the bar)"
                  : "not yet (needs Custody and Redemption both ≥ threshold)"}
              </dd>
            </div>
          </dl>
          <p className="text-paper/60 text-sm mb-3">
            Publishing your score puts it on X Layer testnet, tied to this smart account. Other apps
            can then read it — that's the whole point of an on-chain reputation. If you'd rather not,
            simply don't click; nothing is minted.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={q.mint}
              disabled={q.phase === QUIZ_PHASE.MINTING}
              className="bg-guide text-ink font-medium px-4 py-3 rounded-lg text-sm disabled:opacity-50"
            >
              {q.phase === QUIZ_PHASE.MINTING ? "Publishing…" : "Mint my reputation score"}
            </button>
            {!q.onchain.graduated && (
              <button
                onClick={q.start}
                disabled={q.phase === QUIZ_PHASE.MINTING}
                className="border border-paper/20 text-paper/70 font-medium px-4 py-3 rounded-lg text-sm hover:bg-paper/5 transition disabled:opacity-50"
              >
                Retake the check
              </button>
            )}
          </div>
          {!q.onchain.graduated && (
            <p className="text-paper/50 text-xs mt-3">
              Not quite where you want to be? That's normal on a first pass — retake any time, as
              many times as you like. Only your latest attempt counts.
            </p>
          )}
        </div>
      )}

      {/* --- Minted --- */}
      {q.phase === QUIZ_PHASE.MINTED && q.result && (
        <div className={box()}>
          <h3 className="text-safe font-medium mb-2">On-chain</h3>
          <p className="text-paper/70 text-sm mb-3">
            Your reputation is now readable by any contract on X Layer testnet.
          </p>
          {q.txHash && (
            <p className="text-xs font-data text-paper/40">
              Transaction:{" "}
              <a
                href={txUrl(q.txHash)}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-guide"
              >
                {q.txHash.slice(0, 10)}…{q.txHash.slice(-8)}
              </a>
            </p>
          )}
        </div>
      )}

      {/* --- Errors — same treatment as the practice flow, honest scope --- */}
      {q.error && (
        <div className="border border-guide/40 rounded-lg p-4 mt-6">
          <p className="text-guide text-sm font-medium mb-1">Something didn't go through</p>
          <p className="text-paper/70 text-sm mb-2">
            Nothing was recorded and no funds moved. This usually resolves on a retry.
          </p>
          <details>
            <summary className="text-paper/40 text-xs cursor-pointer">Technical detail</summary>
            <p className="text-paper/50 text-xs font-data break-all mt-2">{q.error}</p>
          </details>
        </div>
      )}
    </section>
  );
}
