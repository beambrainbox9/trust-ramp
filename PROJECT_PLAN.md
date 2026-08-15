# Project: [Name TBD] — Autonomous Onboarding & Security Agent for RWA/DeFi on X Layer

**Role setup:** Claude = Senior Dev / CTO, writing and shipping every line of code.
Mo = Founder / Product Owner, reviewing, testing, deciding.
No prior technical assumption is made about Mo — every step below explains *why*, not just *what*.

## Elevator Pitch (10-Second Version — Use This When a Judge Asks "What Does This Do?")

**"We give total web3 beginners a wallet with no seed phrase, an AI that teaches them one
concept at a time using their own account, and a risk-free practice round before anything real.
When they're ready, the same AI walks them into their first real, small, human-approved purchase
of a tokenized asset on X Layer — and mints them an on-chain reputation score proving what they
actually understand, not just that they clicked through a tutorial."**

If they want the one-line version: **"Duolingo for DeFi, that ends with a real transaction and
an on-chain credential other apps can trust."**

**v2 note (Aug 7):** This plan was revised same-day to fold in three upgrades aimed squarely at
the AI-RWA $50K track and at differentiating from a "just another education app" pitch. Two of
the three changes carry real technical/safety tradeoffs — flagged honestly in Section 5a below,
not smoothed over. Read that section before assuming the full vision ships as pitched.

---

## 1. What We're Building (Plain English)

A web app that takes someone who has **never touched crypto** and safely walks them from
"what is a wallet" to "I just did my first real transaction on X Layer, with confidence."

Three moving parts:

1. **AI Tutor** — a chat assistant that looks at the user's *actual* connected wallet
   (empty wallet = total beginner path, wallet with a swap already = intermediate path)
   and teaches concepts using their real situation, not generic slides.
2. **Practice Sandbox** — a testnet environment where the user does a real swap/stake/bridge
   with fake money before ever touching real funds. The AI grades whether they understood it.
3. **Risk Explainer + Proof-of-Learning** — before any *real* transaction, AI explains in plain
   language what's about to happen and flags risk (unlimited approvals, slippage, etc). On
   completing the practice track, the user mints a **soulbound NFT** (non-transferable) as
   verifiable proof they finished the course — this lives on X Layer, satisfying the "onchain"
   requirement of the hackathon.

---

## 1a. What Changed in v2 — The Upgraded Pitch

Original pitch: "Learn web3 safely in a sandbox." Good, but generic and doesn't touch the AI-RWA
bonus pool.

**New pitch: "An AI agent that safely walks you from zero to your first real fractional RWA
position on X Layer — and vouches for you on-chain afterward."**

Three upgrades layered onto the original MVP:

1. **Embedded smart account (ERC-4337) instead of "connect your existing wallet."** New users
   don't need to already have a wallet or seed phrase — the app spins up a passkey-based smart
   account for them (fingerprint/FaceID to sign, no seed phrase to lose). The AI agent acts as a
   co-pilot that *prepares* real transactions (swaps, RWA purchases) and the user approves with
   one tap. This is a materially bigger technical lift than testnet-only — see Section 5a.
