// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Demo stablecoin used as the PAYMENT asset in the TrustRamp practice
 *         purchase. This is NOT real USDC and is not redeemable for anything.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The practice purchase originally took payment in native OKB. That worked, but
 * it meant the flow contained NO ERC-20 approval step — and "Approvals" is one
 * of the four concepts TrustRampReputation scores (index 1, ABI-locked). The
 * quiz would have tested a concept the user never actually performed.
 *
 * The fix is to make the payment an ERC-20, so `approve()` is genuinely
 * required before `buy()` can pull the funds. The approval the tutor explains is
 * now a real approval, doing real work, that really would be dangerous if set to
 * an unlimited amount. Nothing ceremonial.
 *
 * ---------------------------------------------------------------------------
 * DECIMALS: 6, NOT 18
 * ---------------------------------------------------------------------------
 * Real USDC uses 6 decimals. Mirroring that is deliberate: it means the sale
 * contract has to handle a payment token and a purchased token with DIFFERENT
 * precision, which is where real integrations get their arithmetic wrong. If we
 * used 18 here, the code would look correct and would silently break the first
 * time it met an actual stablecoin.
 *
 * ---------------------------------------------------------------------------
 * FAUCET SAFETY — same pattern as MockRWAYieldToken
 * ---------------------------------------------------------------------------
 * `faucetEnabled` is an immutable constructor flag: true on testnet, false on
 * mainnet, and it cannot be flipped afterwards. A switch that can be flipped is
 * a switch a compromised owner key can flip, and there is no legitimate reason
 * to open a free-mint on a mainnet payment token. Per-address cooldown,
 * per-address total cap, and a global issuance cap all mirror the demo asset —
 * per-address limits alone do not create scarcity when addresses are free.
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private constant DECIMALS = 6;

    uint256 public constant FAUCET_CLAIM_AMOUNT = 1_000 * 10 ** 6; // 1,000 USDC
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    uint256 public constant FAUCET_MAX_TOTAL_PER_ADDRESS = 5_000 * 10 ** 6;
    uint256 public constant FAUCET_MAX_TOTAL_SUPPLY = 10_000_000 * 10 ** 6;

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
     * @param enableFaucet Pass `true` for X Layer testnet, `false` for mainnet.
     *                     Cannot be changed afterwards.
     */
    constructor(bool enableFaucet) ERC20("DEMO USD Coin (TrustRamp)", "DEMO-USDC") Ownable(msg.sender) {
        faucetEnabled = enableFaucet;
        _mint(msg.sender, 1_000_000 * 10 ** DECIMALS);
    }

    /// @dev Overridden to 6 — see the decimals note in the header.
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Claim practice funds. Testnet only; reverts on a mainnet deployment.
    function claimFaucet() external {
        if (!faucetEnabled) revert FaucetDisabled();

        // lastFaucetClaim defaults to 0, so a first-time claimer's availableAt is
        // one day past the epoch — cleared by any real block timestamp. No
        // special case needed, and adding one silently disables the cooldown
        // whenever block.timestamp is small (learned in MockRWAYieldToken).
        uint256 availableAt = lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN;
        if (block.timestamp < availableAt) revert FaucetCooldownActive(availableAt);
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

    /// @notice Remaining faucet allowance for an address, in token base units.
    function faucetRemainingFor(address user) external view returns (uint256) {
        uint256 claimed = totalFaucetClaimed[user];
        if (claimed >= FAUCET_MAX_TOTAL_PER_ADDRESS) return 0;
        return FAUCET_MAX_TOTAL_PER_ADDRESS - claimed;
    }
}
