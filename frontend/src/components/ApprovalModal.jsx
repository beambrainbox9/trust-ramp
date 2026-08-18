import { useCallback } from "react";
import { ACTIVE_NETWORK } from "../config/contracts.js";

/**
 * Blocking approval modal for every on-chain transaction.
 *
 * Renders an overlay showing the transaction's human-readable details and
 * resolves only when the user clicks "Approve". Clicking "Cancel" rejects
 * the promise without submitting anything.
 *
 * Props:
 *   tx          - { label, amount, spender, token, network }
 *   onApprove   - called when the user clicks Approve
 *   onCancel    - called when the user clicks Cancel
 */
export default function ApprovalModal({ tx, onApprove, onCancel }) {
  if (!tx) return null;

  const handleBackdrop = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-surface border border-paper/10 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <h2 className="text-paper font-medium text-lg mb-4">Confirm transaction</h2>

        <dl className="text-sm font-data space-y-3 text-paper/70">
          <div className="flex justify-between">
            <dt className="text-paper/50">Action</dt>
            <dd className="text-paper font-medium">{tx.label}</dd>
          </div>

          {tx.amount && (
            <div className="flex justify-between">
              <dt className="text-paper/50">Amount</dt>
              <dd className="text-paper">{tx.amount}</dd>
            </div>
          )}

          {tx.token && (
            <div className="flex justify-between">
              <dt className="text-paper/50">Token</dt>
              <dd className="text-paper">{tx.token}</dd>
            </div>
          )}

          {tx.spender && (
            <div className="flex justify-between items-start">
              <dt className="text-paper/50">Contract</dt>
              <dd className="text-paper text-right font-data text-xs break-all max-w-[240px]">
                {tx.spender}
              </dd>
            </div>
          )}

          <div className="flex justify-between">
            <dt className="text-paper/50">Network</dt>
            <dd className="text-paper">{tx.network || ACTIVE_NETWORK.label}</dd>
          </div>

          <div className="flex justify-between">
            <dt className="text-paper/50">Estimated fee</dt>
            <dd className="text-safe text-xs">Sponsored (gas-free)</dd>
          </div>
        </dl>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 border border-paper/20 text-paper/70 font-medium px-4 py-2.5 rounded-lg text-sm hover:bg-paper/5 transition"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            className="flex-1 bg-guide text-ink font-medium px-4 py-2.5 rounded-lg text-sm hover:brightness-110 transition"
          >
            Approve
          </button>
        </div>

        <p className="text-paper/30 text-xs text-center mt-4">
          {ACTIVE_NETWORK.isPractice
            ? "Practice network — no real funds at risk."
            : "This will submit a real transaction."}
        </p>
      </div>
    </div>
  );
}