2. **Real-world-asset framing.** Instead of a generic "learn DeFi" track, the onboarding path is
   built around: "Understand and buy your first fractional tokenized asset." AI explains yield
   mechanics and risk (custody risk, redemption terms, that yield isn't guaranteed) before the
   user buys. Because no major RWA issuer is live on X Layer yet, the actual asset in the demo is
   a **mock RWA token we build ourselves** — clearly labeled as a demo, not a real yield product.
3. **Reputation score instead of a static completion badge.** The soulbound token becomes a
   queryable on-chain score (e.g., 0–100) representing verified understanding of specific
   concepts (**slippage, approval risk, custody risk, redemption terms** — see the v3 note below).
   Other contracts on X Layer could theoretically
   read this score to offer perks (gas discounts, higher limits) — we build the score contract
   and one example "consumer" contract that reads it, to prove the concept works end-to-end.

## 1b. What Changed in v3 (Aug 8) — Post-Audit Decisions

An independent audit of the Day 1-2 build (`AUDIT_DAY2.md`) found 4 blockers, 5 high and 9
medium issues, all now fixed and verified by execution rather than inspection. Three decisions
came out of it and are recorded here so they are not re-litigated mid-build.

**1. Reputation score is per-concept, not a single number. LOCKED.**
§1a promised "verified understanding of specific concepts" but the contract stored one `uint8`
and one `bool` — a number that cannot say *what* was understood. `TrustRampReputation.sol` now
scores four concepts independently: **Slippage, Approvals, Custody, Redemption**. The overall
0-100 and the "RWA verified" flag are **derived** from those four, never stored beside them, so
the contract cannot hold an overall of 95 next to four failing concept scores.

*Note on the reconciliation:* §1a previously listed "slippage, liquidation, custody risk" while
§5 item 5 listed "slippage, custody risk, and redemption terms." Those two lists disagreed. Both
were amended to the union of four. **Liquidation was then swapped for approval risk — see §1c below (Aug 9)**:
nothing in the MVP involves a leveraged or collateralized position, so there is nothing to be
liquidated and a judge would rightly ask why it's scored — whereas every swap and every RWA
purchase requires a token approval, and unlimited-approval risk is already named in §5a as
something the app teaches. The four scored concepts are therefore **slippage, approval risk,
custody risk, redemption terms**, and all four map to a concrete in-app action.

**2. Backend hosts on Render (~$7/mo), frontend stays on Vercel. LOCKED.** See §4.

**3. Faucet on the demo RWA token is now immutable and off by default.**
The plan requires a mainnet deployment. The previous contract would have published an unlimited
free-mint function on mainnet, on the very token users are asked to pay real money for. It is now
a constructor flag that cannot be changed after deployment: testnet deploys with `true`, mainnet
with `false`.

**Two gaps that remain open and must not be lost:**
- `humanApproved` is still a client-supplied boolean with no binding to an authenticated Privy
  session. Transaction *integrity* is now HMAC-protected server-side, but that proves "TrustRamp
  issued this exact transaction," not "this specific logged-in human approved it." Both are
  required before Day 11-12.
- `recordGraduation` is `onlyOwner`, so what is provable on-chain is that **TrustRamp attested**
  to a score, not that the user independently proved anything. This is how real attestation
  systems work and is defensible — but state it plainly in the pitch, in the same spirit §5a
  already applies to mock-RWA and to non-autonomy, rather than be caught by a judge asking
  "what stops you writing 100 for everyone?"

---

## 1c. What Changed in v4 (Aug 9) — Concept Swap: Liquidation -> Approvals

Raised by Mo on Day 3 review, before the AI scoring was wired into the contract.

**The problem:** of the four scored concepts, three (Slippage, Custody, Redemption) mapped
directly to something the user actually does in the product — the practice swap and the RWA
purchase. **Liquidation did not.** Nothing in the MVP involves a leveraged or collateralized
position, so there is nothing that can be liquidated. Scoring it meant attesting to comprehension
of something the user never encountered, and a judge asking *"why liquidation, I don't see
leverage here?"* would have had no good answer.

**The fix:** Liquidation was replaced with **Approval risk**. Every ERC-20 swap and every RWA
purchase requires a token approval, and unlimited-approval risk is *already named in §5a* as
something the AI explains before a real transaction — so this aligns the contract with what the
plan always said the product teaches. All four scored concepts now map to a concrete in-app
action.

**Implementation note, do not undo:** Approvals took index 1, the slot Liquidation held. Custody
stays at 2 and Redemption at 3, so `_passedRWA` — which keys off those two positions — needed no
change. The enum order is part of the contract ABI: append only, never reorder. Nothing was
deployed at the time of the swap, so there was no migration cost. Verified by recompiling and
re-running the full contract test suite on a local EVM.

The four scored concepts are therefore: **Slippage (0), Approvals (1), Custody (2),
Redemption (3)**, each 0-100.

---

## 1d. What Changed in v5 (Aug 11) — Deployed to X Layer Testnet

Four contracts confirmed live on chain 1952, verified independently via `eth_getCode` (not just
deploy-script output):

| Contract | Address |
|---|---|
| TrustRampReputation | `0x1C51dec8a42e425f79C4584bDbf00A5958b87F7d` |
| MockRWAYieldToken | `0x4BF84298151514512cB008B48f439d71DB1Cd6c4` |
| MockUSDC | `0xa9B8b8Aba1Fc34c790Ec9D7D452d65E4b0A3A9E5` |
| MockRWASale | `0x6466218A596e7FCB933ED5a02Fe5204dDa46435e` |

`buy(uint256 tokenAmount, uint256 maxPaymentIn)` — **not payable**, requires `approve()` on
MockUSDC first. `maxPaymentIn` guards against a price change mid-transaction; it is explicitly
**NOT slippage protection** (no AMM exists in this flow) and the contract header says so, so the
AI tutor never teaches a false protection.

**Test suite: 106 passing, 0 failing** (MockUSDC 21, MockRWASale 38, MockRWAYieldToken 15,
TrustRampReputation 32).

Mainnet deliberately **not** deployed yet — `server.js` returns 503 with a plain-language reason on
mainnet `prepare-transaction` calls rather than signing a transaction against undefined addresses.

### Open risk items carried into Day 7-12

1. **Deployer key is now the permanent admin key.**
   `0xDB53d8Fa7d6C4D69b459A952c6De9083853f5782` is the permanent TrustRampReputation owner and the
   only account that can call `recordGraduation` — it needs to stay funded and secure through
   submission.

2. **RESOLVED (Aug 11): Alchemy paymaster policy was the wrong type** (Bundler Sponsored
   Operations, beta-gated). Replaced with a new "Onchain Paymaster Policy"
   (`655835a1-eb5d-4045-b10e-24fabf56dd64`) on X Layer Testnet. Verified via raw RPC: gas paid by
   Alchemy's bundler EOA, smart account balance never left `0x0`. Old policy ID discarded.

3. **NEW — two gotchas found during the fix, both untested against Privy's actual fee/gas
   estimation path:**

   (a) X Layer's native `eth_maxPriorityFeePerGas` returns 1 wei; Alchemy's bundler requires
   ≥100,000 and rejects anything lower. Must use `rundler_maxPriorityFeePerGas` instead.

   (b) `verificationGasLimit` for first-time (undeployed) smart account creation must land in a
   narrow band — too low fails at the factory simulation step, too high fails on gas efficiency.
   300,000 worked in the standalone test.

   Privy handles fee/gas estimation internally, so these may not surface in the UI — but if a
   brand-new user's very first transaction fails, check these two first.

   **ACTION:** the first live frontend test of the approve→buy flow should specifically use a
   never-before-deployed smart account, since that's the scenario most likely to expose (b) and
   the real-world case every judge will hit.

---

## 1f. What Changed in v7 (Aug 12) — Day 5-6 Practice Sandbox COMPLETE

> Numbering note: there is no §1e / v6 in this document — the sequence runs 1a (v2), 1b (v3),
> 1c (v4), 1d (v5), then this. Kept as 1f/v7 as briefed rather than renumbered, so external
> references to "v7" stay valid.

Day 5-6 (testnet practice purchase flow) is done and QA-verified on a fresh passkey account.

**Verified working:** passkey login; chat tutor; faucet → approve → buy all complete with an
explicit human click (Privy modal) on every one of the three transactions; gas sponsored via
Alchemy paymaster; narration accurate and recovers from upstream (Anthropic) outages via retry
+ per-step error state.

**Payment/purchase design (locked earlier, confirmed live):** payment in MockUSDC (ERC-20) via
`approve()` → `buy()`, so the Approvals concept is genuinely exercised.
`buy(uint256 tokenAmount, uint256 maxPaymentIn)`; `maxPaymentIn` is an exact quote guarding
against an owner price change, explicitly **NOT** slippage protection (not an AMM) — tutor copy
matches the contract header.

**Human-approval enforcement — CRITICAL, lives in APPLICATION CODE not the Privy dashboard.**
Finding: Privy's `enforce_wallet_uis` dashboard setting was bypassable by per-call code
overrides, so the dashboard is **NOT** a safety net. All chain writes route through a single
`send()` function (`usePracticePurchase.js`); Privy's confirmation modal renders with no
`uiOptions` override, requiring a human click before submission. §5a human-approval principle
is intact. NOTE: this guarantee is currently **conventional** (rests on Privy's modal + a code
comment forbidding `showWalletUIs`), not structural. Making it structural = build our own
confirmation modal — deferred to pre-mainnet.

**Known cosmetic artifact (NOT a bug, accepted for hackathon):** the red "Execution reverted:
gas required exceeds allowance (0)" text appears inside **Privy's own modal** — Privy's gas
simulation runs against the first (unsponsored) attempt and shows the revert reason in its own
UI. We do not control this text. Transaction completes correctly every time. Underlying
mechanism: the first send may misfire unsponsored and is silently retried sponsored — hidden,
not eliminated. Pre-mainnet fix: own confirmation modal + configure Privy to skip its UI
(removes the text AND makes the human-approval guarantee structural).

**Paymaster:** correct policy is the Onchain Paymaster Policy
`655835a1-eb5d-4045-b10e-24fabf56dd64` (the old Bundler-Sponsored-Operations policy was the
wrong, beta-gated type — discarded). Confirmed sponsoring live (gas paid by Alchemy bundler
EOA, smart account balance stays 0).

**Rate limiting:** `chatLimiter` and `narrateLimiter` are separate buckets at 300/15min each;
sensitive (`prepare`/`approve-transaction`) stays 100/15min. **REQUIRES `TRUST_PROXY=1` on
Render** or all users share one bucket — Mo to confirm this env var is set on Render.

**Passkey status:** login/signup works reliably. The earlier "gas required exceeds allowance"
scare was **NOT** a passkey failure — passkey works; it was the Privy-modal simulation artifact
above. Passkey stays enabled.

**Two open non-blocking threads carried into Day 7-8:**
- Tutor-prioritization refinement: fix landed (tutor no longer steers new users to real-money
  funding before mentioning the free testnet flow); Mo wants continued improvement.
- `to`-address reconciliation between `server.js` `preparedTx.to` and frontend direct contract
  calls — must not drift before Day 11-12.

---

## Day 7-8 — Reputation Score Wiring (NEXT)

### 7-8.0 Three QA fixes first (found Aug 12, before/alongside the wiring)

1. **Chat markdown not rendering.** Tutor output shows literal `**asterisks**` instead of bold.
   Render chat text through a markdown renderer.

2. **Session/state persistence is inconsistent — fix properly, not with a patch.**
   - Chain-read state (balances, allowances) persists correctly. No action.
   - **Chat history persistence differs by login method:** an email account retained history
     across a browser restart, a passkey account did not. Diagnose whether this is the
     `smartAccountAddress` localStorage-key flicker found on Aug 11 (the sticky-address fix)
     or something separate.
   - **Practice-flow step progress does not persist** — "Start the walkthrough" reappears for a
     user who already claimed the faucet and holds funds. Unintended.
   - REQUIRED: chat history AND flow-step progress both persist per-account, reliably,
     regardless of login method. Close the tab, come back, resume where you left off. Confirm
     on BOTH an email and a passkey account after a REAL browser restart, not same-session.

3. **Tutor should flow into the quiz conversationally after a completed purchase**, rather than
   stopping dead. This is the front end of the Day 7-8 wiring below — build it as part of that,
   not as a separate afterthought.

### 7-8.1 The wiring itself

Contract `TrustRampReputation` already deployed + tested (32 passing). Work is **WIRING, not
building** — with one genuine build: **the quiz does not exist yet.**

- Build the AI comprehension check over the 4 locked concepts (Slippage=0, Approvals=1,
  Custody=2, Redemption=3 — ABI-locked, append-only). Question wording MUST come from
  `frontend/src/lib/glossary.js`, which exists for exactly this reason: the practice flow and
  the quiz must not use different words for the same idea, or we score our own inconsistency
  instead of the learner's understanding.
- Connect quiz results to `recordGraduation` on-chain. `onlyOwner`, so the **deployer key
  (`0xDB53...5782`) signs server-side** — keep it funded.
- Deploy one example "consumer" contract that reads a score back, proving "other protocols can
  query this".
- This path is server-side and does **NOT** touch the passkey/paymaster flow.

### 7-8.2 Folded-in open threads (non-blocking)

- Tutor-prioritization refinement — the fix landed; continued improvement wanted.
- `to`-address reconciliation between `server.js` `preparedTx.to` and the frontend's direct
  contract calls. Must not drift before Day 11-12.

### 7-8.3 Wiring plan (approved Aug 12)

Day 5-6 verified complete first: login, tutor, faucet, approve, buy, gas sponsorship,
human-approval on every transaction, repeatability, step persistence, and narration
consistency all confirmed with log/screenshot evidence.

**Approach.** The quiz IS the tutor — same chat pane, same tone, entered as a mode when
`PURCHASE_DONE` lands. Fix #3 from §7-8.0 (conversational continuation into the quiz) is
delivered by this, not bolted on separately.

**Grading is server-side only.** Judge's question: "how do I know your AI isn't just
handing out 100s?" — the answer must be that the grader cannot be influenced from the
browser. The frontend never sees correct answers or scores; each concept gets a small
number of questions (2 to start) drawn from bank language grounded in
`frontend/src/lib/glossary.js`; a separate grading prompt on the backend returns
`uint8[4]` scores. Only those scores reach the chain.

**Endpoints (server-side, sign with deployer key):**
- `POST /api/quiz/start` — issue a session with the question bank and a server-held answer key.
- `POST /api/quiz/answer` — record an answer, return next question, no scores exposed.
- `POST /api/quiz/complete` — grade all answers, return per-concept scores AND overall,
  return a signed intent the frontend echoes back to `/api/quiz/mint`.
- `POST /api/quiz/mint` — verify intent, call `recordGraduation(student, scores)`.

The intent split exists so that the mint step is a distinct, user-triggered action rather
than an automatic follow-on to grading. It also lets the grader be idempotent for a given
session while the mint stays a one-shot signed call.

#### Decision A — `recordGraduation` is user-initiated, not automatic (LOCKED)

`recordGraduation` is `onlyOwner` and the deployer key signs it, so **the user technically
cannot approve this transaction and does not need to for funds-safety reasons** — nothing of
theirs moves. That does not make user-initiation optional here.

An explicit "Mint my reputation score" click is required. Rationale:

1. **Consistency of the pattern.** Every other on-chain action in the product happens on a
   deliberate human click. Making the reputation write silent because it's technically safe
   would train the wrong reflex in exactly the flow the product is showcasing.
2. **Legibility to a judge.** The demo reads cleaner when the user visibly consents to the
   mint. "The AI graded me, and I chose to publish the score" is a stronger story than
   "the AI graded me and wrote it on-chain."
3. **The user opts INTO reputation.** A student who scores badly and would rather not have
   that on-chain retains the choice not to mint. `recordGraduation` handles re-attestations,
   so a later retake is not blocked.

Record this as a design decision, not a UX preference. Do not "streamline" it later.

#### Decision B — one human, two reputations, accepted for the hackathon (LOCKED)

Consistent with §1c/§1d and the standing account-model note. Passkey signup and email
signup produce different smart accounts, so the same person taking the practice + quiz on
one signup method has `hasGraduated: false` if they return via the other.

Not resolved in code for the hackathon. Post-hackathon fix is Privy account linking. The
constraint is that this **must** appear in demo/pitch materials as a named limitation, so
a judge asking "what happens if I sign up again" gets an honest, prepared answer instead
of a surprised one. Adding to the risks / open-questions section below is the record; the
pitch owner surfaces it in the video and script.

#### Decision C — fail-and-retry on Anthropic outage (LOCKED)

Grading uses the Anthropic API. If it is unreachable the backend returns an error and the
user can retry the quiz session. **No permissive fallback ever** — a default score would
inflate reputations while looking healthy, which is exactly the dishonesty this product
exists to avoid.

#### Sequence

1. This plan update.
2. `ScoreConsumerExample.sol` + tests + deploy-script wiring.
3. Deploy consumer to X Layer Testnet 1952, verify with `eth_getCode` and a live `eth_call`.
4. Backend `/api/quiz/*` endpoints, signing with the deployer key via a server viem wallet
   client. Deployer balance confirmed at ~0.20 OKB, contract ownership confirmed matching.
5. Frontend quiz mode inside `ChatTutor`, entered on `PURCHASE_DONE`, ending in a
   user-initiated "Mint my reputation score" button.
6. End-to-end verification with on-chain proof: mine one recordGraduation on a test
   account, then call `canReadRWA(that address)` on the consumer contract and read a
   non-zero result. Not "should work" — the receipt hash and the returned bool.

---

## Parked — Phase 2 / post-hackathon (recorded so it isn't lost)

- **Image/document upload to the tutor**, so a beginner can show a screenshot or a file instead
  of typing out what they're looking at. Genuinely good for the target user; out of scope for
  the Aug 21 deadline.

---

## 2. Why This Idea (Recap)

- Judges will see a flood of "AI trading bot" submissions. Onboarding is underserved.
- Plays to strengths Mo already has: UX/product sense, ability to ship fast, safety-first
  thinking (SafeAlerts background).
- Demos well live in front of judges — a trading bot is hard to prove works in 3 minutes;
  a guided onboarding flow is easy to *show*.
- Nothing on the market currently combines AI tutor + wallet-aware personalization +
  testnet sandbox + on-chain soulbound credential, chain-specific to X Layer. (Verified via
  research — closest are LearnWeb3 and MetaMask Learn, both static/content-only, no AI, no
  chain-specific integration.)

---

## 5a. Honest Feasibility Read — Read This Before Getting Attached to the Full Vision

As CTO, I owe you the unfiltered version, not the version that sounds best in a pitch meeting.

**Embedded smart account with AI auto-execution on mainnet: partially scoped down.**
Full autonomous execution (AI signs and sends real transactions with zero human click) is a
security liability we should not ship live for judging, full stop — not because it's technically
impossible, but because a bug in an AI-signed real-money flow is the kind of failure that ends
badly and is hard to justify having rushed in under 2 weeks. What we're actually building:
- Embedded ERC-4337 passkey wallet: yes, real, on mainnet — this part is genuinely valuable UX
  (no seed phrases for newbies) and is achievable in the timeline.
- AI *prepares* transactions and explains them; user gives final one-tap approval: yes.
- AI *auto-executes without any human confirmation*: **not for the hackathon submission.** We'll
  say so plainly in the pitch — "human-in-the-loop by design, autonomous execution on our
  roadmap" — which is a defensible, judge-credible position, not a weakness.

**RWA integration: real UX, mock asset.**
No major tokenized-treasury or real-estate issuer is confirmed live on X Layer as of this
research. So "onboard into real BlackRock BUIDL on X Layer" isn't something we can truthfully
claim. We build a self-issued demo RWA token (transparently labeled as a demo in-app and in the
pitch) so the *onboarding experience* — AI explaining yield, risk, and mechanics before a real
fractional purchase — is fully real and fully demoable, just not backed by an actual off-chain
asset yet. This is a completely normal and honest thing to disclose in a hackathon pitch; judges
building in this space know real RWA rails take partnerships, not two weeks.

- Payment for the demo RWA purchase is in a self-issued **MockUSDC (ERC-20)**, not native OKB.
  Decision made Aug 11: native-token payment would have left "Approvals" (scored concept index 1)
  untestable, since no ERC-20 `approve()` step would exist in the flow. MockUSDC exists solely so
  the approval step — and its risk lesson — is real, not ceremonial.

**Reputation score contract: fully real, no caveats.** This is a straightforward Solidity
extension of the original SBT plan and ships as designed.

**Bottom line:** the pitch becomes "AI-guided, human-approved onboarding into your first RWA
position, with an on-chain reputation system other protocols can build on" — ambitious, credible,
honest about what's demo vs. production. That combination tends to win more hackathons than an
overclaimed pitch that doesn't survive a judge's follow-up question.

**✅ Confirmed with Mo (Aug 7):** Human-approval-required for every real transaction is locked in
for the hackathon submission. Mo's explicit condition: this is accepted as the *current* build,
not the permanent ceiling — full/partial autonomous execution stays on the post-hackathon roadmap
as a real feature to build toward once the human-approved flow is proven safe and working. Noting
this now so it doesn't get lost or re-litigated mid-build: **the roadmap forward is toward more
autonomy, earned incrementally, not frozen at human-in-the-loop forever.**

---

## 3. Hard Deadlines (Do Not Miss)

| Date (UTC) | What Happens | Why It Matters |
|---|---|---|
| **Aug 21, 2026, 23:59 UTC** | Hackathon submission deadline | Miss this = disqualified, full stop |
| **Aug 21, 2026, 23:59 UTC** | Applications close for BuildX AI Season | Same deadline, separate mention in the post — confirms it's real |
| **Aug 31, 2026, 23:59 UTC** | Launch Grant volume checkpoint (10M USDT traded = 50K USDT unlocked) | Not our target for the hackathon submission itself, but relevant if we later push for the Launch Grant — requires *live usage*, not just a demo |

**Today is Aug 7, 2026.** That gives us **14 days** until submission.

Required to qualify (**confirmed directly from web3.okx.com, Aug 7**):
- Build AI into the product ✅ (our whole premise)
- Deploy on X Layer **Testnet during the hackathon, then subsequently launch on X Layer
  Mainnet** — this is a hard eligibility requirement, not optional. Validates the embedded-wallet
  mainnet flow already in this plan.
- Maintain a dedicated X account, **active for the project's lifetime** (not just through
  submission) — Mo needs to create this in Week 1 and keep posting after Aug 21 too
