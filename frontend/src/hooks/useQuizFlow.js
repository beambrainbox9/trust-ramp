// Day 7-8 — reputation quiz flow.
//
// A conversation with the tutor that grades comprehension of the four locked
// concepts (Slippage=0, Approvals=1, Custody=2, Redemption=3) and mints the
// result on-chain when the user chooses to.
//
// Grading is entirely server-side. The frontend never sees a correct answer or
// a partial score — /api/quiz/start returns questions only, /api/quiz/answer
// returns nothing scored, /api/quiz/complete returns per-concept scores AND a
// signed intent, /api/quiz/mint verifies that intent and writes on-chain via
// the deployer key. See PROJECT_PLAN §7-8.3 for the design decisions.
//
// The mint step is EXPLICIT and USER-INITIATED (Decision A). That matters here:
// this hook exposes `mint()` as a distinct action, not something `complete()`
// triggers as a follow-on. A "Mint my reputation score" button in the component
// is what actually calls it.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, parseAbi } from "viem";
import { ACTIVE_NETWORK } from "../config/contracts.js";
import { apiUrl } from "../config/api.js";

// --- In-flight quiz persistence ---------------------------------------------
//
// Same pattern as trustramp.practicestep.v1, keyed on smart account address.
// Persists ONLY the ANSWERING/GRADING/GRADED middle of the flow — enough to
// resume where a reload dropped the user. Cleared on MINTED because from then
// on the on-chain read is the source of truth (see the "already have a
// reputation on-chain" path below).
//
// SERVER SESSION TTL is 1h (backend/quiz.mjs SESSION_TTL_MS). We store `savedAt`
// so we never try to resume a session that the server has already forgotten —
// /api/quiz/answer would 404 and lose the answer, worse than restarting.
const QUIZ_STORAGE_KEY = "trustramp.quiz.v1";
const SESSION_MAX_AGE_MS = 55 * 60 * 1000; // 55min, keep a buffer under the server's 1h

