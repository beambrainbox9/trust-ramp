// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockRWASale
 * @notice Fixed-price sale of MockRWAYieldToken, paid for in MockUSDC.
 *
 * ---------------------------------------------------------------------------
 * PLAIN ENGLISH, FOR REVIEW
 * ---------------------------------------------------------------------------
 * This contract is a vending machine. It holds a pile of the demo asset, has one
 * fixed price, and hands tokens over to anyone who pays. It does not quote a
 * market price, does not route through a pool, and nothing about the price moves
 * while you trade.
 *
 * WHY A SALE AND NOT A SWAP (decided Aug 11, see PROJECT_PLAN Day 5-6 note):
 * The testnet practice round and the real mainnet purchase on Day 11-12 run
 * through THIS SAME contract and the same frontend path. They differ only by
 * chain, and by the spending cap and human-approval gate that mainnet adds. A
 * mock AMM would have taught a flow the user never repeats and would have made
 * Day 11-12 a rewrite instead of an extension.
 *
 * WHY PAYMENT IS AN ERC-20 AND NOT NATIVE OKB (changed Aug 11):
 * The first version took native OKB via a payable buy(). That worked, but it
 * meant the practice flow contained NO approval step — and "Approvals" is one of
 * the four concepts TrustRampReputation scores (index 1, ABI-locked). The quiz
 * would have tested a concept the user never performed. Payment is now MockUSDC,
 * so approve() is genuinely required before buy() can pull the funds: the
 * approval the tutor explains is a real one, doing real work, that really would
 * be dangerous set to an unlimited amount.
 *
 * DECIMALS: the payment token has 6 (mirroring real USDC) and the asset has 18.
 * costFor() therefore scales between two different precisions — this is the
 * arithmetic real integrations get wrong, so it is tested explicitly.
 *
 * SAFETY POSTURE
 * Minimal on purpose. This touches real funds on mainnet later, so every
 * function here is one someone will have to justify:
 *
 * 1. NO PRICE ORACLE, NO SLIPPAGE ON-CHAIN. The price is fixed and owner-set.
 *    `maxPaymentIn` therefore protects against one specific real risk — the
 *    owner changing the price in a block that lands before your transaction —
 *    not against market movement. Stated plainly because the tutor teaches
 *    slippage against this flow, and teaching a protection that does nothing
 *    would be worse than teaching none.
 *
 * 2. REENTRANCY. buy() moves two different ERC-20s. State is written before the
 *    transfers and nonReentrant is applied belt-and-braces.
 *
 * 3. NO ARBITRARY-CALL, NO UPGRADE PATH, NO PAUSE. Each is a function an
 *    attacker holding the owner key could use to drain or brick this.
 *
 * 4. OWNER POWERS ARE DELIBERATELY LIMITED. The owner can set the price, add
 *    supply, withdraw proceeds, and recover unsold stock. The owner CANNOT take
 *    a buyer's tokens, block a buyer, or reach any balance other than this
 *    contract's own.
 *
 * 5. SafeERC20 THROUGHOUT. Some ERC-20s return false instead of reverting;
 *    SafeERC20 turns that into a revert. Our own mocks are well-behaved, but the
 *    mainnet payment token will not be ours.
 */