- When submitting, the project's official X account must post and tag @XLayerOfficial
- **Submit via the designated Google Form by Aug 21, 23:59 UTC** — confirmed submission format,
  no separate video/repo link required by the rules themselves (though a demo video is still
  smart to include if the form allows attachments/links)

**Two separate prize tracks — different targets, don't conflate them:**

| Track | Requirement | Realistic for us? |
|---|---|---|
| **Liquidity Grant ($50K, AI-RWA track)** | Judged qualitatively — product quality, innovation, user value, ecosystem contribution. Best-performing project in the track wins. | **Yes — this is our actual target.** No volume threshold, judged on the build itself. |
| **Launch Grant (up to $200K)** | Requires $10M+ cumulative trading volume through the **OKX DEX interface specifically** (API-routed volume excluded) by Aug 31, 23:59 UTC+8 | **No — not realistic for our timeline or product type.** Treat as out of scope entirely; don't let it distract planning. |

Full disclaimer on file: <cite index="2-1,2-2">the hackathon isn't an offer or solicitation to buy, sell, or transact in any digital asset, digital assets are volatile and speculative, and participants can lose the entire value of their assets</cite> — worth keeping in mind for how we word any real-money flow in the product itself, not just the hackathon terms.

---

## 4. Tech Stack (and why each piece)

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **React** (Vite) | You already know React; fast dev loop; matches hackathon judge expectations |
| Styling | **Tailwind CSS** | Fast to build clean UI without fighting CSS; matches your design instincts |
| Wallet connection | **wagmi + viem** (via RainbowKit or ConnectKit) for the "connect existing wallet" fallback path | Industry-standard, well documented, EVM-compatible so it works with X Layer unmodified |
| Embedded smart account | **ERC-4337 account abstraction** — using a managed provider SDK (e.g. Alchemy Account Kit, ZeroDev, or Privy — final pick made Day 1–2 based on X Layer support) rather than building account abstraction infra from scratch | Passkey-based wallets (FaceID/fingerprint) with no seed phrase, appropriate for true beginners; building AA infra ourselves from zero is not realistic in 14 days — using an established SDK is the responsible choice here |
| Chain (learning/sandbox parts) | **X Layer Testnet** | Zero financial risk while teaching |
| Chain (embedded wallet + real approval flow) | **X Layer Mainnet**, capped to small, user-approved transactions only | Required to genuinely claim "real execution," but scoped to human-approved, low-value transactions only — see Section 5a |
| Smart contracts | **Solidity**: (1) mock RWA token contract, (2) reputation score contract (replaces simple SBT), (3) one example "consumer" contract that reads the reputation score | Reputation score needs to be queryable, not just a static badge — see Section 1a |
| Contract dev/deploy tooling | **Hardhat** | Standard, well-supported, good local testing before touching mainnet — critical now that real funds touch the flow |
| AI layer | **Claude API** (Anthropic) | Powers the tutor chat, risk-explainer, transaction-preparation, and comprehension grading that sets the reputation score |
| Backend | **Node/Express** — proxies the Claude API key, and coordinates the "AI prepares transaction → user approves" handoff | Keeps API keys off the frontend; also the natural place to enforce "no auto-execution without a human tap" as a hard rule, not just a UI suggestion |
| Hosting (frontend) | **Vercel** | Free, fast, reliable for a hackathon demo |
| Hosting (backend) | **Render, paid tier (~$7/mo)** — confirmed Aug 8 | **Not** Vercel serverless. The approval store is a JSON file on disk guarded by an in-process lock; serverless gives every request a possibly-different container, so the file would not persist and the lock would protect nothing — the $25 spending cap would silently break. Render runs one long-lived process, which is what that design requires. Paid rather than free tier because Render's free tier sleeps after ~15 min idle and takes 30-60 s to wake — unacceptable for a judge opening a cold link. Cancel after Aug 21. A VPS (Vultr etc.) is technically the better long-term fit and is deferred to Phase 2: it adds process supervision, reverse proxy, and HTTPS certificate management that we cannot afford to own 13 days out, and Privy passkey login requires HTTPS. |

