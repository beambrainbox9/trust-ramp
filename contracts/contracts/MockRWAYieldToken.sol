// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockRWAYieldToken
 * @notice Demo tokenized short-term T-Bill-style asset for TrustRamp onboarding.
 *         This is NOT a real yield-bearing security — see PROJECT_PLAN.md §5a.
 *
 * ---------------------------------------------------------------------------
 * PLAIN ENGLISH, FOR REVIEW
 * ---------------------------------------------------------------------------
 * A "faucet" is a function that hands out free tokens so people can practise
 * without spending anything. Great on a testnet. Dangerous on mainnet.
 *
 * Changes in this revision (Aug 8, 2026), from AUDIT_DAY2.md:
 *
 * 1. THE FAUCET IS NOW OFF BY DEFAULT AND CANNOT BE TURNED ON LATER. [was: High]
 *    PROJECT_PLAN requires a mainnet deployment. The previous version would have
 *    published an unlimited free-mint function on mainnet, on the very token we
 *    ask people to pay real money for. It is now a constructor flag, immutable
 *    once set: deploy testnet with `true`, mainnet with `false`. Immutable
 *    rather than owner-toggleable on purpose — a switch that can be flipped is a
 *    switch that can be flipped by a compromised owner key, and there is no
 *    legitimate reason to enable a faucet on mainnet after launch.
 *
 * 2. GLOBAL FAUCET SUPPLY CAP. [was: Medium]
 *    The previous version capped claims PER ADDRESS and the comment justified
 *    this as preserving "scarcity". Per-address caps don't create scarcity when
 *    addresses are free — anyone could mint unbounded supply from fresh wallets.
 *    Total faucet issuance is now hard-capped.
 *
 * Retained from the previous revision (all correct, kept as-is):
 *   - Name and symbol say DEMO on-chain, so anyone inspecting this on a block
 *     explorer sees what it is without needing our docs.
 *   - Per-address cooldown and per-address total claim cap.
 *   - No decorative yield constant. A contract that advertises an APY it does
 *     not implement is misleading, especially for a product whose whole pitch is
 *     teaching honest risk and yield mechanics.
 *
 * ---------------------------------------------------------------------------
 * STILL MISSING — Day 9-10, tracked, not forgotten
 * ---------------------------------------------------------------------------
 * There is no purchase function yet: no price, no payable path. PROJECT_PLAN §5
 * item 6 ("a small, capped, human-approved purchase") has no on-chain
 * counterpart, which is why the backend's prepared transaction still points at
 * the zero address.
 */
contract MockRWAYieldToken is ERC20, Ownable {
    uint256 public constant FAUCET_CLAIM_AMOUNT = 100 * 10 ** 18;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    uint256 public constant FAUCET_MAX_TOTAL_PER_ADDRESS = 500 * 10 ** 18;
    uint256 public constant FAUCET_MAX_TOTAL_SUPPLY = 1_000_000 * 10 ** 18;

    /// @notice Set once at deployment. True on testnet, false on mainnet.
    bool public immutable faucetEnabled;

    uint256 public totalFaucetIssued;
    mapping(address => uint256) public lastFaucetClaim;
    mapping(address => uint256) public totalFaucetClaimed;

    event FaucetClaimed(address indexed claimer, uint256 amount);

    error FaucetDisabled();
    error FaucetCooldownActive(uint256 availableAt);
    error FaucetAddressLimitReached();
    error FaucetSupplyExhausted();

    /**
     * @param enableFaucet Pass `true` for the X Layer testnet deployment,
     *                     `false` for mainnet. Cannot be changed afterwards.
     */
    constructor(bool enableFaucet) ERC20("DEMO xT-BILL (TrustRamp)", "DEMO-xTBILL") Ownable(msg.sender) {
        faucetEnabled = enableFaucet;
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    /**
     * @notice Claim a small, rate-limited amount of the demo asset for the
     *         practice flow. Testnet only — reverts entirely on a mainnet
     *         deployment.
     */
    function claimFaucet() external {
        if (!faucetEnabled) revert FaucetDisabled();

        // No special case for the first claim: lastFaucetClaim defaults to 0, so
        // availableAt is 1 day past the epoch, which every real block timestamp
        // clears. An earlier draft of this added an explicit `!= 0` guard for
        // the first claim; local EVM testing showed that guard silently disabled
        // the cooldown whenever block.timestamp was small, so it was removed
        // rather than kept as unnecessary special-casing.
        uint256 availableAt = lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN;
        if (block.timestamp < availableAt) {
            revert FaucetCooldownActive(availableAt);
        }
        if (totalFaucetClaimed[msg.sender] + FAUCET_CLAIM_AMOUNT > FAUCET_MAX_TOTAL_PER_ADDRESS) {
            revert FaucetAddressLimitReached();
        }
        if (totalFaucetIssued + FAUCET_CLAIM_AMOUNT > FAUCET_MAX_TOTAL_SUPPLY) {
            revert FaucetSupplyExhausted();
        }

        lastFaucetClaim[msg.sender] = block.timestamp;
        totalFaucetClaimed[msg.sender] += FAUCET_CLAIM_AMOUNT;
        totalFaucetIssued += FAUCET_CLAIM_AMOUNT;

        _mint(msg.sender, FAUCET_CLAIM_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_CLAIM_AMOUNT);
    }

    /// @notice Remaining faucet allowance for an address, in wei-denominated tokens.
    function faucetRemainingFor(address user) external view returns (uint256) {
        uint256 claimed = totalFaucetClaimed[user];
        if (claimed >= FAUCET_MAX_TOTAL_PER_ADDRESS) return 0;
        return FAUCET_MAX_TOTAL_PER_ADDRESS - claimed;
    }
}