contract MockRWASale is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The demo asset being sold (18 decimals). Set once at deployment.
    IERC20 public immutable token;

    /// @notice The ERC-20 accepted as payment (MockUSDC, 6 decimals).
    IERC20 public immutable paymentToken;

    /// @notice One whole asset token, in asset base units. Cached to avoid a
    ///         magic 1e18 in the pricing maths.
    uint256 public immutable oneToken;

    /// @notice Payment base units per ONE whole asset token.
    uint256 public pricePerTokenUnits;

    event Purchased(address indexed buyer, uint256 tokensOut, uint256 paidUnits);
    event PriceUpdated(uint256 oldPriceUnits, uint256 newPriceUnits);
    event SupplyAdded(address indexed from, uint256 amount);
    event ProceedsWithdrawn(address indexed to, uint256 amount);
    event UnsoldTokensRecovered(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroPrice();
    error SameToken();
    error InsufficientSupply(uint256 requested, uint256 available);
    error PriceExceedsMax(uint256 required, uint256 maxAccepted);
    error NothingToWithdraw();

    /**
     * @param token_        MockRWAYieldToken address (the asset being sold).
     * @param paymentToken_ MockUSDC address (the asset used to pay).
     * @param priceUnits_   Payment base units per whole asset token. Non-zero.
     */
    constructor(address token_, address paymentToken_, uint256 priceUnits_) Ownable(msg.sender) {
        if (token_ == address(0) || paymentToken_ == address(0)) revert ZeroAddress();
        // Same address for both would let a buyer pay in the asset they receive.
        if (token_ == paymentToken_) revert SameToken();
        if (priceUnits_ == 0) revert ZeroPrice();

        token = IERC20(token_);
        paymentToken = IERC20(paymentToken_);
        pricePerTokenUnits = priceUnits_;
        oneToken = 10 ** IERC20Metadata(token_).decimals();
    }

    /// @notice Asset tokens still available to buy.
    function availableSupply() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @notice Payment base units required for `tokenAmount` asset base units.
     * @dev Rounds UP. Rounding down lets a buyer take a dust amount of the asset
     *      for zero payment on the last significant digit — small, but a free
     *      value leak, and the fix costs one line. This is also where the
     *      6-vs-18 decimal difference is reconciled.
     */
    function costFor(uint256 tokenAmount) public view returns (uint256) {
        return (tokenAmount * pricePerTokenUnits + oneToken - 1) / oneToken;
    }

    /**
     * @notice Buy `tokenAmount` of the asset, paying in `paymentToken`.
     *
     * REQUIRES AN APPROVAL FIRST: the caller must have approved this contract to
     * spend at least costFor(tokenAmount) of the payment token. That approval is
     * the concept the tutor teaches, and approving exactly this amount rather
     * than an unlimited allowance is the habit it teaches.
     *
     * @param tokenAmount  Asset base units to buy.
     * @param maxPaymentIn Revert if the cost exceeds this. See safety note 1 —
     *                     guards against an owner price change landing first,
     *                     not against market movement.
     */
    function buy(uint256 tokenAmount, uint256 maxPaymentIn) external nonReentrant {
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 available = availableSupply();
        if (tokenAmount > available) revert InsufficientSupply(tokenAmount, available);

        uint256 cost = costFor(tokenAmount);
        if (cost > maxPaymentIn) revert PriceExceedsMax(cost, maxPaymentIn);

        // Effects before interactions.
        emit Purchased(msg.sender, tokenAmount, cost);

        // Pull payment BEFORE delivering the asset. If the buyer has not
        // approved enough, this reverts here and nothing has been handed out.
        paymentToken.safeTransferFrom(msg.sender, address(this), cost);
        token.safeTransfer(msg.sender, tokenAmount);
    }

    // --- Owner functions -----------------------------------------------------

    /// @notice Update the fixed price. Emits old and new so a change is visible
    ///         in the event log, not only in current state.
    function setPrice(uint256 newPriceUnits) external onlyOwner {
        if (newPriceUnits == 0) revert ZeroPrice();
        uint256 old = pricePerTokenUnits;
        pricePerTokenUnits = newPriceUnits;
        emit PriceUpdated(old, newPriceUnits);
    }

    /**
     * @notice Pull `amount` asset tokens from the caller into this contract's stock.
     * @dev A pull rather than a plain transfer so the sale emits its own record
     *      of every supply change. Requires an allowance from the owner first.
     */
    function addSupply(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit SupplyAdded(msg.sender, amount);
    }

    /// @notice Withdraw accumulated payment-token proceeds to the owner.
    function withdrawProceeds() external onlyOwner nonReentrant {
        uint256 balance = paymentToken.balanceOf(address(this));
        if (balance == 0) revert NothingToWithdraw();
        paymentToken.safeTransfer(owner(), balance);
        emit ProceedsWithdrawn(owner(), balance);
    }

    /// @notice Recover unsold asset tokens. Only ever touches this contract's own
    ///         stock — a buyer's tokens are theirs and are unreachable here.
    function recoverUnsoldTokens(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 available = availableSupply();
        if (amount > available) revert InsufficientSupply(amount, available);
        token.safeTransfer(owner(), amount);
        emit UnsoldTokensRecovered(owner(), amount);
    }

    /**
     * @dev No receive() or fallback(), and buy() is no longer payable. Native OKB
     *      has no role in this contract at all now, so any sent to it would be
     *      permanently stranded — rejecting it at the door is the safe default.
     */
}