**Fix log (Aug 11):** Smart account activation was failing with `Buffer is not defined` — Vite
doesn't polyfill Node's `Buffer` global by default, which Privy's smart-wallet creation (via
viem/permissionless internals) requires. Fixed by installing `vite-plugin-node-polyfills` and
adding it to `vite.config.js` plugins, scoped to `buffer` only. Without this, smart account
creation fails silently and the UI shows a misleading "check dashboard" fallback message — worth
knowing if this resurfaces after a dependency update.

Also: passkey login was disabled in the Privy dashboard — both toggles were off (Login Methods →
Passkey, and passkeys-for-signup). With `passkey_auth: false` the app 403'd on
`/api/v1/passkeys/authenticate/init` with `Login with passkey not allowed`; enabling only the
first is not enough, since a brand-new user (a judge) hits the *signup* path. Both are now on.

**Passkey signup confirmed end-to-end Aug 11** using the Windows Hello PIN platform authenticator:
signup → smart account `0xab718F24eCE01698A505F58bd0A801155f58f663`, verified on chain 1952
(recognised by EntryPoint v0.7, nonce 0, counterfactual). Email login also confirmed working
(`0xc9f63920a79509765da6A77Db3502caff50Ff47E`). No USB security key is involved or needed — the
platform authenticator is the flow beginners actually use, which is the "no seed phrase" claim in
the pitch.

