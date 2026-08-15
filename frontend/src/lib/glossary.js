// Shared vocabulary for the practice sandbox, the tutor narration, and the
// later comprehension quiz.
//
// WHY THIS FILE EXISTS
// The Day 5-6 brief requires that the wording used to teach "slippage" and
// "approval risk" during the practice swap MATCHES the wording the Day 7-8
// comprehension quiz uses to test them. If the flow says "maximum price movement
// you'll accept" and the quiz says "tolerance band", a learner who understood
// the lesson can still fail the question — and we'd be scoring our own
// inconsistency rather than their comprehension. Worse, that score is written
// on-chain by TrustRampReputation, so the inconsistency becomes permanent.
//
// RULE: the practice flow, the tutor's system prompt, and the quiz all import
// from here. Nothing re-words these concepts locally. If a definition needs to
// change, it changes here once and every surface follows.
//
// The `concept` field maps to the TrustRampReputation.Concept enum. That order
// is ABI-locked and append-only (Slippage=0, Approvals=1, Custody=2,
// Redemption=3) — these indices must not be reordered to match a UI preference.

export const CONCEPT = {
  SLIPPAGE: 0,
  APPROVALS: 1,
  CUSTODY: 2,
  REDEMPTION: 3,
};

// Canonical short definitions. Written at roughly a "smart friend explaining it
// at a kitchen table" level: no unexplained jargon, no false reassurance.
export const GLOSSARY = {
  approval: {
    concept: CONCEPT.APPROVALS,
    term: "approval",
    // One sentence. This is the phrasing the quiz question stem will reuse.
    short:
      "Permission you give a contract to move a specific amount of your tokens on your behalf.",
    // The risk framing. Deliberately says "unlimited" — the quiz distractors are
    // built around that exact word.
    risk:
      "An unlimited approval lets that contract move that token from your wallet at any point in the future, not just once. If the contract is buggy or malicious, that permission is still sitting there.",
    // What THIS flow does differently, and why it's the safer habit.
    ourBehaviour:
      "This practice swap asks for approval of exactly the amount you're swapping, and nothing more. When it's spent, it's spent — there's no standing permission left behind.",
  },

  // CAREFUL. An earlier version of this entry described slippage the usual way —
  // market movement, "minimum received" — and it was WRONG for this product.
  // MockRWASale is a fixed-price sale, not an AMM. There is no pool, no market
  // price, and therefore no slippage in the normal sense. The contract header
  // says so explicitly, and the tutor must never contradict its own contract.
  //
  // Slippage is still scored concept 0, so it must still be TAUGHT — just
  // honestly: what it is in general DeFi, and why it does not apply here.
  slippage: {
    concept: CONCEPT.SLIPPAGE,
    term: "slippage",
    short:
      "In most DeFi trades, the gap between the price you were quoted and the price you actually get, because the market can move between the two.",
    risk:
      "On a normal exchange the quote is an estimate, not a promise — someone else's trade can land first and change the price you get.",
    // The honest part. Saying "protected from slippage" here would be a lie.
    ourBehaviour:
      "This practice purchase does NOT have slippage. It is a fixed-price sale, not an exchange — there is no pool and no market price moving underneath you. You are learning what slippage is because it matters everywhere else, not because it is happening here.",
  },

  maxPaymentIn: {
    concept: CONCEPT.SLIPPAGE,
    term: "maximum payment",
    short:
      "A ceiling you set on what you are willing to pay. If the cost would exceed it, the transaction fails instead of going through.",
    // Precisely scoped — this is what the contract actually does.
    risk:
      "It protects against ONE thing: the seller changing the price in the moment between you being quoted and your transaction landing. It is not protection against market movement, because there is no market here.",
    ourBehaviour:
      "Set to the exact cost you were quoted. If the price changed even slightly, the purchase reverts and you keep your funds rather than paying more than you agreed.",
  },
};

// NOTE: an applySlippage() helper used to live here, computing a "minimum
// received" from a tolerance percentage. It has been REMOVED, not disabled.
// MockRWASale is a fixed-price sale with no pool, so there is no slippage to
// tolerate and no minimum-received to compute — the cost comes from the
// contract's own costFor(), and the protection is a maximum-payment ceiling.
// Keeping a plausible-looking slippage helper around would eventually get wired
// into something and would quietly reintroduce the wrong mental model.

/**
 * How much of the demo asset the practice round buys.
 *
 * Small on purpose: 1 whole token costs 2.00 DEMO-USDC, and one faucet claim is
 * 1,000 DEMO-USDC — so a learner can repeat the flow many times without
 * re-claiming, and without the amount being the interesting part of the lesson.
 */
export const DEFAULT_BUY_AMOUNT = 1;
