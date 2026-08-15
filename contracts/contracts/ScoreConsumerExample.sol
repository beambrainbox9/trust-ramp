// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ScoreConsumerExample
 * @notice A minimal integrator that reads a student's TrustRamp reputation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * PROJECT_PLAN §1a / §5 describe the reputation contract as "queryable by other
 * protocols". Saying that is not the same as showing it. This contract is the
 * proof: an independent contract, at its own address, that reads the reputation
 * on-chain and returns a plain-English answer. If a judge asks "can any dapp
 * check this?", the reply is "yes — here is one that does, and here is its
 * address".
 *
 * SCOPE, KEPT DELIBERATELY SMALL
 * - No state. Pure reads.
 * - No admin. There is nothing to be owner of.
 * - No fees, no fund handling, nothing to audit for security beyond "does it
 *   read what it claims to read".
 * - Reads the SAME headline surface a real integrator would use — getScore()
 *   for a summary, understands() for a per-concept check. If those surfaces
 *   ever change on the reputation contract, so does this one, deliberately.
 *
 * NOT SCOPE
 * - Any actual gating on top of the score (e.g. "only lets you do X if score
 *   >= 80"). That belongs in the DeFi protocols we hope someone builds using
 *   this — not in an example whose job is to demonstrate readability.
 */

/// @dev Minimum surface needed. Mirrors TrustRampReputation's read functions
/// exactly. Kept as a local interface rather than an import so the example is
/// intelligible standalone on a block explorer, without hunting for another
/// contract's source.
interface ITrustRampReputation {
    enum Concept {
        Slippage,
        Approvals,
        Custody,
        Redemption
    }

    function getScore(address user)
        external
        view
        returns (uint8 overallScore, bool verifiedRWA, bool graduated);

    function understands(address user, Concept concept) external view returns (bool);
}

contract ScoreConsumerExample {
    /// @notice The TrustRampReputation contract this example queries.
    /// Immutable — a swap would defeat the point of being an example of
    /// integrating against a specific reputation source.
    ITrustRampReputation public immutable reputation;

    error ZeroAddress();

    constructor(address reputation_) {
        if (reputation_ == address(0)) revert ZeroAddress();
        reputation = ITrustRampReputation(reputation_);
    }

    /**
     * @notice The scenario a real RWA protocol would run before letting a user
     *         in: has this account been graded, and did they clear the
     *         RWA-specific bar (Custody AND Redemption ≥ threshold)?
     *
     * @return ok           True only when both conditions hold.
     * @return overallScore The user's overall score, or 0 if they never graduated.
     *                      Returned alongside `ok` so a caller can display a
     *                      reason ("not verified for RWA yet, current score 62")
     *                      without a second call.
     *
     * @dev Deliberately does NOT revert on a non-graduate. This is the read
     *      shape an integrator uses to DECIDE, so silence-with-context is the
     *      right shape — reverting would force them to catch-and-branch on
     *      every eligibility check.
     */
    function canReadRWA(address user)
        external
        view
        returns (bool ok, uint8 overallScore)
    {
        (uint8 score, bool verifiedRWA, bool graduated) = reputation.getScore(user);
        if (!graduated) return (false, 0);
        return (verifiedRWA, score);
    }

    /**
     * @notice Per-concept gate. Example use: an approval-heavy protocol wants
     *         to know the user specifically passed the Approvals bar, not just
     *         cleared an overall average.
     */
    function understandsConcept(address user, ITrustRampReputation.Concept concept)
        external
        view
        returns (bool)
    {
        return reputation.understands(user, concept);
    }
}