Open question, not a bug: the two signup routes produce two different smart accounts for the same
person, because the address derives from (factory, owner, salt) and each route has a different
owner. The lifetime $25 cap is keyed by address in `server.js`, so signing up twice yields two
separate caps, and on-chain reputation would split across both. Worth resolving (Privy account
linking, or restricting the demo to one signup method) before execution wiring lands Day 11–12.

Related, same day: the AA provider was switched from **thirdweb to Alchemy**. thirdweb's bundler
rejects X Layer on both chains (`Invalid chain: 1952`, `Invalid chain: 196`) and its AccountFactory
is not deployed on 1952 (`eth_getCode` → `0x` on two independent RPCs), which caused the
long-running `getAddress returned no data ("0x")` error. Pimlico was also checked with a valid key
and does not support X Layer either. Alchemy's bundler is verified live on 1952 and 196, and its
LightAccountFactory is deployed on both. Bundler/paymaster URLs and the Gas Manager policy live in
the **Privy dashboard only** — they cannot be set from code, since `SmartWalletsProvider` accepts
`paymasterContext` and nothing else. Do not trust a vendor's supported-chains page for X Layer;
confirm with a live bundler request first.

**Security note:** because real funds are now in scope (mainnet embedded wallet), every
transaction-value cap and confirmation-required rule gets enforced **server-side**, not just in
the UI — a user editing the frontend in devtools should never be able to bypass the human-approval
requirement or a spending cap. This is non-negotiable regardless of timeline pressure.

