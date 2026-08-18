// TrustRamp backend — Day 2, post-audit revision (Aug 8, 2026)
//
// WHAT CHANGED IN THIS PASS, and why. Every item below traces to a finding in
// AUDIT_DAY2.md that was demonstrated with a live request, not inferred.
//
// P0-2  Corrupt/unreadable approvals file used to FAIL OPEN — a JSON parse error
//       silently returned an empty store, resetting every address's recorded
//       spend to zero and handing out a fresh $25. Proved live. Now: unreadable
//       state refuses the approval (503). Writes are atomic (temp file + rename)
//       so a crash mid-write can no longer truncate the file and cause this.
// P0-3  `network` was compared for equality (`=== "mainnet"`), so OMITTING the
//       field skipped the cap check entirely and a $999,999 prepare returned 200.
//       Now validated against an explicit allowlist.
// P1-1  /api/approve-transaction accepted a completely hand-written preparedTx —
//       `prepare` never had to be called. Now every prepared transaction is
//       HMAC-signed server-side with a short expiry, and approve verifies it.
//       IMPORTANT: this proves "the server issued this exact transaction and
//       nobody edited it." It does NOT prove "the logged-in human approved it" —
//       that is the separate, still-open `humanApproved` gap (see below).
// P1-3  Money was stored as floating-point dollars and drifted (observed:
//       totalSpentUSD 5.000001). Stored as integer cents now. The response field
//       stays `totalSpentUSD` in dollars so the client contract is unchanged.
// P1-4  `prepare` required a real number; `approve` used parseFloat and accepted
//       the string "5". The money endpoint is now the stricter of the two.
// P1-5  /api/chat interpolated userAddress straight into the system prompt with
//       no validation, while isValidAddress() sat unused two functions away —
//       an injectable system prompt in a product whose pitch is "the AI never
//       overstates safety." Now validated and, on failure, omitted entirely.
// M-1   /api/chat with no `messages` threw and returned 500 with a stack trace.
//       Now a 400 with a specific reason. Also validates roles/content shape and
//       rejects an assistant-first array, which is the exact payload the old
//       frontend sent on every message (P0-1) — defence in depth, so a frontend
//       regression can never again look like "the AI is being flaky."
// M-4   No minimum approval amount; $0.000001 was accepted. Now $0.50 floor.
//
// STILL OPEN — deliberately not fixed here, do not mistake this file for done:
//   `humanApproved` remains a client-supplied boolean with no session binding to
//   the authenticated Privy user. The HMAC above narrows the blast radius; it
//   does not close this. Must be tied to a verified Privy session token before
//   Day 11-12, when real funds move. This is the single most important remaining
//   item in this file.
//
// LOCKED DECISIONS PRESERVED (PROJECT_PLAN / README — do not "normalize away"):
//   1. /api/approve-transaction keeps its {allowed, reason} shape, deliberately
//      different from every other endpoint's {error}. It answers "should money
//      move," not "did the request succeed." Every new failure path added below
//      uses {allowed, reason}.
//   2. MAINNET_SPENDING_CAP_USD ($25) is LIFETIME per address, not daily-reset.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { createQuizHandlers } from "./quiz.mjs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Behind a proxy (Vercel/Render/Fly/Cloudflare) every request arrives from the
// proxy's IP, so express-rate-limit lumps ALL users into one bucket — 100
// requests total for everyone combined, and a judge mid-demo eats a 429 because
// of someone else's traffic. Setting `trust proxy` makes the limiter key off the
// real client IP instead. It is OFF by default because enabling it when you are
// NOT behind a proxy lets anyone spoof X-Forwarded-For and bypass the limiter
// entirely. Set TRUST_PROXY to the number of proxy hops once you know the
// deploy target (Vercel/Render = 1). Leave unset for local dev.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

// FOUR buckets, not one. Previously a single limiter covered all of /api, and
// /api/network-info is unauthenticated — so anyone could burn the entire app's
// quota with 100 trivial GETs and take the AI tutor down with it (demonstrated
// live in the audit).
//
// Aug 11: split again. /api/narrate was added to the practice flow and put on
// the same bucket as /api/chat, which meant a bounded, predictable consumer
// (5 calls per walkthrough) could eat into an open-ended one (the tutor). The
// tutor going quiet mid-conversation is the worst-looking failure in the demo,
// so narration now cannot starve it — and vice versa.
//
// The money endpoints keep the OLD tight limit deliberately. They gate spend on
// mainnet from Day 11-12, and "a bit inconvenient" is the right failure mode
// there in a way it is not for a chat message.
//
// NOTE ON PRODUCTION: all of these key on IP, which behind a proxy is the
// PROXY's IP unless TRUST_PROXY is set — see the trust-proxy block above. Set
// TRUST_PROXY=1 on Render or every user on the internet shares one bucket and
// these numbers mean nothing.
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// The AI tutor. Open-ended: a curious user can legitimately send many messages.
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// Practice-flow narration. Bounded per walkthrough (5 steps), but a page
// refresh resets the client-side guard, so allow for plenty of repeat runs.
const narrateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// Money paths: prepare + approve. UNCHANGED at 100 on purpose.
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

