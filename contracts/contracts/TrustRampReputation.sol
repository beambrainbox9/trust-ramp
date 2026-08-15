// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title TrustRampReputation
 * @notice Soulbound (non-transferable) ERC-721 recording AI-verified comprehension
 *         of specific DeFi/RWA concepts, on X Layer.
 *
 * ---------------------------------------------------------------------------
 * PLAIN ENGLISH, FOR REVIEW (PROJECT_PLAN.md §7 rule 1)
 * ---------------------------------------------------------------------------
 * "Soulbound" = an NFT that can be minted to you and burned, but never sent or
 * sold to anyone else. It's a credential, not an asset. It proves the person
 * holding this wallet did the learning, and it can't be bought off someone who
 * did.
 *
 * What changed in this revision (Aug 8, 2026) — each traces to AUDIT_DAY2.md:
 *
 * 1. PER-CONCEPT SCORING (was: one number + one yes/no).
 *    PROJECT_PLAN §1a promises a score representing "verified understanding of
 *    specific concepts." A single 0-100 number cannot tell a judge — or another
 *    protocol reading this on-chain — WHAT was understood. Each of four concepts
 *    is now scored separately and queryable on its own.
 *    Note: §1a and §5 named two slightly different concept lists. This contract
 *    covers the union of both, and PROJECT_PLAN has been reconciled to match.
 *
 * 2. DERIVED, NOT STORED, OVERALL SCORE.
 *    The overall 0-100 and the "passed the RWA quiz" flag are COMPUTED from the
 *    concept scores rather than stored beside them. Deliberate: if stored
 *    separately, this contract could hold an overall of 95 next to four failing
 *    concept scores and nothing would catch it. Deriving makes contradictory
 *    state unrepresentable.
 *
 * 3. TOKEN IDs NOW START AT 1, NOT 0.
 *    `userTokenId[someone who never graduated]` returns 0 by default, which
 *    previously collided with the first real graduate's token. Safe today only
 *    because every read is guarded by `hasGraduated`. The example consumer
 *    contract still to be written is exactly the code that would read
 *    `userTokenId` directly and get a false positive. Starting at 1 removes the
 *    trap instead of documenting it.
 *
 * 4. ON-CHAIN tokenURI (was: none at all).
 *    Without this the credential renders as a blank NFT in any wallet or block
 *    explorer — a judge clicking through to the thing the whole pitch rests on
 *    would have seen nothing. Image and metadata are generated in Solidity and
 *    stored nowhere else: no IPFS, no server, no link that can rot.
 *
 * 5. _mint INSTEAD OF _safeMint.
 *    `_safeMint` calls back into the recipient to check it can receive NFTs.
 *    Every recipient here IS a contract — an ERC-4337 smart account — so that
 *    callback was a live dependency on an implementation detail of whatever
 *    account Privy provisions; if it lacked the hook, graduation would revert.
 *    That check exists to stop tokens being stranded in contracts that can't
 *    transfer them out. This token can never be transferred out by anyone, so
 *    the check guards against nothing here while adding a real failure mode.
 *    FLAGGED AS A DELIBERATE TRADEOFF, not an oversight.
 *
 * ---------------------------------------------------------------------------
 * v4 (Aug 9, 2026) — CONCEPT SWAP: Liquidation -> Approvals
 * ---------------------------------------------------------------------------
 * The fourth scored concept was originally Liquidation. It was swapped for
 * Approvals, and the reasoning is recorded here rather than only in
 * PROJECT_PLAN so that anyone reading this contract in isolation knows why.
 *
 * Nothing in the MVP involves a leveraged or collateralized position, so there
 * is nothing that can be liquidated. Scoring it would have meant attesting to
 * comprehension of something the user never encountered in the product — and a
 * judge asking "why liquidation, I don't see leverage here?" would have had no
 * good answer. It was the one concept of four that did not map to a real
 * in-app action.
 *
 * Approval risk maps directly: every ERC-20 swap and every RWA purchase in this
 * product requires a token approval, and unlimited approvals are already named
 * in PROJECT_PLAN §5a as a risk the AI explains before a real transaction. All
 * four scored concepts now correspond to something the user actually did.
 *
 * ENUM ORDERING NOTE: Approvals deliberately took index 1, the slot Liquidation
 * held. Custody stays at 2 and Redemption at 3, so `_passedRWA` — which keys
 * off those two positions — needed no change. Nothing was deployed at the time
 * of the swap, so there was no migration cost. Do not reorder these now.
 *
 * ---------------------------------------------------------------------------
 * STILL OPEN — do not read this file as finished
 * ---------------------------------------------------------------------------
 * `recordGraduation` is `onlyOwner`, so the backend holds an admin private key.
 * Two unresolved consequences:
 *   - Key custody (env var vs. a real secrets manager) is a decision for before
 *     Day 7-8 deployment.
 *   - What is provable on-chain is that TRUSTRAMP ATTESTED to these scores, not
 *     that the user independently proved anything. That is how real attestation
 *     systems work and it is defensible — but say it plainly in the pitch rather
 *     than get caught by a judge asking "what stops you writing 100 for
 *     everyone?" PROJECT_PLAN §5a applied exactly this honesty to mock-RWA and
 *     to non-autonomy; the same standard applies here.
 */