---

## 5. Product Scope — MVP Only

To hit Aug 21, we build **only** this. Nothing else, no matter how good the idea sounds mid-build:

1. Landing page explaining the product (30 seconds to understand what it does)
2. Embedded passkey smart account creation (no seed phrase) — with "connect existing wallet" as
   a fallback option
3. AI chat tutor — reads wallet/account state, explains one concept at a time, remembers
   conversation
4. **One** practice flow on testnet: a fixed-price purchase of the demo RWA token, walked through
   step by step with AI narration — zero financial risk, purely educational.
   **Not an AMM swap** (corrected Aug 11): the practice round buys MockRWAYieldToken from a sale
   contract at a fixed price. This is deliberate — see the shared-code-path note in §6.
   Payment asset: MockUSDC (demo ERC-20), not native OKB — see §5a.
5. AI comprehension check — a short conversational quiz covering **slippage, approval risk,
   custody risk, and redemption terms** before "graduating"
6. **The real flow:** AI explains and prepares a small, capped-value purchase of our demo RWA
   token on mainnet; user reviews the AI's plain-language risk summary and approves with one tap;
   transaction executes only after that human approval
7. Reputation score minted/updated on-chain based on comprehension results, plus one example
   contract that reads the score to demonstrate the "protocols can query this" concept
