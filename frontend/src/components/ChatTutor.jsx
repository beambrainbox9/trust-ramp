import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWalletState } from "../hooks/useWalletState.js";
import { apiUrl } from "../config/api.js";

// TrustRamp AI tutor — Day 2, post-audit revision (Aug 8, 2026)
//
// P0-1 (the blocker): this component seeded conversation state with an
// ASSISTANT greeting and then sent that whole array to /api/chat. The Anthropic
// Messages API requires the first message to use the "user" role, so every
// request 400'd, the backend turned it into a 500, and the catch-all below
// rewrote it as "Sorry, I lost my train of thought" — which reads as the AI
// being flaky rather than the feature being 100% broken. Proved end-to-end
// against a mock Anthropic endpoint. The greeting is now UI-only: it is
// rendered but never sent.
//
// Also fixed here:
// - `res.ok` is checked. Previously a 401 (mismatched shared secret) or a 500
//   both produced the same friendly "lost my train of thought" line, so a
//   misconfigured .env was indistinguishable from a model hiccup. You would
//   have debugged that blind.
// - The greeting no longer asserts "since your wallet's empty." The app has not
//   read the user's chain state yet (that's Day 3-4), and this product's whole
//   pitch is not overstating what it knows.
// - Auto-scroll, input disabled while in flight, and IME composition guard so
//   Enter doesn't submit mid-composition for CJK input.
//
// STILL TODO (Day 3-4, deliberately not done here): pass real `walletBalance`.
// The backend already reads it; the frontend has never sent it, so the tutor
// currently believes every balance is unknown. Wiring a viem publicClient read
// is what makes "the AI teaches using your actual wallet" literally true.

const GREETING = {
  role: "assistant",
  content:
    "Hi — I'm your TrustRamp guide. We'll go one concept at a time, starting wherever you are. No question is too basic. What would you like to understand first?",
};

const STORAGE_KEY = "trustramp.conversation.v1";

