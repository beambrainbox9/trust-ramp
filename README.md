# TrustRamp — Day 2 (post-audit, v3)

Built Aug 7-8, 2026. See `PROJECT_PLAN.md` for scope and `AUDIT_DAY2.md` for the full audit this
revision responds to.

---

## READ FIRST — one thing blocks the app from running

**`backend/.env` has a placeholder Anthropic API key.** `ANTHROPIC_API_KEY=sk-ant-your-key-here`
is not a real key. The AI tutor cannot work until a real one is pasted in, from
`console.anthropic.com` → API keys. Everything else is wired.

`.env` files are **deliberately excluded from this package** (see "Packaging" below). Your existing
local `.env` files stay exactly where they are — only replace the source files listed below.

---

## What changed in this revision

### Fixed — blockers
| | |
|---|---|
| **The AI tutor was broken on 100% of messages** | `ChatTutor.jsx` seeded state with an *assistant* greeting and shipped the whole array. The Anthropic Messages API requires the first message be `user`, so every request 400'd — and the frontend's catch-all rewrote it as "Sorry, I lost my train of thought," making total failure look like model flakiness. The greeting is now UI-only and never sent. |
| **Corrupting `approvals.json` granted a fresh $25 to everyone** | The parse-error handler failed *open*. Now fails closed (503), and writes are atomic via temp-file + rename, so a crash mid-write can no longer truncate the file into that state. |
| **`/api/prepare-transaction` accepted $999,999** | The cap guard used `network === "mainnet"`, so omitting the field skipped it. Now an explicit allowlist. |
| **`/api/approve-transaction` accepted a forged transaction** | `prepare` never had to be called. Prepared transactions are now HMAC-signed server-side with a 15-minute expiry and verified on approve. |

### Fixed — high / medium
Money stored as integer cents (was drifting: `5.000001`); consistent type validation across both
endpoints; `userAddress` validated before entering the system prompt (it was injectable);
`/api/chat` returns 400 with a reason instead of 500 with a stack trace; separate rate-limit
buckets so the public `/api/network-info` can't exhaust the tutor's quota; `TRUST_PROXY` support;
constant-time secret comparison; $0.50 minimum transaction.

### Contracts — rewritten and tested
`TrustRampReputation` now scores four concepts independently (Slippage, Approvals, Custody,
Redemption), derives the overall score and RWA flag from them, starts token IDs at 1, and renders
a **fully on-chain SVG credential** — no IPFS, no server, no link that can rot. `MockRWAYieldToken`
now has an immutable faucet flag (off on mainnet) and a global supply cap.

**14/14 behavioural tests pass on a local EVM.** Including: a user scoring 100/100/100/40 gets an
overall of 85 but is correctly **not** RWA-verified, because a strong average must not carry a
failed redemption score.

---

## Still open — do not read this as finished

1. **`humanApproved` has no session binding.** It is still a client-supplied boolean. The HMAC
   work above proves *"TrustRamp issued this exact transaction"*; it does **not** prove *"this
   logged-in human approved it."* Both are required before Day 11-12.
2. **Nothing is deployed.** Neither contract is on testnet or mainnet.
3. **No purchase function** on the demo token, so `preparedTx.to` is still the zero address.
4. **No Hardhat suite** — PROJECT_PLAN §8 commits to one.
5. **No example consumer contract.**
6. **Testnet RPC/faucet reachability unverified** from a real machine.

---

## Files to replace in your project

```
backend/server.js
frontend/src/components/ChatTutor.jsx
contracts/TrustRampReputation.sol
contracts/MockRWAYieldToken.sol
contracts/README.md
PROJECT_PLAN.md
README.md
```

## Preflight check — run this first

One command verifies everything that can only be checked from a machine with real
network access (Claude's sandbox cannot reach `xlayer.tech`):

```bash
cd backend && npm install && npm run verify
```

It checks: both X Layer RPCs plus all four fallbacks are reachable and report the right
chain IDs; the Anthropic key is present, valid, funded, and works with the exact model
the app calls; and the frontend/backend shared secrets match (a mismatch is a 401 that
looks like the AI failing). Exit code 0 means nothing is blocking.

To also read a specific smart account, exactly as the Day 3 tutor does:

```bash
npm run verify -- 0xYourSmartAccountAddress
```

Nothing in this script writes, signs, or spends. The only non-read-only call is a
~16-token Anthropic message costing a fraction of a cent.

### Getting the Anthropic key

**A Claude.ai subscription does not include API credits — they're separate products.**
Go to `console.anthropic.com`, add billing first ($5 minimum, which is far more than this
build needs), then API Keys → Create Key. It's shown once. Paste into `backend/.env` as
`ANTHROPIC_API_KEY`. Depositing the $5 also raises you from 5 to 50 requests/minute,
which matters if a judge is clicking around.

## Running it locally

```bash
# terminal 1
cd backend && npm install && npm run dev     # :8787

# terminal 2
cd frontend && npm install && npm run dev    # :5173, proxies /api to :8787
```

Open `localhost:5173`, log in with a passkey, send a message. **That round-trip working is the
Day 1-2 acceptance test.** If it fails with a shared-secret error, the tutor will now tell you
so directly instead of blaming itself.

### Optional: dev-only spending-cap reset

The $25 mainnet cap is **lifetime per address** (locked decision — see PROJECT_PLAN). Live testing
on Day 11-12 will exhaust it quickly and you will start seeing "exceeds your remaining safety cap,"
which is **correct behaviour, not a bug**. To reset between test rounds, set `ENABLE_DEV_RESET=true`
in `backend/.env` and POST to `/api/dev/reset-approvals`. It is triple-gated (shared secret +
`NODE_ENV !== production` + explicit opt-in) so it cannot exist in a production build. Deleting
`backend/data/approvals.json` by hand works just as well.

## Packaging

`.env` and `backend/data/` are **both** excluded from this package. The previous two exports each
leaked one of them — test data the first time, a live Privy app secret the second. Keep both on the
exclusion list when you re-zip.

## X Layer network info (verified Aug 8 2026 against OKX's live docs)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 196 (0xC4) | **1952** (0x7A0) — not 195, that's deprecated |
| RPC | `https://rpc.xlayer.tech` | `https://testrpc.xlayer.tech/terigon` |
| Explorer | okx.com/web3/explorer/xlayer | okx.com/web3/explorer/xlayer-test |

The odd-looking `/terigon` path is genuinely what OKX documents — a leftover from the pre-OP-Stack
Erigon nodes, not a typo. Public RPCs are rate-limited to 100 requests/second per IP.

## Terms used above, in plain English

- **Passkey** — your phone's fingerprint/FaceID, used to sign instead of a 12-word seed phrase.
- **Embedded smart wallet** — a wallet the app creates for you on login; you never handle a key.
- **Bundler** — infrastructure that takes "I want to do X" from a smart wallet and submits it to
  the chain.
- **Soulbound** — an NFT that can be minted to you and burned, but never sent or sold. A
  credential, not an asset.
- **HMAC** — a tamper-proof stamp the server puts on data so it can tell later whether the data
  came back unchanged.