8. A results/dashboard screen showing the user's reputation score and what it verifies

**Explicitly out of scope for the hackathon submission** (future roadmap, not now):
- Autonomous execution with zero human approval step (see Section 5a — deliberate, not a
  time-crunch cut. **Confirmed roadmap item, not shelved:** once the human-approved flow is
  proven safe in production, next step is likely tiered autonomy — e.g. AI auto-executes only
  below a small user-set spending cap, escalates to approval above it. Real design work for
  Phase 2, not something to rush into now.)
- Real (non-mock) RWA issuer integration — depends on partnerships we don't have yet
- Multiple learning tracks beyond the one swap + one RWA purchase flow
- Mobile app
- Multi-language support
- Leaderboards / social features
- Other protocols actually integrating the reputation score (we prove the concept with one
  example consumer contract; real third-party adoption is post-hackathon business development,
  not something code alone can deliver)

If Mo wants to add these later for the Launch Grant push (post-hackathon, targeting the Aug 31
volume milestone), we scope that as **Phase 2** — a separate plan, after submission is safe.

---

## 6. Build Timeline (14 Days)

| Days | Phase | Deliverable | Mo's Job |
|---|---|---|---|
| Day 1–2 (Aug 7–8) | Setup & Architecture | Repo scaffolded; embedded smart-account SDK picked and wired (testnet first); Claude API wired to a basic chat | Create project X account; check web3.okx.com/xlayer/build-x for submission format; review this plan and flag anything you disagree with |
| Day 3–4 (Aug 9–10) | AI Tutor Core | Chat tutor reads account state, explains concepts contextually, remembers conversation | Test conversations, flag anything robotic or factually wrong |
| Day 5–6 (Aug 11–12) | Practice Sandbox (testnet, zero risk) | Testnet **fixed-price purchase** flow with AI narration at each step (not an AMM swap — see below) | Walk through it as a total beginner — note every confusing moment |
| Day 7–8 (Aug 13–14) | Reputation Score Contract | Solidity contract for the score, tested locally, deployed to testnet; one example "consumer" contract that reads it | Review contract logic explained in plain English — no assumed Solidity knowledge |
| Day 9–10 (Aug 15–16) | Mock RWA Token + Risk Explainer | Demo RWA contract deployed; AI risk-summary flow built; comprehension quiz gates the reputation score update | Test edge cases: wrong quiz answers, no funds, cancelled approval |
| Day 11–12 (Aug 17–18) | Real Approval Flow (mainnet, capped, human-in-the-loop) | AI-prepared transaction + one-tap human approval wired end-to-end; server-side spending cap enforced | This step touches real value — test thoroughly, and only with amounts you're fully comfortable risking |
| Day 13 (Aug 19) | Polish + Demo Video | UI cleanup, bug fixes, record submission demo video | Review video and messaging — especially that we're accurately describing mock-RWA vs. real, human-approved vs. autonomous |
| Day 14 (Aug 20–21) | Buffer + Submit | Final QA, submit before 23:59 UTC Aug 21 | Confirm submission went through; post from project X account tagging @XLayerOfficial |

### Day 5–6 correction (Aug 11): purchase, not swap

The original brief for this phase said "testnet swap flow" against an already-deployed
MockRWAYieldToken. **Both halves of that were wrong**, found while starting the build:

- **Nothing is deployed.** There is no `contracts/deployments/` directory, which `deploy.js`
  writes on success — so `deploy:testnet` has never completed. Neither MockRWAYieldToken nor any
  sale contract exists on testnet *or* mainnet. `server.js:419` still points prepared transactions
  at the zero address, and its own comment says "placeholder until MockRWAYieldToken is deployed".
  Any language elsewhere implying the token is live is stale.
- **There was nothing to swap with.** MockRWAYieldToken has exactly two functions of its own —
  `claimFaucet()` and `faucetRemainingFor()` — plus inherited ERC-20. No price, no payable path,
  no router, no counterparty. A repo-wide search for swap/buy/purchase/router returned nothing.

