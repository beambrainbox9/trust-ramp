// Static, non-clickable network indicator. Small and legible — not a
// headline element. Lives in the footer of every page (Step 2 of the
// design-system upgrade).
export default function NetworkBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-paper/15 px-3 py-1 font-data text-[11px] text-paper/50 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-safe" aria-hidden="true" />
      X Layer Testnet + Mainnet · Chain 1952 / 196
    </span>
  );
}