contract TrustRampReputation is ERC721, Ownable {
    using Strings for uint256;

    /// @notice The concepts this credential can attest to.
    /// Order is part of the ABI — append only, never reorder or remove.
    enum Concept {
        Slippage, // price moving between quote and execution
        Approvals, // letting a contract move your tokens — and why "unlimited" is dangerous
        Custody, // who actually controls the asset, and the risk in that
        Redemption // whether/how you get the underlying back, and on what terms
    }

    uint256 public constant CONCEPT_COUNT = 4;

    /// @notice Minimum per-concept score treated as "understood".
    uint8 public constant PASS_THRESHOLD = 70;

    struct ReputationData {
        uint8[4] conceptScores; // 0-100 per concept, indexed by Concept
        uint64 timestamp; // block timestamp of the most recent attestation
        uint32 attestationCount; // how many times this record has been written
    }

    uint256 private _nextTokenId = 1; // ids start at 1 — see note 3 above

    mapping(uint256 => ReputationData) private _records;
    mapping(address => uint256) public userTokenId;
    mapping(address => bool) public hasGraduated;

    event ReputationMinted(address indexed student, uint256 indexed tokenId, uint8 overallScore);
    event ReputationUpdated(address indexed student, uint256 indexed tokenId, uint8 overallScore);

    error ScoreOutOfRange(uint8 score);
    error NotGraduated(address student);
    error NonTransferable();

    constructor() ERC721("TrustRamp Onchain Score", "TRS") Ownable(msg.sender) {}

    // ------------------------------------------------------------------
    // Writes (backend only)
    // ------------------------------------------------------------------

    /**
     * @notice Mint or update a student's soulbound record.
     * @param student The smart account that did the learning.
     * @param conceptScores 0-100 for each concept, indexed by the Concept enum.
     */
    function recordGraduation(address student, uint8[4] calldata conceptScores) external onlyOwner {
        for (uint256 i = 0; i < CONCEPT_COUNT; i++) {
            if (conceptScores[i] > 100) revert ScoreOutOfRange(conceptScores[i]);
        }

        if (!hasGraduated[student]) {
            uint256 tokenId = _nextTokenId++;
            hasGraduated[student] = true;
            userTokenId[student] = tokenId;

            _records[tokenId] = ReputationData({
                conceptScores: conceptScores,
                timestamp: uint64(block.timestamp),
                attestationCount: 1
            });

            // State fully written before minting — checks-effects-interactions.
            _mint(student, tokenId);
            emit ReputationMinted(student, tokenId, _overall(conceptScores));
        } else {
            uint256 tokenId = userTokenId[student];
            ReputationData storage rec = _records[tokenId];
            rec.conceptScores = conceptScores;
            rec.timestamp = uint64(block.timestamp);
            rec.attestationCount += 1;

            emit ReputationUpdated(student, tokenId, _overall(conceptScores));
        }
    }

    // ------------------------------------------------------------------
    // Reads — the surface other protocols integrate against
    // ------------------------------------------------------------------

    /**
     * @notice Headline query. `graduated` is returned explicitly so callers can
     *         tell "never took the course" apart from "took it and scored 0" —
     *         the previous version returned (0,false) for both.
     */
    function getScore(address user) external view returns (uint8 overallScore, bool verifiedRWA, bool graduated) {
        if (!hasGraduated[user]) return (0, false, false);
        uint8[4] memory s = _records[userTokenId[user]].conceptScores;
        return (_overall(s), _passedRWA(s), true);
    }

    /// @notice Score for a single concept. Reverts if the user never graduated,
    ///         so an integrator cannot silently read 0 as "failed".
    function getConceptScore(address user, Concept concept) external view returns (uint8) {
        if (!hasGraduated[user]) revert NotGraduated(user);
        return _records[userTokenId[user]].conceptScores[uint256(concept)];
    }

    /// @notice All concept scores at once, indexed by the Concept enum.
    function getConceptScores(address user) external view returns (uint8[4] memory) {
        if (!hasGraduated[user]) revert NotGraduated(user);
        return _records[userTokenId[user]].conceptScores;
    }

    /// @notice Convenience for integrators: did this user clear the bar on one concept?
    function understands(address user, Concept concept) external view returns (bool) {
        if (!hasGraduated[user]) return false;
        return _records[userTokenId[user]].conceptScores[uint256(concept)] >= PASS_THRESHOLD;
    }

    function getAttestationMeta(address user) external view returns (uint64 timestamp, uint32 attestationCount) {
        if (!hasGraduated[user]) revert NotGraduated(user);
        ReputationData storage rec = _records[userTokenId[user]];
        return (rec.timestamp, rec.attestationCount);
    }

    // ------------------------------------------------------------------
    // Derived values — computed, never stored, so they cannot contradict
    // ------------------------------------------------------------------

    function _overall(uint8[4] memory s) internal pure returns (uint8) {
        uint256 total;
        for (uint256 i = 0; i < CONCEPT_COUNT; i++) total += s[i];
        return uint8(total / CONCEPT_COUNT);
    }

    /// @dev The RWA claim depends specifically on understanding who holds the
    ///      asset and on what terms you can get it back — custody and
    ///      redemption. A high slippage score must not be able to carry it.
    function _passedRWA(uint8[4] memory s) internal pure returns (bool) {
        return s[uint256(Concept.Custody)] >= PASS_THRESHOLD && s[uint256(Concept.Redemption)] >= PASS_THRESHOLD;
    }

    // ------------------------------------------------------------------
    // Metadata — fully on-chain: no IPFS, no server, no link that can rot
    // ------------------------------------------------------------------

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        ReputationData storage rec = _records[tokenId];
        uint8[4] memory s = rec.conceptScores;
        uint8 overall = _overall(s);

        string memory json = string.concat(
            '{"name":"TrustRamp Score #',
            tokenId.toString(),
            '","description":"Soulbound proof of AI-verified comprehension of specific DeFi and real-world-asset concepts, earned on TrustRamp. Non-transferable. Attested by TrustRamp; not an independent audit of the holder.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(_svg(overall, s))),
            '","attributes":[',
            _attr("Overall Score", overall),
            ",",
            _attr("Slippage", s[0]),
            ",",
            _attr("Approval Risk", s[1]),
            ",",
            _attr("Custody Risk", s[2]),
            ",",
            _attr("Redemption Terms", s[3]),
            ',{"trait_type":"RWA Verified","value":"',
            _passedRWA(s) ? "Yes" : "No",
            '"},{"trait_type":"Attestations","value":',
            uint256(rec.attestationCount).toString(),
            "}]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _attr(string memory label, uint8 value) internal pure returns (string memory) {
        return string.concat('{"trait_type":"', label, '","value":', uint256(value).toString(), ',"max_value":100}');
    }

    /// @dev Palette matches the app's design system: ink #0F1A2B, brass #D8A657,
    ///      paper #EDEBE3, teal #4F9D8C.
    function _svg(uint8 overall, uint8[4] memory s) internal pure returns (string memory) {
        return
            string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
                '<rect width="400" height="400" fill="#0F1A2B"/>',
                '<text x="32" y="52" fill="#D8A657" font-family="monospace" font-size="13" letter-spacing="3">TRUSTRAMP</text>',
                '<text x="32" y="76" fill="#EDEBE3" font-family="monospace" font-size="11" opacity="0.5">X LAYER ONCHAIN SCORE</text>',
                '<text x="32" y="168" fill="#EDEBE3" font-family="monospace" font-size="84">',
                uint256(overall).toString(),
                '</text><text x="32" y="196" fill="#EDEBE3" font-family="monospace" font-size="12" opacity="0.5">OVERALL / 100</text>',
                _bar("SLIPPAGE", s[0], 240),
                _bar("APPROVALS", s[1], 275),
                _bar("CUSTODY", s[2], 310),
                _bar("REDEMPTION", s[3], 345),
                '<text x="32" y="382" fill="#EDEBE3" font-family="monospace" font-size="9" opacity="0.35">SOULBOUND / NON-TRANSFERABLE</text>',
                "</svg>"
            );
    }

    function _bar(string memory label, uint8 value, uint256 y) internal pure returns (string memory) {
        uint256 width = (uint256(value) * 200) / 100;
        string memory colour = value >= PASS_THRESHOLD ? "#4F9D8C" : "#D8A657";
        return
            string.concat(
                '<text x="32" y="',
                (y - 6).toString(),
                '" fill="#EDEBE3" font-family="monospace" font-size="10" opacity="0.6">',
                label,
                '</text><rect x="150" y="',
                (y - 15).toString(),
                '" width="200" height="8" rx="4" fill="#1E2E4A"/><rect x="150" y="',
                (y - 15).toString(),
                '" width="',
                width.toString(),
                '" height="8" rx="4" fill="',
                colour,
                '"/><text x="360" y="',
                (y - 6).toString(),
                '" fill="#EDEBE3" font-family="monospace" font-size="10">',
                uint256(value).toString(),
                "</text>"
            );
    }

    // ------------------------------------------------------------------
    // Soulbound enforcement
    // ------------------------------------------------------------------

    /// @dev Permits mint (from == 0) and burn (to == 0); blocks every transfer
    ///      between two real addresses. OZ v5 routes all of them through _update.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) revert NonTransferable();
        return from;
    }
}