// --- Stopgap auth: shared secret between frontend and backend ---
//
// CORS alone does NOT stop direct calls to this backend (curl, Postman, another
// server) — it only stops a browser from letting a *different website's*
// JavaScript read the response.
//
// This header check is NOT real user authentication. It proves "this request
// came from our frontend," not "this request came from a specific logged-in
// user." The secret is compiled into the frontend bundle and is readable by
// anyone who opens devtools — I confirmed it appears in plaintext in
// dist/assets/index-*.js. It stops opportunistic direct calls, nothing more.
// Do not treat this as solved; it is a floor.
const API_SHARED_SECRET = process.env.API_SHARED_SECRET;
function requireSharedSecret(req, res, next) {
  if (!API_SHARED_SECRET) {
    console.error("API_SHARED_SECRET is not set — refusing all requests.");
    return res.status(500).json({ error: "Server misconfigured." });
  }
  const provided = req.get("X-TrustRamp-Secret") || "";
  // Length-prefixed constant-time compare. timingSafeEqual throws on length
  // mismatch, which would itself leak length, so guard before comparing.
  const a = Buffer.from(provided);
  const b = Buffer.from(API_SHARED_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- X Layer network info ---
// Verified Aug 8 2026 against OKX's own RPC docs: mainnet chain-id 196 (0xC4),
// testnet 1952 (0x7A0) — 195 is the deprecated pre-2025 testnet. The odd-looking
// `/terigon` path on the testnet endpoint is genuinely what OKX documents (a
// leftover from the pre-OP-Stack Erigon nodes), not a typo. X Layer migrated
// from Polygon zkEVM to the OP Stack on 2025-10-27, so it now runs op-geth and
// is near-EVM-equivalent.
//
// TODO (M-5): this duplicates frontend/src/chains.js. They agree today and will
// drift. Extract to one shared module during Day 3-4.
export const X_LAYER = {
  mainnet: {
    chainId: 196,
    name: "X Layer mainnet",
    rpcUrl: "https://rpc.xlayer.tech",
    explorer: "https://www.okx.com/web3/explorer/xlayer",
    gasToken: "OKB",
  },
  testnet: {
    chainId: 1952,
    name: "X Layer testnet",
    rpcUrl: "https://testrpc.xlayer.tech/terigon",
    explorer: "https://www.okx.com/web3/explorer/xlayer-test",
    gasToken: "OKB",
  },
};

const VALID_NETWORKS = new Set(["mainnet", "testnet"]);

// --- Deployed contract addresses ---
//
// Source of truth is contracts/deployments/<network>.json, written by
// contracts/scripts/deploy.js after it verifies the deployed state on-chain.
// Mirrored here rather than imported so the backend has no build-time dependency
// on the contracts workspace.
//
// Testnet deployed Aug 11 2026 (chain 1952). MAINNET IS DEPLIBERATELY null: the
// contracts are not deployed there yet, and a null makes a mainnet prepare fail
// loudly below. The previous value here was the zero address, which would have
// produced a signed, valid-looking transaction pointing at nothing.
const SALE_CONTRACT = {
  testnet: "0x6466218A596e7FCB933ED5a02Fe5204dDa46435e",
  mainnet: null,
};

// The ERC-20 the sale accepts as payment (DEMO-USDC, 6 decimals). The purchase
// requires an approve() on this token before buy() can pull the funds — that
// approval is the "Approvals" concept the reputation contract scores.
const PAYMENT_TOKEN = {
  testnet: "0xa9B8b8Aba1Fc34c790Ec9D7D452d65E4b0A3A9E5",
  mainnet: null,
};

// Allowlist for the derived experience level the frontend sends. This value is
// interpolated into the tutor's system prompt, so it is treated the same way as
// any other untrusted input: matched against a fixed set, never passed through.
const VALID_LEARNER_LEVELS = new Set(["brand_new", "funded_never_transacted", "has_activity"]);

// LOCKED: lifetime per address, not daily-reset. See README.
const MAINNET_SPENDING_CAP_CENTS = 2500; // $25.00
const MIN_TX_CENTS = 50; // $0.50 floor — stops micro-approval spam (M-4)
const PREPARED_TX_TTL_MS = 15 * 60 * 1000; // 15 min to review and approve

const usd = (cents) => cents / 100;

// --- Persistence: file-backed, race-safe, atomic, fail-closed ---
const DATA_DIR = path.join(__dirname, "data");
const APPROVALS_FILE = path.join(DATA_DIR, "approvals.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(APPROVALS_FILE)) {
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify({ userApprovals: {} }, null, 2));
}

// Serializes read-modify-write cycles so two concurrent requests can't both pass
// the cap check before either writes. Verified under load: 10 simultaneous $5
// approvals against the $25 cap → exactly 5 allowed, stored total exactly $25.00.
// Not a substitute for a real DB, and worth being blunt about the limit: this is
// an IN-PROCESS lock. On serverless (Vercel) or a clustered process manager it
// buys you nothing, because each instance has its own lock AND its own copy of
// the file. Single long-lived process only. Swap for SQLite before that changes.
let writeQueue = Promise.resolve();
function withWriteLock(fn) {
  const result = writeQueue.then(fn);
  writeQueue = result.catch(() => {});
  return result;
}

function isValidAddress(addr) {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr);
}

