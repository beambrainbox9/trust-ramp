const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ONE = 10n ** 18n; // asset token, 18 decimals
const USDC = 10n ** 6n; // payment token, 6 decimals
const PRICE = 2n * USDC; // 2.00 DEMO-USDC per whole asset token
const SEED = 10_000n * ONE; // asset stock held by the sale
const FUNDING = 100_000n * USDC; // payment tokens given to the buyer

describe("MockRWASale", function () {
  async function deploy() {
    const [owner, buyer, other] = await ethers.getSigners();

    const T = await ethers.getContractFactory("MockRWAYieldToken");
    const token = await T.deploy(true);
    await token.waitForDeployment();

    const U = await ethers.getContractFactory("MockUSDC");
    const usdc = await U.deploy(true);
    await usdc.waitForDeployment();

    const S = await ethers.getContractFactory("MockRWASale");
    const sale = await S.deploy(await token.getAddress(), await usdc.getAddress(), PRICE);
    await sale.waitForDeployment();

    await token.approve(await sale.getAddress(), SEED);
    await sale.addSupply(SEED);

    // Give the buyer payment tokens. Note: NO approval granted here — every
    // happy-path test must grant it explicitly, so a missing approval fails
    // loudly rather than being masked by fixture setup.
    await usdc.transfer(buyer.address, FUNDING);

    return { token, usdc, sale, owner, buyer, other };
  }

  describe("deployment", function () {
    it("records both tokens and the price", async function () {
      const { sale, token, usdc } = await loadFixture(deploy);
      expect(await sale.token()).to.equal(await token.getAddress());
      expect(await sale.paymentToken()).to.equal(await usdc.getAddress());
      expect(await sale.pricePerTokenUnits()).to.equal(PRICE);
    });

    it("caches one whole asset token from the asset's own decimals", async function () {
      const { sale } = await loadFixture(deploy);
      expect(await sale.oneToken()).to.equal(ONE);
    });

    it("rejects a zero asset address", async function () {
      const { usdc } = await loadFixture(deploy);
      const S = await ethers.getContractFactory("MockRWASale");
      await expect(
        S.deploy(ethers.ZeroAddress, await usdc.getAddress(), PRICE)
      ).to.be.revertedWithCustomError(S, "ZeroAddress");
    });

    it("rejects a zero payment address", async function () {
      const { token } = await loadFixture(deploy);
      const S = await ethers.getContractFactory("MockRWASale");
      await expect(
        S.deploy(await token.getAddress(), ethers.ZeroAddress, PRICE)
      ).to.be.revertedWithCustomError(S, "ZeroAddress");
    });

    // Paying in the same asset you receive would let a buyer loop for free.
    it("rejects the asset and payment token being identical", async function () {
      const { token } = await loadFixture(deploy);
      const S = await ethers.getContractFactory("MockRWASale");
      await expect(
        S.deploy(await token.getAddress(), await token.getAddress(), PRICE)
      ).to.be.revertedWithCustomError(S, "SameToken");
    });

    // A zero price would hand the entire supply out for free.
    it("rejects a zero price", async function () {
      const { token, usdc } = await loadFixture(deploy);
      const S = await ethers.getContractFactory("MockRWASale");
      await expect(
        S.deploy(await token.getAddress(), await usdc.getAddress(), 0)
      ).to.be.revertedWithCustomError(S, "ZeroPrice");
    });

    it("reports the seeded supply", async function () {
      const { sale } = await loadFixture(deploy);
      expect(await sale.availableSupply()).to.equal(SEED);
    });
  });

  describe("pricing across 18 and 6 decimals", function () {
    it("charges the price for one whole token", async function () {
      const { sale } = await loadFixture(deploy);
      expect(await sale.costFor(ONE)).to.equal(PRICE);
    });

    it("scales linearly for whole tokens", async function () {
      const { sale } = await loadFixture(deploy);
      expect(await sale.costFor(100n * ONE)).to.equal(100n * PRICE);
    });

    it("handles fractional amounts", async function () {
      const { sale } = await loadFixture(deploy);
      expect(await sale.costFor(ONE / 2n)).to.equal(PRICE / 2n);
    });

    // Rounding DOWN here would let a buyer take dust for zero payment.
    it("rounds the cost up, never down", async function () {
      const { sale } = await loadFixture(deploy);
      expect(await sale.costFor(1n)).to.equal(1n);
      expect(await sale.costFor(0n)).to.equal(0n);
    });
  });

  describe("approval requirement", function () {
    // The reason this contract takes an ERC-20 rather than native OKB: the
    // approval must be real, and its absence must be a real failure.
    it("reverts when the buyer has not approved", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      await expect(
        sale.connect(buyer).buy(amount, await sale.costFor(amount))
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });

    it("reverts when the approval is short of the cost", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost - 1n);
      await expect(
        sale.connect(buyer).buy(amount, cost)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });

    it("succeeds with an approval of exactly the cost", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost);
      await expect(sale.connect(buyer).buy(amount, cost)).to.not.be.reverted;
    });

    // A scoped approval is fully consumed — no standing permission is left
    // behind. This is the property the tutor claims, so it is tested.
    it("leaves zero remaining allowance after an exact-amount purchase", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost);
      await sale.connect(buyer).buy(amount, cost);
      expect(await usdc.allowance(buyer.address, await sale.getAddress())).to.equal(0n);
    });

    it("reverts when the buyer approved but lacks the balance", async function () {
      const { sale, usdc, other } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(other).approve(await sale.getAddress(), cost);
      await expect(
        sale.connect(other).buy(amount, cost)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientBalance");
    });
  });

  describe("happy path", function () {
    it("delivers the asset and collects payment", async function () {
      const { sale, token, usdc, buyer } = await loadFixture(deploy);
      const amount = 50n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost);

      await expect(sale.connect(buyer).buy(amount, cost))
        .to.emit(sale, "Purchased")
        .withArgs(buyer.address, amount, cost);

      expect(await token.balanceOf(buyer.address)).to.equal(amount);
      expect(await usdc.balanceOf(buyer.address)).to.equal(FUNDING - cost);
      expect(await usdc.balanceOf(await sale.getAddress())).to.equal(cost);
      expect(await sale.availableSupply()).to.equal(SEED - amount);
    });

    it("charges only the cost even when maxPaymentIn is generous", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), FUNDING);

      await sale.connect(buyer).buy(amount, cost * 10n);
      expect(await usdc.balanceOf(buyer.address)).to.equal(FUNDING - cost);
    });
  });

  describe("rejections", function () {
    it("reverts on a zero amount", async function () {
      const { sale, buyer } = await loadFixture(deploy);
      await expect(sale.connect(buyer).buy(0, 0)).to.be.revertedWithCustomError(sale, "ZeroAmount");
    });

    it("reverts when supply is exhausted", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const tooMuch = SEED + ONE;
      await usdc.connect(buyer).approve(await sale.getAddress(), FUNDING);
      await expect(sale.connect(buyer).buy(tooMuch, FUNDING))
        .to.be.revertedWithCustomError(sale, "InsufficientSupply")
        .withArgs(tooMuch, SEED);
    });

    it("drains to exactly zero, then refuses the next buy", async function () {
      const { sale, usdc, buyer, owner } = await loadFixture(deploy);
      // Buying the whole stock costs 20,000 USDC — top the buyer up first.
      await usdc.transfer(buyer.address, 100_000n * USDC);
      await usdc.connect(buyer).approve(await sale.getAddress(), ethers.MaxUint256);

      await sale.connect(buyer).buy(SEED, await sale.costFor(SEED));
      expect(await sale.availableSupply()).to.equal(0n);

      await expect(sale.connect(buyer).buy(ONE, await sale.costFor(ONE)))
        .to.be.revertedWithCustomError(sale, "InsufficientSupply")
        .withArgs(ONE, 0n);
      expect(owner).to.not.be.undefined;
    });

    it("enforces maxPaymentIn", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), FUNDING);

      await expect(sale.connect(buyer).buy(amount, cost - 1n))
        .to.be.revertedWithCustomError(sale, "PriceExceedsMax")
        .withArgs(cost, cost - 1n);
    });

    // maxPaymentIn exists to protect against exactly this.
    it("protects a buyer from an owner price rise landing first", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const quoted = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), FUNDING);

      await sale.setPrice(PRICE * 3n); // owner moves the price

      await expect(sale.connect(buyer).buy(amount, quoted))
        .to.be.revertedWithCustomError(sale, "PriceExceedsMax")
        .withArgs(quoted * 3n, quoted);
    });

    // buy() is no longer payable and there is no receive/fallback.
    it("rejects native OKB sent directly", async function () {
      const { sale, buyer } = await loadFixture(deploy);
      await expect(
        buyer.sendTransaction({ to: await sale.getAddress(), value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });

  describe("owner functions", function () {
    it("lets the owner change the price", async function () {
      const { sale } = await loadFixture(deploy);
      const next = PRICE * 2n;
      await expect(sale.setPrice(next)).to.emit(sale, "PriceUpdated").withArgs(PRICE, next);
      expect(await sale.costFor(ONE)).to.equal(next);
    });

    it("rejects a zero price update", async function () {
      const { sale } = await loadFixture(deploy);
      await expect(sale.setPrice(0)).to.be.revertedWithCustomError(sale, "ZeroPrice");
    });

    it("blocks non-owners from setPrice", async function () {
      const { sale, other } = await loadFixture(deploy);
      await expect(sale.connect(other).setPrice(PRICE * 2n)).to.be.revertedWithCustomError(
        sale,
        "OwnableUnauthorizedAccount"
      );
    });

    it("blocks non-owners from addSupply", async function () {
      const { sale, other } = await loadFixture(deploy);
      await expect(sale.connect(other).addSupply(ONE)).to.be.revertedWithCustomError(
        sale,
        "OwnableUnauthorizedAccount"
      );
    });

    it("blocks non-owners from withdrawProceeds", async function () {
      const { sale, other } = await loadFixture(deploy);
      await expect(sale.connect(other).withdrawProceeds()).to.be.revertedWithCustomError(
        sale,
        "OwnableUnauthorizedAccount"
      );
    });

    it("blocks non-owners from recoverUnsoldTokens", async function () {
      const { sale, other } = await loadFixture(deploy);
      await expect(sale.connect(other).recoverUnsoldTokens(ONE)).to.be.revertedWithCustomError(
        sale,
        "OwnableUnauthorizedAccount"
      );
    });

    it("withdraws payment-token proceeds to the owner", async function () {
      const { sale, usdc, owner, buyer } = await loadFixture(deploy);
      const amount = 100n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost);
      await sale.connect(buyer).buy(amount, cost);

      const before = await usdc.balanceOf(owner.address);
      await expect(sale.withdrawProceeds())
        .to.emit(sale, "ProceedsWithdrawn")
        .withArgs(owner.address, cost);

      expect(await usdc.balanceOf(owner.address)).to.equal(before + cost);
      expect(await usdc.balanceOf(await sale.getAddress())).to.equal(0n);
    });

    it("reverts withdrawing an empty balance", async function () {
      const { sale } = await loadFixture(deploy);
      await expect(sale.withdrawProceeds()).to.be.revertedWithCustomError(
        sale,
        "NothingToWithdraw"
      );
    });

    it("recovers unsold tokens to the owner", async function () {
      const { sale, token, owner } = await loadFixture(deploy);
      const before = await token.balanceOf(owner.address);
      await expect(sale.recoverUnsoldTokens(SEED))
        .to.emit(sale, "UnsoldTokensRecovered")
        .withArgs(owner.address, SEED);
      expect(await token.balanceOf(owner.address)).to.equal(before + SEED);
      expect(await sale.availableSupply()).to.equal(0n);
    });

    it("cannot recover more than it holds", async function () {
      const { sale } = await loadFixture(deploy);
      await expect(sale.recoverUnsoldTokens(SEED + 1n))
        .to.be.revertedWithCustomError(sale, "InsufficientSupply")
        .withArgs(SEED + 1n, SEED);
    });

    // The single most important ownership property of this contract.
    it("cannot touch tokens already delivered to a buyer", async function () {
      const { sale, token, usdc, buyer } = await loadFixture(deploy);
      const amount = 100n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost);
      await sale.connect(buyer).buy(amount, cost);

      expect(await sale.availableSupply()).to.equal(SEED - amount);
      await expect(sale.recoverUnsoldTokens(SEED)).to.be.revertedWithCustomError(
        sale,
        "InsufficientSupply"
      );
      expect(await token.balanceOf(buyer.address)).to.equal(amount);
    });

    // The owner must not be able to reach a buyer's payment tokens either.
    it("cannot reach a buyer's payment-token balance", async function () {
      const { sale, usdc, buyer } = await loadFixture(deploy);
      const amount = 10n * ONE;
      const cost = await sale.costFor(amount);
      await usdc.connect(buyer).approve(await sale.getAddress(), cost);
      await sale.connect(buyer).buy(amount, cost);

      // Only the collected proceeds are withdrawable, never the buyer's remainder.
      await sale.withdrawProceeds();
      expect(await usdc.balanceOf(buyer.address)).to.equal(FUNDING - cost);
    });

    it("adds supply and emits the change", async function () {
      const { sale, token, owner } = await loadFixture(deploy);
      const extra = 500n * ONE;
      await token.approve(await sale.getAddress(), extra);
      await expect(sale.addSupply(extra))
        .to.emit(sale, "SupplyAdded")
        .withArgs(owner.address, extra);
      expect(await sale.availableSupply()).to.equal(SEED + extra);
    });

    it("rejects a zero addSupply", async function () {
      const { sale } = await loadFixture(deploy);
      await expect(sale.addSupply(0)).to.be.revertedWithCustomError(sale, "ZeroAmount");
    });
  });
});