function readSaved(address) {
  if (!address) return null;
  try {
    const raw = window.localStorage.getItem(`${QUIZ_STORAGE_KEY}:${address}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.savedAt !== "number") return null;
    // Completed shape — grading succeeded. Not bound to server session TTL:
    // the intent it carries has its own TTL server-side, but the SCORES stay
    // valid to display forever. If a stale intent later fails mint, that
    // surfaces as an error and the user can retake.
    if (parsed.completed === true && parsed.result && typeof parsed.result === "object") {
      return { kind: "completed", result: parsed.result, savedAt: parsed.savedAt };
    }
    // In-flight shape — a resumable answering/grading session.
    if (
      typeof parsed.sessionId !== "string" ||
      !Array.isArray(parsed.questions) ||
      typeof parsed.cursor !== "number" ||
      typeof parsed.answers !== "object"
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS) return null;
    return { kind: "inflight", ...parsed };
  } catch {
    return null;
  }
}

function writeSaved(address, snapshot) {
  if (!address) return;
  try {
    window.localStorage.setItem(
      `${QUIZ_STORAGE_KEY}:${address}`,
      JSON.stringify({ ...snapshot, savedAt: Date.now() })
    );
    console.log(
      `[TR-QUIZ-STATE] WROTE key=${QUIZ_STORAGE_KEY}:${address} cursor=${snapshot.cursor}/${snapshot.questions.length} answers=${Object.keys(snapshot.answers).length}`
    );
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function writeSavedResults(address, result) {
  if (!address) return;
  try {
    window.localStorage.setItem(
      `${QUIZ_STORAGE_KEY}:${address}`,
      JSON.stringify({ completed: true, result, savedAt: Date.now() })
    );
    console.log(
      `[TR-QUIZ-RESULTS] WROTE key=${QUIZ_STORAGE_KEY}:${address} overall=${result?.overall} passedRWA=${result?.passedRWA}`
    );
  } catch {
    /* non-fatal */
  }
}

function clearSaved(address) {
  if (!address) return;
  try {
    window.localStorage.removeItem(`${QUIZ_STORAGE_KEY}:${address}`);
    console.log(`[TR-QUIZ-STATE] CLEARED key=${QUIZ_STORAGE_KEY}:${address}`);
  } catch {
    /* non-fatal */
  }
}

// Minimal read surface — same shape the consumer contract mirrors, and used
// only for the "already graduated" check that decides whether to offer the quiz
// or the retake path. Never used to compute a score locally.
const REPUTATION_ABI = parseAbi([
  "function getScore(address user) view returns (uint8 overallScore, bool verifiedRWA, bool graduated)",
]);

const publicClient = createPublicClient({
  chain: ACTIVE_NETWORK.chain,
  transport: http(undefined, { retryCount: 2, timeout: 10_000 }),
});

// Deployed 2026-08-11, verified in contracts/deployments/xlayerTestnet.json.
// Kept here as a constant rather than another config export because this hook
// is the only frontend caller — the backend reaches it via REPUTATION_ADDRESS.
const REPUTATION_ADDRESS = "0x1C51dec8a42e425f79C4584bDbf00A5958b87F7d";

export const QUIZ_PHASE = {
  // The tutor hasn't offered the quiz yet, or the user hasn't accepted.
  // We DO NOT auto-enter the quiz on purchase completion — an unexpected
  // conversational left-turn is worse UX than an explicit prompt.
  IDLE: "idle",
  ANSWERING: "answering",
  GRADING: "grading", // /complete is in flight
  GRADED: "graded", // scores back, mint pending human click
  MINTING: "minting", // /mint is in flight
  MINTED: "minted",
};

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
  };
}

async function postJson(path, body) {
  const res = await fetch(apiUrl(path), { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const msg = data?.error || `server returned ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  return data;
}

export function useQuizFlow(smartAccountAddress) {
  const [phase, setPhase] = useState(QUIZ_PHASE.IDLE);
  const [sessionId, setSessionId] = useState(null);
  const [questions, setQuestions] = useState([]); // full list
  const [cursor, setCursor] = useState(0); // index into questions
  const [answers, setAnswers] = useState({}); // questionId -> string
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [result, setResult] = useState(null); // { scores, overall, passedRWA, intent }
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  // Prior on-chain reputation — "you've already graduated, want to retake?"
  // is a distinct entry point from "you've never graduated". Read once when the
  // address resolves; a mint later updates it via refreshOnchain().
  const [onchain, setOnchain] = useState({ loading: false, graduated: false, overall: 0, verifiedRWA: false });

  const refreshOnchain = useCallback(async () => {
    if (!smartAccountAddress) return;
    setOnchain((s) => ({ ...s, loading: true }));
    try {
      const [overallScore, verifiedRWA, graduated] = await publicClient.readContract({
        address: REPUTATION_ADDRESS,
        abi: REPUTATION_ABI,
        functionName: "getScore",
        args: [smartAccountAddress],
      });
      setOnchain({ loading: false, graduated, overall: Number(overallScore), verifiedRWA });
    } catch (err) {
      // Failing to read reputation must NOT block the quiz. Fall back to
      // "unknown" — the user can still attempt and grade, they just won't see
      // a "you've already graduated" hint.
      console.warn("[TR-QUIZ] on-chain reputation read failed:", err?.shortMessage || err?.message);
      setOnchain({ loading: false, graduated: false, overall: 0, verifiedRWA: false });
    }
  }, [smartAccountAddress]);

  useEffect(() => { refreshOnchain(); }, [refreshOnchain]);

  // Restore an in-flight quiz session on mount / address change.
  //
  // Same posture as usePracticePurchase's step restore: read once per address,
  // never persist the default IDLE state, guard against re-restoring over an
  // in-progress session (loadedForRef). Cursor being > 0 or answers being
  // non-empty on load means we're picking up a real interrupted session.
  const loadedForRef = useRef(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!smartAccountAddress) return;
    if (loadedForRef.current === smartAccountAddress) return;
    loadedForRef.current = smartAccountAddress;

    const saved = readSaved(smartAccountAddress);
    if (!saved) {
      console.log(`[TR-QUIZ-STATE] READ key=${QUIZ_STORAGE_KEY}:${smartAccountAddress} saved=(null)`);
      restoredRef.current = true;
      return;
    }
    // A completed snapshot outranks an in-flight one: if the user finished and
    // graded, reload should land them back on the results screen, not on the
    // last question. (Before this branch, the persist effect's last in-flight
    // write — cursor at the final question — was restored as ANSWERING and the
    // graded state was silently discarded.)
    if (saved.kind === "completed") {
      console.log(
        `[TR-QUIZ-RESULTS] RESTORED key=${QUIZ_STORAGE_KEY}:${smartAccountAddress} ` +
          `overall=${saved.result?.overall} passedRWA=${saved.result?.passedRWA} ageMs=${Date.now() - saved.savedAt}`
      );
      setPhase((current) => (current === QUIZ_PHASE.IDLE ? QUIZ_PHASE.GRADED : current));
      setResult(saved.result);
      restoredRef.current = true;
      return;
    }
    console.log(
      `[TR-QUIZ-STATE] READ key=${QUIZ_STORAGE_KEY}:${smartAccountAddress} ` +
        `sessionId=${saved.sessionId.slice(0, 12)}... cursor=${saved.cursor}/${saved.questions.length} ` +
        `answers=${Object.keys(saved.answers).length} ageMs=${Date.now() - saved.savedAt}`
    );
    // Only restore over IDLE — if the user has somehow already started in this
    // session (which shouldn't happen but is cheap to be safe about) their live
    // state wins over saved state.
    setPhase((current) => (current === QUIZ_PHASE.IDLE ? QUIZ_PHASE.ANSWERING : current));
    setSessionId(saved.sessionId);
    setQuestions(saved.questions);
    setCursor(saved.cursor);
    setAnswers(saved.answers);
    restoredRef.current = true;
  }, [smartAccountAddress]);

  // Persist whenever the ANSWERING/GRADING middle changes.
  //
  // Deliberately NOT persisting GRADED/MINTING/MINTED: on-chain state and the
  // on-chain-read path handle those correctly (see the "already graduated"
  // panel). Persisting them would risk re-showing a stale local result after
  // the mint has already happened, which contradicts the chain.
  //
  // Won't fire until the restore has run, matching the "never clobber the
  // default" pattern that took two tries to get right on the practice-step
  // persistence.
  useEffect(() => {
    if (!smartAccountAddress) return;
    if (!restoredRef.current) return;
    const isInFlight = phase === QUIZ_PHASE.ANSWERING || phase === QUIZ_PHASE.GRADING;
    if (isInFlight && sessionId && questions.length > 0) {
      writeSaved(smartAccountAddress, { sessionId, questions, cursor, answers });
    }
  }, [smartAccountAddress, phase, sessionId, questions, cursor, answers]);

  const start = useCallback(async () => {
    if (!smartAccountAddress) return;
    setError(null);
    // Wipe any expired or superseded snapshot before starting a new session.
    // The write effect will save the new one once state settles.
    clearSaved(smartAccountAddress);
    try {
      const { sessionId, questions } = await postJson("/api/quiz/start", { userAddress: smartAccountAddress });
      setSessionId(sessionId);
      setQuestions(questions);
      setCursor(0);
      setAnswers({});
      setResult(null);
      setTxHash(null);
      setPhase(QUIZ_PHASE.ANSWERING);
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [smartAccountAddress]);

  const submitAnswer = useCallback(
    async (text) => {
      if (!sessionId || pendingSubmit) return;
      const q = questions[cursor];
      if (!q) return;
      const trimmed = String(text || "").trim();
      if (!trimmed) {
        setError("Please write an answer before continuing.");
        return;
      }
      setError(null);
      setPendingSubmit(true);
      try {
        await postJson("/api/quiz/answer", { sessionId, questionId: q.id, answer: trimmed });
        setAnswers((a) => ({ ...a, [q.id]: trimmed }));
        if (cursor + 1 < questions.length) {
          setCursor((c) => c + 1);
        } else {
          // Auto-grade when the last answer lands. GRADED is what gates the
          // mint button; no on-chain call happens without the explicit click.
          setPhase(QUIZ_PHASE.GRADING);
          const graded = await postJson("/api/quiz/complete", { sessionId });
          setResult(graded);
          setPhase(QUIZ_PHASE.GRADED);
          // Overwrite the in-flight snapshot with the completed one so a reload
          // returns to the results screen instead of resuming Q8 with a blank
          // answer box. The persist effect below is scoped to ANSWERING/GRADING
          // and won't touch this key while phase === GRADED.
          writeSavedResults(smartAccountAddress, graded);
        }
      } catch (err) {
        setError(err.message || String(err));
        // Stay in the current phase so the user can retry — a network blip on
        // an intermediate answer must not lose the earlier ones.
        if (phase === QUIZ_PHASE.GRADING) setPhase(QUIZ_PHASE.ANSWERING);
      } finally {
        setPendingSubmit(false);
      }
    },
    [sessionId, questions, cursor, pendingSubmit, phase, smartAccountAddress]
  );

  /**
   * User-initiated. Fires ONLY when the "Mint my reputation score" button is
   * clicked, per Decision A. The intent returned by /complete is echoed back
   * exactly — the frontend never sees or can influence the individual scores.
   */
  const mint = useCallback(async () => {
    if (!result?.intent) {
      setError("There is no graded result to mint. Please complete the quiz first.");
      return;
    }
    setError(null);
    setPhase(QUIZ_PHASE.MINTING);
    try {
      const { txHash: hash } = await postJson("/api/quiz/mint", { intent: result.intent });
      setTxHash(hash);
      setPhase(QUIZ_PHASE.MINTED);
      // Clear the in-flight snapshot. From here the on-chain read is the source
      // of truth — a reload after mint should show "You already have a
      // reputation on-chain", not resume the middle of a quiz that no longer
      // has anywhere to go.
      clearSaved(smartAccountAddress);
      // Update the on-chain read so a subsequent load shows the fresh state
      // rather than the pre-mint one.
      await refreshOnchain();
    } catch (err) {
      setError(err.message || String(err));
      // Return to GRADED so the user can retry the mint with the same intent
      // (still valid until its TTL). A permanent failure (expired, replayed)
      // surfaces the error text and they retake the quiz.
      setPhase(QUIZ_PHASE.GRADED);
    }
  }, [result, refreshOnchain, smartAccountAddress]);

  const currentQuestion = questions[cursor] ?? null;
  const progress = questions.length ? { current: cursor + 1, total: questions.length } : null;

  return {
    phase,
    onchain,
    currentQuestion,
    progress,
    answers,
    result,
    txHash,
    error,
    pendingSubmit,
    start,
    submitAnswer,
    mint,
    refreshOnchain,
  };
}