class ApprovalStoreUnavailable extends Error {}

// FAIL CLOSED. The previous version caught parse errors and returned an empty
// store, which reset every address's spend to zero — I bypassed a fully-spent
// $25 cap this way in the audit just by corrupting the file. A store we cannot
// read is a store we cannot enforce a cap against, so we refuse instead.
function getApprovalData() {
  let raw;
  try {
    raw = fs.readFileSync(APPROVALS_FILE, "utf8");
  } catch (err) {
    throw new ApprovalStoreUnavailable(`cannot read approvals file: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ApprovalStoreUnavailable(`approvals file is corrupt: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.userApprovals !== "object" || parsed.userApprovals === null) {
    throw new ApprovalStoreUnavailable("approvals file has an unexpected shape");
  }
  return parsed;
}

// Atomic: write to a temp file, fsync, then rename. rename() is atomic on POSIX,
// so a crash can leave the temp file behind but can never leave approvals.json
// half-written — which was the realistic route into the fail-open bug above.
function saveApprovalData(data) {
  const tmp = `${APPROVALS_FILE}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, APPROVALS_FILE);
}

// --- Prepared-transaction integrity (P1-1) ---
//
// Signs the fields that decide whether money moves. approve() recomputes the
// signature and rejects anything it did not itself issue. Reuses
// API_SHARED_SECRET as the signing key: it never leaves the server for this
// purpose (the frontend copy is only ever sent as a header, never used to sign),
// and adding a second required env var 13 days from the deadline is a worse
// trade than reusing one. If you later split them, use a dedicated
// TX_SIGNING_SECRET — it's a one-line change.
function signPreparedTx({ userAddress, valueCents, network, exp }) {
  const payload = `${userAddress.toLowerCase()}|${valueCents}|${network}|${exp}`;
  return crypto.createHmac("sha256", API_SHARED_SECRET).update(payload).digest("hex");
}

function verifyPreparedTx(preparedTx) {
  if (!preparedTx || typeof preparedTx !== "object") return { ok: false, reason: "Missing transaction payload." };
  const { userAddress, valueCents, network, exp, sig } = preparedTx;
  if (!isValidAddress(userAddress)) return { ok: false, reason: "Missing or invalid transaction payload." };
  if (!Number.isInteger(valueCents) || valueCents <= 0) return { ok: false, reason: "Invalid transaction value." };
  if (!VALID_NETWORKS.has(network)) return { ok: false, reason: "Invalid transaction payload." };
  if (!Number.isInteger(exp) || typeof sig !== "string") return { ok: false, reason: "Invalid transaction payload." };

  const expected = signPreparedTx({ userAddress, valueCents, network, exp });
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "This transaction was not issued by TrustRamp, or it was modified after preparation." };
  }
  if (Date.now() > exp) {
    return { ok: false, reason: "This transaction preparation expired. Please review and prepare it again." };
  }
  return { ok: true };
}

// --- 1. AI Tutor chat proxy ---
const TUTOR_SYSTEM_PROMPT = `You are the TrustRamp tutor: a warm-but-credible guide
helping a total beginner understand crypto/DeFi concepts using their own wallet
state. Tone rules (confirmed with the founder, Mo, Aug 7):
- Approachable and patient, like a trustworthy guide — never cutesy or jokey,
  especially about risk, since real money can be involved.
- Not stiff or compliance-document formal either.
- Explain one concept at a time. No unexplained jargon — define any technical
  term in plain English the first time you use it.
- Never claim something is risk-free if it isn't. Never overstate certainty
  about yield, price, or outcomes.
This tone applies to every response you give in this app: tutoring, risk
explanations, and transaction-approval prompts alike.

--- WHAT THIS APP ACTUALLY OFFERS (you must know this before advising anyone) ---
TrustRamp has a FREE PRACTICE ROUND on a test network, rendered on the same page,
directly below this chat. The user can scroll to it right now. It gives them:
- Free practice tokens from a "faucet" (a function that hands out test tokens at
  no cost). No purchase, no exchange, no bank account, no real money.
- A real two-step purchase — approve, then buy — of a demo asset, executed
  on-chain for real, on a TEST network where the tokens have no monetary value.
- Gas paid for them, so an empty wallet can still complete it.
This is genuinely zero financial risk. It is one of the very few things in this
product you may accurately describe as risk-free, because the tokens are not
worth anything and cannot be exchanged for anything.

--- HARD RULE ON SEQUENCING: PRACTICE BEFORE REAL MONEY ---
When someone asks how to get started, what to do first, or how this works, you
LEAD WITH THE FREE PRACTICE ROUND. Tell them they can try the whole thing right
now, for free, with test tokens, and point them to the section below the chat.
Do NOT walk someone through buying crypto on an exchange, funding a wallet,
or spending real money as the answer to "how do I get started". That advice is
not wrong in general, but it is the wrong FIRST answer here, and giving it
sends a beginner to spend money before they have understood anything — which is
the exact failure this product exists to prevent.
Only discuss real-money funding when EITHER:
  (a) the user has already completed the practice round, OR
  (b) the user explicitly asks about the real-money flow specifically.
If they ask whether real money is involved, answer honestly and immediately —
never imply practice costs money, and never imply the real flow is free.

--- HANDLING PASSKEY QUESTIONS HONESTLY ---
If a user asks about the passkey prompts they saw (especially "why did it ask for
a USB security key?"), answer plainly:
- A passkey is a login credential their device or browser stores. It's what
  they use instead of a seed phrase — same account each time, no phrase to lose.
- If Chrome offered them a choice between "Google Password Manager" and
  "Windows Hello or external security key", picking Google Password Manager
  syncs the passkey to their Google account so they can log back in on any
  device with that account. Picking Windows Hello ties it to that computer.
- If Windows asked them to "insert your security key into the USB port", that
  is Chrome/Windows offering a hardware-key path — they do NOT need one. They
  can cancel and try again, and it will usually offer a saved passkey or
  fingerprint/PIN option next time. This app never requires a physical USB key.
Do not speculate about why the prompt was inconsistent — say it varies by
browser and past choices, and point them at the workaround. Never claim you
can prevent it from the app side; we cannot in the current setup.`;

const MAX_TURNS = 40;
const MAX_CHARS_PER_MESSAGE = 4000;

// Returns { ok, messages } or { ok:false, reason }. Split out from the route so
// it is unit-testable on its own once a test suite exists.
function validateChatMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, reason: "`messages` must be a non-empty array." };
  }
  if (input.length > MAX_TURNS) {
    return { ok: false, reason: `Conversation too long (max ${MAX_TURNS} turns).` };
  }
  const cleaned = [];
  for (const m of input) {
    if (!m || typeof m !== "object") return { ok: false, reason: "Each message must be an object." };
    if (m.role !== "user" && m.role !== "assistant") {
      return { ok: false, reason: 'Each message role must be "user" or "assistant".' };
    }
    if (typeof m.content !== "string" || m.content.trim() === "") {
      return { ok: false, reason: "Each message must have non-empty string content." };
    }
    if (m.content.length > MAX_CHARS_PER_MESSAGE) {
      return { ok: false, reason: `Message too long (max ${MAX_CHARS_PER_MESSAGE} characters).` };
    }
    cleaned.push({ role: m.role, content: m.content });
  }
  // The Anthropic Messages API requires the first message to use the "user"
  // role. The old frontend seeded state with an assistant greeting and shipped
  // the whole array, so EVERY request 400'd and surfaced as "the AI is being
  // flaky." Fixed on the client too; this is the belt-and-braces copy so a
  // frontend regression fails loudly here instead of hiding.
  while (cleaned.length && cleaned[0].role === "assistant") cleaned.shift();
  if (cleaned.length === 0) {
    return { ok: false, reason: "Conversation must contain at least one user message." };
  }
  return { ok: true, messages: cleaned };
}

app.post("/api/chat", chatLimiter, requireSharedSecret, async (req, res) => {
  const { messages, userAddress, walletBalance, txCount, learnerLevel } = req.body || {};

  const validated = validateChatMessages(messages);
  if (!validated.ok) {
    // 400 with a specific reason, not a 500 with a stack trace (M-1).
    return res.status(400).json({ error: validated.reason });
  }

  // Only interpolate values we have actually validated. Previously userAddress
  // went into the system prompt raw, so a caller could inject newlines and
  // instructions and rewrite the tutor's risk rules (P1-5). Every field below
  // is either validated or replaced with an explicit "unknown".
  const addressLine = isValidAddress(userAddress) ? userAddress : "not connected";

  const balanceNum = Number(walletBalance);
  const balanceLine =
    walletBalance !== undefined && walletBalance !== null && Number.isFinite(balanceNum) && balanceNum >= 0
      ? `${balanceNum} OKB`
      : "unknown";

  const txLine = Number.isInteger(txCount) && txCount >= 0 ? String(txCount) : "unknown";

  // Allowlist, never the raw string — this value steers how the tutor opens.
  const levelLine = VALID_LEARNER_LEVELS.has(learnerLevel) ? learnerLevel : "unknown";

  const contextNote = `
--- The user's real, current on-chain state (read from X Layer, not self-reported) ---
Smart account address: ${addressLine}
Native OKB balance: ${balanceLine}
Transactions ever sent by this account: ${txLine}
Derived experience level: ${levelLine}

How to use this:
- "brand_new" (no balance, never transacted): a genuine beginner. Start from what
  a wallet is. Do not assume any prior knowledge. THIS USER ESPECIALLY MUST BE
  POINTED AT THE FREE PRACTICE ROUND FIRST — an empty wallet is not a problem to
  be solved by funding it, it is exactly who the practice round was built for.
  Do not treat "your wallet is empty" as a prompt to explain how to buy crypto.
- "funded_never_transacted": they have funds but have never sent anything. They
  are likely nervous about the first action rather than ignorant. Address that —
  and note the practice round lets them rehearse the exact steps without
  touching the funds they already hold.
- "has_activity": they have transacted before. Do not over-explain basics; find
  out what they already know before teaching. Practice is still the safe place
  to demonstrate anything they are unsure about.
- "unknown": you genuinely do not know their state. SAY SO if it becomes
  relevant, and ask. Never guess at their balance, their experience, or whether
  their wallet is empty. Stating something confident and wrong about the user's
  own money is the single worst failure available to you in this product.
Never state the balance or transaction count back to the user as a precise
figure unless they ask — reference it naturally, the way a person who had
glanced at it would.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      system: TUTOR_SYSTEM_PROMPT + contextNote,
      messages: validated.messages,
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    res.json({ reply: text });
  } catch (err) {
    console.error("Chat proxy error:", err?.message || err);
    res.status(502).json({ error: "The AI tutor is unavailable right now. Please try again." });
  }
});

