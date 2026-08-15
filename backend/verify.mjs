#!/usr/bin/env node
/**
 * TrustRamp preflight verifier
 * Run with:  npm run verify        (from the backend/ folder)
 *
 * Checks everything Claude's sandbox cannot reach, in one command:
 *   - X Layer testnet + mainnet RPC reachability, and that each reports the
 *     chain ID we think it does
 *   - the fallback RPCs in frontend/src/chains.js, so we know a demo-day
 *     outage has somewhere to fall back to
 *   - the Anthropic API key is present, well-formed, funded, and can actually
 *     complete a request with the exact model the app uses
 *   - the frontend and backend shared secrets match (a mismatch is a 401 that
 *     looks like the AI failing)
 *   - optionally, an address's balance and transaction count, which is exactly
 *     what the Day 3 tutor reads
 *
 * Exit code 0 = everything required passed. 1 = something required failed.
 * Nothing here writes, signs, or spends. Every call is read-only except the
 * Anthropic check, which sends one ~10-token message costing a fraction of a cent.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

let failures = 0;
let warnings = 0;

const pass = (m, d) => console.log(`  ${C.green}PASS${C.reset}  ${m}${d ? `\n        ${C.dim}${d}${C.reset}` : ""}`);
const fail = (m, d) => { failures++; console.log(`  ${C.red}FAIL${C.reset}  ${m}${d ? `\n        ${C.dim}${d}${C.reset}` : ""}`); };
const warn = (m, d) => { warnings++; console.log(`  ${C.yellow}WARN${C.reset}  ${m}${d ? `\n        ${C.dim}${d}${C.reset}` : ""}`); };
const section = (t) => console.log(`\n${C.bold}${C.cyan}${t}${C.reset}`);

// ---------------------------------------------------------------------------
// Minimal .env reader. We deliberately don't use dotenv here so this script can
// read BOTH .env files without polluting process.env with the frontend's.
// ---------------------------------------------------------------------------
function readEnv(file) {
  try {
    const out = {};
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
  } catch {
    return null;
  }
}

async function jsonRpc(url, method, params = [], timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, ms };
    const body = await res.json();
    if (body.error) return { ok: false, error: body.error.message || JSON.stringify(body.error), ms };
    return { ok: true, result: body.result, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const msg = err.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err.cause?.code || err.message;
    return { ok: false, error: msg, ms };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 1. Environment files
// ---------------------------------------------------------------------------
section("1. Environment configuration");

const beEnv = readEnv(path.join(ROOT, "backend", ".env"));
const feEnv = readEnv(path.join(ROOT, "frontend", ".env"));

if (!beEnv) fail("backend/.env not found", "Copy backend/.env.example to backend/.env and fill it in.");
else pass("backend/.env found");

if (!feEnv) fail("frontend/.env not found", "Copy frontend/.env.example to frontend/.env and fill it in.");
else pass("frontend/.env found");

const apiKey = beEnv?.ANTHROPIC_API_KEY;
if (!apiKey) {
  fail("ANTHROPIC_API_KEY missing from backend/.env");
} else if (apiKey === "sk-ant-your-key-here" || apiKey.includes("your-key")) {
  fail("ANTHROPIC_API_KEY is still the placeholder", "Get a real key at console.anthropic.com (add $5 billing first — a Claude.ai subscription does not include API credits).");
} else if (!apiKey.startsWith("sk-ant-")) {
  fail("ANTHROPIC_API_KEY doesn't look like an Anthropic key", "Real keys start with 'sk-ant-'.");
} else {
  pass("ANTHROPIC_API_KEY present and well-formed", `sk-ant-…${apiKey.slice(-4)}`);
}

// Shared-secret match. A mismatch produces a 401 that the UI can misread as an
// AI failure, so it's worth catching here rather than mid-demo.
const beSecret = beEnv?.API_SHARED_SECRET;
const feSecret = feEnv?.VITE_API_SHARED_SECRET;
if (!beSecret || !feSecret) {
  fail("Shared secret missing", `backend API_SHARED_SECRET: ${beSecret ? "set" : "MISSING"}, frontend VITE_API_SHARED_SECRET: ${feSecret ? "set" : "MISSING"}`);
} else if (beSecret !== feSecret) {
  fail("Shared secrets DO NOT match", "Every /api call will return 401. Make VITE_API_SHARED_SECRET identical to API_SHARED_SECRET.");
} else {
  pass("Frontend and backend shared secrets match");
}

if (feEnv?.VITE_PRIVY_APP_ID) pass("VITE_PRIVY_APP_ID present");
else fail("VITE_PRIVY_APP_ID missing from frontend/.env", "Login will not work without it.");

// This one is a warning, not a failure: the app doesn't read it at runtime,
// it's a note-to-self for the Privy dashboard step.
// Provider is Alchemy, not thirdweb — thirdweb's bundler rejects X Layer
// outright (`Invalid chain: 1952`), verified live Aug 10 2026.
if (feEnv?.ALCHEMY_API_KEY_FOR_PRIVY_DASHBOARD) {
  pass(
    "Alchemy API key recorded",
    `Bundler URL for the Privy dashboard:\n        https://xlayer-testnet.g.alchemy.com/v2/${feEnv.ALCHEMY_API_KEY_FOR_PRIVY_DASHBOARD}` +
      (feEnv?.ALCHEMY_GAS_POLICY_ID_FOR_PRIVY_DASHBOARD
        ? `\n        Gas Manager policy: ${feEnv.ALCHEMY_GAS_POLICY_ID_FOR_PRIVY_DASHBOARD}`
        : `\n        Gas Manager policy ID not recorded — needed for gas sponsorship.`)
  );
} else {
  warn("ALCHEMY_API_KEY_FOR_PRIVY_DASHBOARD not set", "Only needed as a reminder for the Privy dashboard config; not read at runtime.");
}

// ---------------------------------------------------------------------------
// 2. X Layer RPC reachability
// ---------------------------------------------------------------------------
section("2. X Layer RPC endpoints");

const NETWORKS = [
  {
    label: "Testnet (primary)", expectedChainId: 1952, required: true,
    url: "https://testrpc.xlayer.tech/terigon",
  },
  { label: "Testnet (fallback 1)", expectedChainId: 1952, required: false, url: "https://xlayertestrpc.okx.com/terigon" },
  { label: "Testnet (fallback 2)", expectedChainId: 1952, required: false, url: "https://xlayer-testnet.drpc.org" },
  { label: "Mainnet (primary)", expectedChainId: 196, required: true, url: "https://rpc.xlayer.tech" },
  { label: "Mainnet (fallback 1)", expectedChainId: 196, required: false, url: "https://xlayerrpc.okx.com" },
  { label: "Mainnet (fallback 2)", expectedChainId: 196, required: false, url: "https://xlayer-mainnet.drpc.org" },
];

const liveTestnetRpcs = [];
for (const n of NETWORKS) {
  const r = await jsonRpc(n.url, "eth_chainId");
  if (!r.ok) {
    const msg = `${n.label} unreachable — ${r.error}`;
    n.required ? fail(msg, n.url) : warn(msg, `${n.url} (fallback only — not blocking)`);
    continue;
  }
  const chainId = parseInt(r.result, 16);
  if (chainId !== n.expectedChainId) {
    fail(`${n.label} reports chain ID ${chainId}, expected ${n.expectedChainId}`, `${n.url} — do not use this endpoint until resolved.`);
    continue;
  }
  const blk = await jsonRpc(n.url, "eth_blockNumber");
  const height = blk.ok ? parseInt(blk.result, 16).toLocaleString() : "unknown";
  pass(`${n.label} — chain ${chainId}, block ${height}`, `${n.url} (${r.ms}ms)`);
  if (n.expectedChainId === 1952) liveTestnetRpcs.push(n.url);
}

// ---------------------------------------------------------------------------
// 3. Anthropic API — the key must actually work, not just look right
// ---------------------------------------------------------------------------
section("3. Anthropic API");

const MODEL = "claude-sonnet-5"; // must match backend/server.js

if (!apiKey || apiKey.includes("your-key") || !apiKey.startsWith("sk-ant-")) {
  warn("Skipped — no usable key configured", "Fix section 1 first, then re-run.");
} else {
  // Confirm the script and the server agree on the model, so this can't pass
  // here while the app calls something else.
  try {
    const serverSrc = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");
    if (!serverSrc.includes(`model: "${MODEL}"`)) {
      warn(`server.js does not use model "${MODEL}"`, "This check may not reflect what the app actually calls.");
    }
  } catch { /* non-fatal */ }

  const r = await (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word: ready" }] }),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    } catch (err) {
      return { status: 0, body: { error: { message: err.name === "AbortError" ? "timed out" : err.message } } };
    } finally {
      clearTimeout(timer);
    }
  })();

  if (r.status === 200) {
    const text = (r.body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const u = r.body.usage || {};
    pass(`Anthropic API works with ${MODEL}`, `replied "${text}" · ${u.input_tokens ?? "?"} in / ${u.output_tokens ?? "?"} out tokens`);
  } else if (r.status === 401) {
    fail("Anthropic rejected the key (401)", "The key is invalid or was revoked. Create a new one at console.anthropic.com.");
  } else if (r.status === 400 && /credit|balance/i.test(JSON.stringify(r.body))) {
    fail("Anthropic key is valid but the account has no credits", "Add credits under Billing at console.anthropic.com — $5 minimum, which is plenty for this build.");
  } else if (r.status === 404) {
    fail(`Model "${MODEL}" not available to this account (404)`, "Check the model name in backend/server.js against the current model list.");
  } else if (r.status === 429) {
    warn("Rate limited (429)", "The key works but you've hit a limit. Depositing $5 moves you from 5 to 50 requests/minute.");
  } else {
    fail(`Anthropic returned ${r.status || "no response"}`, r.body?.error?.message || JSON.stringify(r.body).slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
// 4. Optional: read a specific account, exactly as the Day 3 tutor does
// ---------------------------------------------------------------------------
const addressArg = process.argv.find((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
section("4. Account state (optional)");

if (!addressArg) {
  console.log(`  ${C.dim}Skipped. To check a specific smart account, re-run with the address:${C.reset}`);
  console.log(`  ${C.dim}  npm run verify -- 0xYourSmartAccountAddress${C.reset}`);
} else if (liveTestnetRpcs.length === 0) {
  warn("Skipped — no reachable testnet RPC to query");
} else {
  const rpc = liveTestnetRpcs[0];
  const [bal, txc] = await Promise.all([
    jsonRpc(rpc, "eth_getBalance", [addressArg, "latest"]),
    jsonRpc(rpc, "eth_getTransactionCount", [addressArg, "latest"]),
  ]);
  if (!bal.ok || !txc.ok) {
    fail("Could not read account state", bal.error || txc.error);
  } else {
    const wei = BigInt(bal.result);
    const okb = Number(wei) / 1e18;
    const count = parseInt(txc.result, 16);
    const level = count === 0 && wei === 0n ? "brand_new" : count === 0 ? "funded_never_transacted" : "has_activity";
    pass(`Account readable on testnet`, `${okb} OKB · ${count} transaction(s) sent · tutor would treat this as "${level}"`);
    if (wei === 0n) {
      warn("Balance is zero", "Claim testnet OKB from the X Layer faucet before testing the practice swap (Day 5-6).");
    }
  }
}

// ---------------------------------------------------------------------------
section("Summary");
if (failures === 0 && warnings === 0) {
  console.log(`  ${C.green}${C.bold}All checks passed.${C.reset} Nothing blocking.\n`);
} else if (failures === 0) {
  console.log(`  ${C.green}${C.bold}All required checks passed${C.reset} — ${warnings} warning(s) above, none blocking.\n`);
} else {
  console.log(`  ${C.red}${C.bold}${failures} required check(s) failed${C.reset}${warnings ? `, plus ${warnings} warning(s)` : ""}.`);
  console.log(`  ${C.dim}Fix the FAIL lines above and re-run. Nothing was changed on disk.${C.reset}\n`);
}
process.exit(failures === 0 ? 0 : 1);
