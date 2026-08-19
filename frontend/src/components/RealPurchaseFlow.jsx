import { useCallback, useEffect, useRef, useState } from "react";
import { useRealPurchase, REAL_STEP } from "../hooks/useRealPurchase.js";
import { NETWORKS, ASSET_DECIMALS, PAYMENT_DECIMALS } from "../config/contracts.js";
import { apiUrl } from "../config/api.js";
import ApprovalModal from "./ApprovalModal.jsx";

const NET = NETWORKS.mainnet;
const DEFAULT_BUY_AMOUNT = 1;

function box(extra = "") {
  return `border border-paper/10 rounded-lg p-5 mt-6 ${extra}`;
}

export default function RealPurchaseFlow({ smartAccountAddress, graduated }) {
  const r = useRealPurchase(smartAccountAddress);

  // Auto-fund with DEMO-USDC the first time this address reaches the real
  // purchase flow post-graduation, before the purchase UI is shown — so by
  // the time the user clicks through, the funds are already there. Fires
  // once per address (fundedForRef), not on every re-render/reload, since
  // the backend's own on-disk store is what actually prevents re-funding —
  // this ref just avoids spamming it with redundant calls.
  const [fundingSettled, setFundingSettled] = useState(false);
  const [showFundingLoading, setShowFundingLoading] = useState(false);
  const fundedForRef = useRef(null);

  useEffect(() => {
    if (!smartAccountAddress || !graduated) return;
    if (fundedForRef.current === smartAccountAddress) return;
    fundedForRef.current = smartAccountAddress;

    let cancelled = false;
    // Only show the loading state if this takes more than an instant, so a
    // fast response doesn't produce a UI flash.
    const loadingTimer = setTimeout(() => {
      if (!cancelled) setShowFundingLoading(true);
    }, 300);

    fetch(apiUrl("/api/fund-mainnet-account"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
      },
      body: JSON.stringify({ address: smartAccountAddress }),
    })
      .catch(() => null) // non-fatal — proceed to the purchase UI either way
      .finally(() => {
        if (!cancelled) {
          clearTimeout(loadingTimer);
          setShowFundingLoading(false);
          setFundingSettled(true);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(loadingTimer);
    };
  }, [smartAccountAddress, graduated]);

  if (!smartAccountAddress) return null;

  if (!graduated) {
    return (
      <section className="mt-10">
        <h2 className="font-display text-xl text-paper mb-2">Real Purchase</h2>
        <div className={box()}>
          <p className="text-paper/70 text-sm">
            Mainnet purchase unlocks once you pass the reputation quiz. Head back to the check
            above when you're ready — there's no rush, and you can retake it as many times as you
            like.
          </p>
        </div>
      </section>
    );
  }

  if (!fundingSettled) {
    return (
      <section className="mt-10">
        <h2 className="font-display text-xl text-paper mb-2">Real Purchase</h2>
        {showFundingLoading && (
          <div className={box()}>
            <p className="text-paper/60 text-sm">Setting up your account…</p>
          </div>
        )}
      </section>
    );
  }

  const mainnetExplorerTx = (hash) => `${NET.explorer}/tx/${hash}`;

  return (
    <section className="mt-10">
      <h2 className="font-display text-xl text-paper mb-2">Real Purchase</h2>
      <p className="text-paper/60 text-sm mb-4">
        You graduated the quiz. You can now make a small, human-approved mainnet
        purchase (up to the $25 lifetime cap).
      </p>

      {r.clientError && (
        <div className={box("bg-risk/10 border-risk/30")}>
          <p className="text-risk text-sm">
            Mainnet wallet setup failed: {r.clientError}
          </p>
        </div>
      )}

      {r.capError && (
        <div className={box("bg-risk/10 border-risk/30")}>
          <p className="text-risk text-sm">{r.capError}</p>
          <button
            onClick={r.clearCapError}
            className="mt-2 text-xs text-paper/50 underline hover:text-paper/80"
          >
            Dismiss
          </button>
        </div>
      )}

      {r.txError && (
        <div className={box("bg-risk/10 border-risk/30")}>
          <p className="text-risk text-sm">{r.txError}</p>
          {r.canRetry && (
            <button
              onClick={r.retryLast}
              className="mt-2 text-guide text-sm underline hover:brightness-125"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {r.error && (
        <p className="text-risk text-sm mt-2">{r.error}</p>
      )}

      {/* Step: IDLE — show "Begin real purchase" */}
      {r.step === REAL_STEP.IDLE && (
        <div className={box()}>
          <p className="text-paper/80 text-sm mb-4">
            This is a real transaction on {NET.label} (chain {NET.chainId}).
            Every step requires your explicit approval, and the server enforces
            a $25 lifetime spending cap.
          </p>
          <button
            onClick={() => {
              r.setStep(REAL_STEP.RISK_BRIEFING);
              r.fetchRiskBriefing({
                paymentBalance: Number(r.paymentBalance) / 10 ** PAYMENT_DECIMALS,
                assetBalance: Number(r.assetBalance) / 10 ** ASSET_DECIMALS,
                paymentSymbol: "USDC",
                assetSymbol: "xTBILL",
              });
            }}
            disabled={!r.clientReady}
            className="bg-guide text-ink font-medium px-5 py-2.5 rounded-lg text-sm hover:brightness-110 transition disabled:opacity-40"
          >
            {r.clientReady ? "Begin real purchase" : "Setting up mainnet wallet…"}
          </button>
        </div>
      )}

      {/* Step: RISK_BRIEFING — AI-generated risk explainer */}
      {r.step === REAL_STEP.RISK_BRIEFING && (
        <div className={box()}>
          <h3 className="text-paper font-medium text-base mb-3">Before you proceed</h3>
          {r.riskBriefingLoading ? (
            <p className="text-paper/40 text-sm italic">Loading risk briefing…</p>
          ) : r.riskBriefing ? (
            <div className="text-sm text-paper/80 leading-relaxed space-y-3 mb-4">
              {r.riskBriefing
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </div>
          ) : (
            <p className="text-paper/60 text-sm mb-4">
              This is a real mainnet transaction. You are buying a tokenized
              asset with actual funds. The server enforces a $25 lifetime cap
              per address — you cannot exceed it even if you try.
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => r.setStep(REAL_STEP.IDLE)}
              className="border border-paper/20 text-paper/70 font-medium px-4 py-2 rounded-lg text-sm hover:bg-paper/5 transition"
            >
              Go back
            </button>
            <button
              onClick={() => r.setStep(REAL_STEP.APPROVAL)}
              className="bg-guide text-ink font-medium px-5 py-2 rounded-lg text-sm hover:brightness-110 transition"
            >
              I understand, continue
            </button>
          </div>
        </div>
      )}

      {/* Step: APPROVAL — approve exact cost */}
      {r.step === REAL_STEP.APPROVAL && (
        <ApprovalStep r={r} />
      )}

      {/* Step: APPROVAL_DONE */}
      {r.step === REAL_STEP.APPROVAL_DONE && (
        <div className={box()}>
          <p className="text-safe text-sm font-medium mb-2">Approval confirmed</p>
          <p className="text-paper/70 text-sm mb-4">
            The sale contract can now spend exactly the approved amount of your
            payment token. No more, no less.
          </p>
          {r.txHashes.approve && (
            <TxLink hash={r.txHashes.approve} label="Approval tx" explorer={NET.explorer} />
          )}
          <button
            onClick={() => r.setStep(REAL_STEP.PURCHASE)}
            className="mt-4 bg-guide text-ink font-medium px-5 py-2.5 rounded-lg text-sm hover:brightness-110 transition"
          >
            Proceed to purchase
          </button>
        </div>
      )}

      {/* Step: PURCHASE — buy */}
      {r.step === REAL_STEP.PURCHASE && (
        <PurchaseStep r={r} />
      )}

      {/* Step: PURCHASE_DONE */}
      {r.step === REAL_STEP.PURCHASE_DONE && (
        <div className={box("border-safe/30")}>
          <p className="text-safe text-sm font-medium mb-2">Purchase complete</p>
          <p className="text-paper/70 text-sm mb-3">
            You now hold {r.fmtAsset(r.assetBalance)} xTBILL on {NET.label}.
            The approval has been fully spent — no standing permission remains.
          </p>
          {r.txHashes.buy && (
            <TxLink hash={r.txHashes.buy} label="Purchase tx" explorer={NET.explorer} />
          )}
        </div>
      )}

      <ApprovalModal
        tx={r.pendingApproval}
        onApprove={r.approvePending}
        onCancel={r.cancelPending}
      />
    </section>
  );
}

function ApprovalStep({ r }) {
  const [cost, setCost] = useState(0n);

  useEffect(() => {
    if (!r.pricePerToken) return;
    r.quote(r.parseAsset(DEFAULT_BUY_AMOUNT))
      .then(setCost)
      .catch(() => {});
  }, [r.pricePerToken, r.quote, r.parseAsset]);

  const handleApprove = useCallback(async () => {
    if (!cost) return;
    const hash = await r.approveExact(cost);
    if (hash) r.setStep(REAL_STEP.APPROVAL_DONE);
  }, [cost, r]);

  return (
    <div className={box()}>
      <h3 className="text-paper font-medium text-base mb-3">Step 1: Approve spending</h3>
      <dl className="text-sm font-data space-y-2 text-paper/70 mb-4">
        <div className="flex justify-between">
          <dt className="text-paper/50">Asset</dt>
          <dd className="text-paper">{DEFAULT_BUY_AMOUNT} xTBILL</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-paper/50">Cost</dt>
          <dd className="text-paper">{r.fmtPayment(cost)} USDC</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-paper/50">Network</dt>
          <dd className="text-paper">{NET.label}</dd>
        </div>
      </dl>
      <button
        onClick={handleApprove}
        disabled={r.busy || !cost || !r.clientReady}
        className="bg-guide text-ink font-medium px-5 py-2.5 rounded-lg text-sm hover:brightness-110 transition disabled:opacity-40"
      >
        {r.busy === "approve" ? "Approving…" : "Approve exact amount"}
      </button>
    </div>
  );
}

function PurchaseStep({ r }) {
  const [cost, setCost] = useState(0n);
  const tokenAmountWei = r.parseAsset(DEFAULT_BUY_AMOUNT);

  useEffect(() => {
    if (!r.pricePerToken) return;
    r.quote(tokenAmountWei)
      .then(setCost)
      .catch(() => {});
  }, [r.pricePerToken, r.quote, tokenAmountWei]);

  const handleBuy = useCallback(async () => {
    if (!cost) return;
    const hash = await r.buy(tokenAmountWei, cost);
    if (hash) r.setStep(REAL_STEP.PURCHASE_DONE);
  }, [cost, tokenAmountWei, r]);

  return (
    <div className={box()}>
      <h3 className="text-paper font-medium text-base mb-3">Step 2: Purchase</h3>
      <dl className="text-sm font-data space-y-2 text-paper/70 mb-4">
        <div className="flex justify-between">
          <dt className="text-paper/50">Buying</dt>
          <dd className="text-paper">{DEFAULT_BUY_AMOUNT} xTBILL</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-paper/50">Maximum cost</dt>
          <dd className="text-paper">{r.fmtPayment(cost)} USDC</dd>
        </div>
      </dl>
      <button
        onClick={handleBuy}
        disabled={r.busy || !cost || !r.clientReady}
        className="bg-guide text-ink font-medium px-5 py-2.5 rounded-lg text-sm hover:brightness-110 transition disabled:opacity-40"
      >
        {r.busy === "buy" ? "Purchasing…" : "Buy now"}
      </button>
    </div>
  );
}

function TxLink({ hash, label, explorer }) {
  if (!hash) return null;
  return (
    <p className="text-xs font-data text-paper/40 mt-2">
      {label}:{" "}
      <a
        href={`${explorer}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="underline hover:text-guide"
      >
        {hash.slice(0, 10)}…{hash.slice(-8)}
      </a>
    </p>
  );
}