export default function ChatTutor({ walletAddress }) {
  const wallet = useWalletState(walletAddress);

  // Day 3: conversation survives a refresh. PROJECT_PLAN §5 item 3 asks the
  // tutor to "remember conversation" — losing everything on reload is a bad
  // experience for a beginner who closes a tab to go read something.
  // Scoped per address so switching accounts doesn't inherit someone else's
  // history. Wrapped in try/catch because storage can be unavailable in private
  // browsing modes, and a failure to remember must never break the chat.
  // Start with the greeting. History is loaded by the effect below, NOT here.
  //
  // WHY NOT A LAZY INITIALIZER (the Aug 12 bug): useState's initializer runs
  // ONCE, on mount — at which point `walletAddress` is still undefined, because
  // Privy has not resolved the smart account yet. So it read key ":anon", found
  // nothing, and showed the greeting, while the write effect below later saved
  // the conversation under ":0xabc". History was being stored correctly and
  // never read back.
  //
  // This presented as "email keeps history, passkey doesn't", which looked like
  // a login-method bug. It was a race: email sessions sometimes resolve fast
  // enough that the address exists on first render. Passkey is slower, so it
  // lost history every time. Same code, different timing.
  const [messages, setMessages] = useState([GREETING]);

  // Which address we have already loaded history for, so a later re-render
  // cannot wipe an in-progress conversation by re-loading over it.
  const loadedForRef = useRef(null);

  useEffect(() => {
    if (!walletAddress) return; // wait for a real address; never read ":anon"
    if (loadedForRef.current === walletAddress) return;
    loadedForRef.current = walletAddress;
    try {
      const raw = window.localStorage.getItem(`${STORAGE_KEY}:${walletAddress}`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      setMessages((current) => {
        // Only restore over an untouched greeting. If the user has already said
        // something in this session, their live conversation wins.
        const untouched = current.length <= 1;
        return untouched ? parsed : current;
      });
    } catch {
      /* storage unavailable — start fresh, no user-visible failure */
    }
  }, [walletAddress]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    // Never write under ":anon". A pre-resolution write there created orphan
    // history that no later session could find, and could overwrite a real
    // account's key on the way past.
    if (!walletAddress) return;
    try {
      window.localStorage.setItem(
        `${STORAGE_KEY}:${walletAddress}`,
        JSON.stringify(messages.slice(-40))
      );
    } catch {
      /* non-fatal */
    }
  }, [messages, walletAddress]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const next = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      // Send only from the first USER message onward. The greeting is a UI
      // affordance, not a conversational turn, and the API rejects an
      // assistant-first array outright. This is the P0-1 fix.
      const firstUserIndex = next.findIndex((m) => m.role === "user");
      const apiMessages = next.slice(firstUserIndex).map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
        },
        body: JSON.stringify({
          messages: apiMessages,
          userAddress: walletAddress,
          // Real on-chain state. Sent only when we actually read it — if the
          // RPC failed we send nothing rather than a stale or guessed value,
          // and the backend treats absence as "unknown" and tells the tutor to
          // ask rather than assume.
          ...(wallet.balance !== null ? { walletBalance: Number(wallet.balance) } : {}),
          ...(wallet.level ? { learnerLevel: wallet.level } : {}),
        }),
      });

      // Read the body once, defensively — an error path may not return JSON.
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        /* non-JSON error body; handled below */
      }

      if (!res.ok) {
        // Surface what actually went wrong instead of blaming the model.
        const detail =
          res.status === 401
            ? "the frontend and backend shared secrets don't match — check VITE_API_SHARED_SECRET against API_SHARED_SECRET"
            : data.error || `the server returned ${res.status}`;
        throw new Error(detail);
      }

      if (typeof data.reply !== "string" || data.reply.trim() === "") {
        throw new Error("the server returned an empty reply");
      }

      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          isError: true,
          content: `I couldn't reach the tutor just then — ${err.message}. Nothing was sent or changed. Try again in a moment.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface rounded-xl p-5 border border-surfaceRaised">
      {/* Honesty strip: shows what the tutor can actually see. If the RPC is
          unreachable we say so plainly rather than let the tutor teach from a
          guess about the user's money. */}
      <div className="mb-4 pb-3 border-b border-surfaceRaised font-data text-[11px]">
        {wallet.loading ? (
          <span className="text-paper/40">Reading your account on {wallet.chainName}…</span>
        ) : wallet.error ? (
          <span className="text-guide/80">
            Couldn&apos;t read your on-chain state ({wallet.error}) — the guide will ask
            instead of assuming.
          </span>
        ) : wallet.balance !== null ? (
          <span className="text-paper/50">
            {/* The "N transactions sent" counter was removed on Aug 12. It read
                eth_getTransactionCount on a SMART ACCOUNT, which returns the
                contract CREATE nonce — pinned at 1 from deployment onward, no
                matter how many purchases the user makes. A counter that is
                always wrong is worse than no counter, especially in a strip
                whose whole job is to state honestly what the tutor can see. */}
            Reading from {wallet.chainName} · {Number(wallet.balance).toFixed(4)} OKB
          </span>
        ) : (
          <span className="text-paper/40">No account connected yet.</span>
        )}
      </div>

      <div ref={scrollRef} className="space-y-4 max-h-96 overflow-y-auto pr-1">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.isError ? "text-risk" : m.role === "assistant" ? "text-paper" : "text-guide"}
          >
            <span className="font-data text-xs uppercase tracking-wide text-paper/40 block mb-1">
              {m.role === "assistant" ? "Guide" : "You"}
            </span>
            {/* The tutor writes markdown (**bold**, lists, `code`). Rendering it
                as plain text showed literal asterisks to the user — which looks
                broken and, worse, buries the emphasis the tutor put on risk
                warnings. react-markdown does NOT use dangerouslySetInnerHTML and
                does not render raw HTML unless a plugin enables it, so tutor
                output cannot inject markup. */}
            {m.role === "assistant" && !m.isError ? (
              <div className="text-sm leading-relaxed markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
            )}
          </div>
        ))}
        {loading && <p className="text-paper/40 text-sm">Thinking…</p>}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !composing) {
              e.preventDefault();
              send();
            }
          }}
          disabled={loading}
          placeholder="Ask anything, no question is too basic"
          aria-label="Ask the TrustRamp guide a question"
          rows={2}
          className="flex-1 bg-ink border border-surfaceRaised rounded-lg px-3 py-3 text-sm text-paper placeholder:text-paper/30 focus:outline-none focus:ring-2 focus:ring-guide disabled:opacity-50 resize-none"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="shrink-0 w-full sm:w-auto bg-guide text-ink text-sm font-medium px-4 py-3 rounded-lg hover:brightness-110 transition disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