**Design decision — one purchase contract, one code path.** The practice round (testnet) and the
real purchase (mainnet, Day 11–12) use the **same `MockRWASale` contract and the same frontend
code path**. They differ only by chain and by the mainnet-only additions: the server-side spending
cap and the human-approval gate. This is the reason we build a fixed-price *sale* contract rather
than a mock AMM — an AMM would be a practice-only detour that teaches a flow the user never
repeats, and the Day 11–12 work would then be a rewrite rather than an extension. The practice
round should rehearse the real thing.

**This timeline is tighter than the v1 plan because the scope is genuinely bigger.** If we're
behind by Day 8, the cut order is: (1) drop the example "consumer" contract for the reputation
score — keep the score itself, cut the demo of others reading it; (2) simplify the mainnet
approval flow to a single fixed-amount "starter purchase" instead of a flexible amount; (3) as an
absolute last resort, fall back to testnet-only for the real-purchase step and clearly label it
as such in the pitch. **We do not cut the deadline, and we do not cut the human-approval
requirement on real transactions, under any time pressure.**

---

## 7. How We'll Work Together (Guidelines)

Since Claude is doing 100% of the code and Mo is reviewing:

1. **No jargon without explanation.** Every technical term Claude introduces gets a one-line
   plain-English definition the first time it's used in a session.
2. **No silent assumptions.** If Claude isn't sure what Mo wants (e.g., color scheme, wording of
   the risk warning), Claude asks rather than guessing and moving on.
3. **Working code over perfect code, but never insecure code.** For a hackathon, we optimize for
   "it works and demos well." We do **not** cut corners on: wallet security, not exposing API
   keys, not letting the AI say something misleading about risk.
4. **Every deliverable gets a plain-language changelog.** After each build session, Claude
   summarizes: what got built, what to test, what's still missing — no assuming Mo read the code.
5. **Deadlines are non-negotiable; scope is negotiable.** If something is taking too long, we cut
   the feature before we cut the deadline. See Section 5's "explicitly out of scope" list — that's
   our cut list, in priority order (cut from the bottom of that list up if we're behind... actually
   cut features we haven't built yet, never half-finished ones).
6. **Test as we go, not at the end.** Each phase in Section 6 ends with something Mo can actually
   click through, not just code Claude says "should work."
7. **On-chain self-verification never touches a real user address.** Added Aug 15 after Claude
   ran a `recordGraduation` acceptance test against Mo's actual passkey smart account
   (`0x2Ee1…B46e`), polluting a real-product-QA address with a test-generated reputation.
   The rule going forward:

   - Any internal verification that calls an owner-only or admin write —
     `recordGraduation`, and any similar future admin function — must target a **disposable
     address generated inside the test itself** (`ethers.Wallet.createRandom()`, funded
     minimally if needed). Never one of Mo's real Privy-linked addresses.
   - Any session that writes on-chain state as part of self-verification must **disclose,
     unprompted, the exact address(es) and tx hash(es) written to** in its report. Do not
     leave that trail to be reverse-engineered later.
   - The reason: reputation is per-account and cannot be un-minted. Overwriting a real
     user's record in place is possible (see `recordGraduation` design) but it destroys
     the audit chain of "this score came from a real quiz session by a real person",
     which is the whole point of an on-chain reputation.

---

## 8. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| X Layer testnet RPC/faucet issues (common in hackathons — testnets get congested) | Get testnet funds and confirm RPC access in Day 1–2, not Day 9 |
| Claude API costs during heavy testing | Use a cheap/fast model for dev iteration, only switch to the strongest model for final demo polish |
| Submission format unclear (video? live link? GitHub repo?) | Mo confirms exact requirements at web3.okx.com/xlayer/build-x by end of Week 1 |
| Solidity contract bugs (soulbound logic, i.e. blocking transfers correctly) | Written and tested locally with Hardhat *before* any testnet deployment |
| Scope creep (adding "just one more feature") | Section 5's explicit MVP boundary — reviewed together before Day 6 |
| **One human → two smart accounts → two reputations** (Aug 12, LOCKED for hackathon). Passkey signup and email signup produce different smart accounts, so the same person can graduate on one and appear as a stranger on the other. Reputation writes make this concrete, and it cannot be un-minted afterwards. | Accepted for the submission — Privy account linking is the post-hackathon fix. **Must be surfaced in the demo video and pitch script as a known, planned limitation** so a judge asking "what happens if I sign up again" gets a prepared, honest answer rather than a surprised one. |

**Open questions for Mo to answer before Day 3:**
- ~~What should the project be called?~~ **Confirmed Aug 7: "TrustRamp."**
- ~~Does BuildX require a live deployed demo link, a video walkthrough, or both?~~ **Confirmed
  Aug 7: submission is via Google Form.** Still worth attaching a demo video/link within the form
  if it accepts one — strengthens the pitch even though not strictly required.
- ~~Do you want the AI tutor's tone casual/friendly or more formal/professional?~~ **Confirmed
  Aug 7: friendly, specifically "warm-but-credible"** — approachable like a patient, trustworthy
  guide, never cutesy or jokey about risk, since real money is involved. Not stiff/compliance-doc
  formal either. This tone rule applies everywhere the AI speaks: chat tutor, risk explainer, and
  transaction-approval prompts alike.

---

## 9. Next Steps (Immediate)

1. Mo confirms project name and answers the open questions in Section 8.
2. Mo creates the dedicated X account for the project.
3. Mo checks web3.okx.com/xlayer/build-x for exact submission requirements.
4. Claude scaffolds the repo (Day 1 deliverable) once name + answers are confirmed.

---

*This document is the source of truth for scope and deadlines. If anything changes mid-build,
we update this file first, then adjust the code — not the other way around.*