// --- 1b. Practice-flow narration -------------------------------------------
//
// The practice purchase needs the tutor to explain each step BEFORE it happens.
// This lives server-side for the same reason /api/chat does: the Anthropic key
// never reaches the browser.
//
// Why a separate endpoint rather than reusing /api/chat: the narration must use
// the SAME wording as the later comprehension quiz, or we score our own
// inconsistency instead of the learner's understanding. The canonical
// definitions are passed in from the frontend's glossary module and pinned into
// the system prompt here, so both surfaces read from one source.
//
// TESTNET-ONLY TODAY. Day 11-12 adds the mainnet variant: same steps, plus the
// spending cap and the human-approval gate. The step names are deliberately
// generic ("approval", "purchase") rather than "practice_approval" so the
// mainnet flow reuses them instead of forking.
const NARRATION_STEPS = new Set(["overview", "approval", "approval_done", "purchase", "purchase_done"]);

const MAX_GLOSSARY_TERMS = 12;
const MAX_GLOSSARY_FIELD_CHARS = 600;

app.post("/api/narrate", narrateLimiter, requireSharedSecret, async (req, res) => {
  const { step, context, glossary } = req.body || {};

  if (!NARRATION_STEPS.has(step)) {
    return res.status(400).json({
      error: `Unknown narration step. Expected one of: ${[...NARRATION_STEPS].join(", ")}.`,
    });
  }

  // The glossary arrives from the client, so it is untrusted input that lands in
  // a system prompt — the same injection risk as P1-5. Bound its size and shape
  // rather than interpolating whatever turns up.
  let glossaryBlock = "";
  if (Array.isArray(glossary)) {
    const safe = glossary.slice(0, MAX_GLOSSARY_TERMS).filter(
      (g) => g && typeof g.term === "string" && typeof g.short === "string"
    );
    glossaryBlock = safe
      .map((g) => {
        const clip = (v) => (typeof v === "string" ? v.slice(0, MAX_GLOSSARY_FIELD_CHARS) : "");
        return [
          `- ${clip(g.term)}: ${clip(g.short)}`,
          g.risk ? `  risk: ${clip(g.risk)}` : null,
          g.ourBehaviour ? `  in this flow: ${clip(g.ourBehaviour)}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");
  }

  // Only validated, bounded values reach the prompt.
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v, max = 80) => (typeof v === "string" ? v.slice(0, max) : null);
  const c = context && typeof context === "object" ? context : {};
  const factLines = [
    `Network: ${str(c.networkLabel) || "unknown"} (practice, no real value)`,
    `Payment token balance: ${num(c.paymentBalance) ?? "unknown"} ${str(c.paymentSymbol) || ""}`,
    `Asset token balance: ${num(c.assetBalance) ?? "unknown"} ${str(c.assetSymbol) || ""}`,
    `Amount being bought: ${num(c.buyAmount) ?? "unknown"} ${str(c.assetSymbol) || ""}`,
    `Cost: ${num(c.cost) ?? "unknown"} ${str(c.paymentSymbol) || ""}`,
    `Current allowance granted to the sale contract: ${num(c.allowance) ?? "unknown"}`,
    c.txHash ? `Transaction hash: ${str(c.txHash, 66)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const STEP_BRIEF = {
    overview:
      "Set the scene. What they are about to do, that it is practice with no real money, and what the two steps will be (approve, then buy). Two short paragraphs at most.",
    approval:
      "Explain the approval BEFORE it happens. What approve() actually authorises. Why this flow scopes it to the exact amount rather than unlimited. Why unlimited approvals are a genuine risk elsewhere in DeFi. This is a graded concept — do NOT present it as a formality or a box to tick.",
    approval_done:
      "The approval transaction landed. Say plainly what changed on-chain: the sale contract may now move exactly that amount of the payment token, once, and nothing more. Keep it short.",
    purchase:
      "Explain the buy step. Cover what the maximum-payment ceiling protects against (the seller changing the price between the quote and the transaction landing) and what it does NOT protect against. Be explicit that this is a fixed-price sale, not an exchange, so there is no market slippage here — and that slippage is still worth understanding because it applies almost everywhere else.",
    purchase_done:
      "The purchase landed. Confirm what they now hold, in plain terms, and that the approval has been fully spent so no standing permission remains.",
  };

  const system = `${TUTOR_SYSTEM_PROMPT}

You are narrating one step of a hands-on practice purchase on a test network.

ABSOLUTE RULES FOR THIS NARRATION:
- This is PRACTICE. No real money is at stake. Say so when it is relevant, but do
  not repeat it in every paragraph.
- Never claim a protection that does not exist. This is a FIXED-PRICE SALE, not an
  automated market maker. There is no pool, no market price moving underneath the
  user, and therefore NO SLIPPAGE in this flow. The contract itself documents this;
  contradicting it would be worse than saying nothing.
- Use the exact vocabulary below. A later quiz scores these concepts using this
  wording, so paraphrasing it into different terms would test our inconsistency
  rather than their understanding.
- Define any technical term in plain English the first time it appears.
- No headings, no bullet lists, no markdown. Two short paragraphs maximum.
- Address the user directly as "you".
- NEVER CALCULATE OR PREDICT A BALANCE. Report only the figures given to you,
  exactly as given. Do not add the purchase amount to a balance, do not say
  "up from X to Y", do not infer what a balance will be after this step.
  The same figures are displayed on screen beside your text, so any number you
  compute yourself will contradict what the user is looking at — and a tutor
  that disagrees with the app's own numbers is worse than one that says less.
  If a figure you want is not in the state below, describe the step without it.

CANONICAL VOCABULARY:
${glossaryBlock || "(none supplied)"}

THE USER'S REAL, CURRENT STATE:
${factLines}

WHAT THIS PARTICULAR STEP MUST COVER:
${STEP_BRIEF[step]}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: `Narrate the "${step}" step.` }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    res.json({ narration: text });
  } catch (err) {
    console.error("Narration error:", err?.message || err);
    res.status(502).json({ error: "The tutor is unavailable right now. Please try again." });
  }
});

// --- 2. AI prepares a transaction (does not execute, does not touch spend state) ---
app.post("/api/prepare-transaction", sensitiveLimiter, requireSharedSecret, async (req, res) => {
  const { userAddress, amountUsd, network } = req.body || {};

  if (!isValidAddress(userAddress)) {
    return res.status(400).json({ error: "Missing or invalid wallet address." });
  }
  // Allowlist, not equality. Omitting `network` previously skipped the cap check
  // and happily prepared a $999,999 transaction (P0-3).
  if (!VALID_NETWORKS.has(network)) {
    return res.status(400).json({ error: 'Invalid network. Must be "mainnet" or "testnet".' });
  }
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    return res.status(400).json({ error: "Invalid amount." });
  }

  const valueCents = Math.round(amountUsd * 100);
  if (valueCents < MIN_TX_CENTS) {
    return res.status(400).json({ error: `Minimum transaction is $${usd(MIN_TX_CENTS).toFixed(2)}.` });
  }
  if (network === "mainnet" && valueCents > MAINNET_SPENDING_CAP_CENTS) {
    return res.status(400).json({
      error: `Amount exceeds the current mainnet cap of $${usd(MAINNET_SPENDING_CAP_CENTS)}. Enforced server-side, cannot be changed from the browser.`,
    });
  }

  // Fail closed if the sale contract isn't deployed on the requested network.
  // Without this, `to` would be undefined and we would hand back an HMAC-signed
  // transaction that looks legitimate and cannot possibly execute.
  if (!SALE_CONTRACT[network]) {
    return res.status(503).json({
      error: `The purchase contract is not deployed on ${network} yet. Practice purchases run on testnet.`,
    });
  }

  const exp = Date.now() + PREPARED_TX_TTL_MS;
  const preparedTx = {
    to: SALE_CONTRACT[network], // MockRWASale — see the deployment note above
    userAddress,
    valueCents,
    valueUsd: usd(valueCents),
    network,
    exp,
    sig: signPreparedTx({ userAddress, valueCents, network, exp }),
    plainLanguageSummary: `This will use $${usd(valueCents).toFixed(
      2
    )} to buy a fractional share of our DEMO tokenized asset (DEMO-xTBILL). This is a demo token built for this hackathon, not a real yield-bearing security. Nothing executes until you approve below.`,
    riskNotes: [
      "This is a demo asset, not a real-world tokenized security — see the in-app and on-chain labeling.",
      "Any yield shown in-app is simulated for demonstration only, not a real, guaranteed return.",
      "This transaction is capped and requires your explicit one-tap approval — TrustRamp never sends a real transaction on your behalf without that.",
    ],
  };

  // The client must echo `preparedTx` back to /api/approve-transaction exactly
  // as received. Editing any signed field invalidates the signature.
  res.json({ preparedTx });
});

// --- 3. Human approves — the only path that can lead to execution ---
// Response shape is {allowed, reason} by design. LOCKED. See header.
app.post("/api/approve-transaction", sensitiveLimiter, requireSharedSecret, async (req, res) => {
  const { preparedTx, humanApproved } = req.body || {};

  if (humanApproved !== true) {
    return res.status(403).json({
      allowed: false,
      reason: "Human-in-the-loop confirmation required. Rejected server-side.",
    });
  }

  // Integrity check BEFORE anything else touches spend state (P1-1).
  const verified = verifyPreparedTx(preparedTx);
  if (!verified.ok) {
    return res.status(400).json({ allowed: false, reason: verified.reason });
  }

  // The testnet practice flow is meant to be zero financial risk; without this
  // it would eat into the same real-money $25 cap.
  if (preparedTx.network !== "mainnet") {
    return res.status(400).json({ allowed: false, reason: "Approval flow is mainnet-only." });
  }

  const valueCents = preparedTx.valueCents;
  if (valueCents < MIN_TX_CENTS) {
    return res.status(400).json({ allowed: false, reason: `Minimum transaction is $${usd(MIN_TX_CENTS).toFixed(2)}.` });
  }

  const address = preparedTx.userAddress.toLowerCase();

  let result;
  try {
    result = await withWriteLock(() => {
      const storage = getApprovalData(); // throws ApprovalStoreUnavailable — fails closed
      const record = storage.userApprovals[address];
      // Clamped: this file is plain JSON on disk with no schema enforcement, so a
      // bad restore or a hand-edit could contain a negative number, which without
      // the clamp would silently grant free spending headroom.
      const spentCents = Math.max(0, Number(record?.totalSpentCents) || 0);

      if (spentCents + valueCents > MAINNET_SPENDING_CAP_CENTS) {
        const remaining = Math.max(0, MAINNET_SPENDING_CAP_CENTS - spentCents);
        return {
          status: 400,
          body: {
            allowed: false,
            reason: `Transaction of $${usd(valueCents).toFixed(2)} exceeds your remaining safety cap of $${usd(
              remaining
            ).toFixed(2)}.`,
          },
        };
      }

      storage.userApprovals[address] = {
        totalSpentCents: spentCents + valueCents,
        lastTxTimestamp: Date.now(),
        approvedCount: (Number(record?.approvedCount) || 0) + 1,
      };
      saveApprovalData(storage);

      return {
        status: 200,
        body: {
          allowed: true,
          status: "stub_not_yet_executing",
          note: "Execution wiring lands Day 11-12 per the build timeline. This endpoint currently only validates and records the approval gate.",
          totalSpentUSD: usd(storage.userApprovals[address].totalSpentCents),
        },
      };
    });
  } catch (err) {
    if (err instanceof ApprovalStoreUnavailable) {
      console.error("Approval store unavailable — refusing approval:", err.message);
      return res.status(503).json({
        allowed: false,
        reason: "Cannot verify your spending cap right now, so this transaction was not approved. Please try again shortly.",
      });
    }
    throw err;
  }

  res.status(result.status).json(result.body);
});

app.get("/api/network-info", publicLimiter, (_req, res) => res.json(X_LAYER));

const ALCHEMY_BUNDLER_URL = process.env.ALCHEMY_BUNDLER_URL;
app.post("/api/bundler", sensitiveLimiter, requireSharedSecret, async (req, res) => {
  if (!ALCHEMY_BUNDLER_URL) {
    console.error("ALCHEMY_BUNDLER_URL is not set — refusing bundler proxy requests.");
    return res.status(500).json({ error: "Server misconfigured." });
  }
  try {
    const upstream = await fetch(ALCHEMY_BUNDLER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type("application/json").send(text);
  } catch (err) {
    console.error("[bundler-proxy] upstream fetch failed:", err.message);
    res.status(502).json({ error: "Bundler upstream request failed." });
  }
});

// --- 5. Reputation quiz (Day 7-8) ---
//
// Grading is server-side; the frontend never sees a correct answer or a score.
// The mint step is user-initiated even though recordGraduation is onlyOwner and
// technically doesn't require user consent for funds-safety reasons — see
// Decision A in PROJECT_PLAN §7-8.3.
//
// Rate limiting: quiz endpoints share `chatLimiter` because they hit the same
// Anthropic backend and one user session generates ~9 requests (start + 8
// answers + complete + mint). The tighter `sensitiveLimiter` (100/15min) would
// throttle a single active user before they finished a demo run.
const quiz = createQuizHandlers({
  apiSharedSecret: API_SHARED_SECRET,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});
app.post("/api/quiz/start", chatLimiter, requireSharedSecret, quiz.start);
app.post("/api/quiz/answer", chatLimiter, requireSharedSecret, quiz.answer);
app.post("/api/quiz/complete", chatLimiter, requireSharedSecret, quiz.complete);
app.post("/api/quiz/mint", chatLimiter, requireSharedSecret, quiz.mint);

// --- Dev-only: reset the lifetime spending cap between test rounds ---
//
// The $25 cap is LIFETIME per address with no reset (locked decision). That is
// correct for the product and inconvenient for testing: a few live runs on your
// test address will exhaust it and you'll start seeing "exceeds your remaining
// safety cap," which is correct behaviour, not a bug. Rather than have you
// hand-delete data/approvals.json mid-session, this does it for you.
//
// Triple-gated so it cannot exist in production even by accident: shared secret
// AND NODE_ENV !== "production" AND an explicit opt-in env var. If you'd rather
// it not exist at all, delete this block — removing the file by hand works fine.
if (process.env.ENABLE_DEV_RESET === "true" && process.env.NODE_ENV !== "production") {
  app.post("/api/dev/reset-approvals", sensitiveLimiter, requireSharedSecret, async (req, res) => {
    const { userAddress } = req.body || {};
    await withWriteLock(() => {
      let storage;
      try {
        storage = getApprovalData();
      } catch {
        storage = { userApprovals: {} }; // dev-only path: rebuilding a corrupt file is the point
      }
      if (isValidAddress(userAddress)) delete storage.userApprovals[userAddress.toLowerCase()];
      else storage.userApprovals = {};
      saveApprovalData(storage);
    });
    console.warn("[dev] approvals reset for", userAddress || "ALL addresses");
    res.json({ allowed: true, reason: userAddress ? `Reset ${userAddress}.` : "Reset all addresses." });
  });
  console.warn("[dev] /api/dev/reset-approvals is ENABLED. Never set ENABLE_DEV_RESET in production.");
}

// --- Error-handling middleware — must be registered LAST, after all routes ---
//
// Without this, a malformed body never reaches our handlers: Express's
// body-parser throws first and the DEFAULT handler returns an HTML page with a
// full stack trace. That leaks internals, and the frontend's `await res.json()`
// would throw parsing HTML — producing a misleading "can't reach the backend"
// message even though the backend responded correctly.
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  // Preserve the real status when the error carries one (body-parser's
  // PayloadTooLargeError is a 413, not a 400).
  const status = Number.isInteger(err.status || err.statusCode) ? err.status || err.statusCode : 400;
  res.status(status).json({ error: "Invalid request." });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`TrustRamp backend listening on :${PORT}`));
