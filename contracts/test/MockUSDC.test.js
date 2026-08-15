const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = 10n ** 6n; // 6 decimals, mirroring real USDC
const CLAIM = 1_000n * USDC;
const PER_ADDRESS_CAP = 5_000n * USDC;
const GLOBAL_CAP = 10_000_000n * USDC;
const INITIAL_SUPPLY = 1_000_000n * USDC;
const ONE_DAY = 24 * 60 * 60;

describe("MockUSDC", function () {
  async function deployTestnet() {
    const [owner, user, other] = await ethers.getSigners();
    const F = await ethers.getContractFactory("MockUSDC");
    const usdc = await F.deploy(true); // faucet ENABLED — testnet config
    await usdc.waitForDeployment();
    return { usdc, owner, user, other };
  }

  async function deployMainnet() {
    const [owner, user] = await ethers.getSigners();
    const F = await ethers.getContractFactory("MockUSDC");
    const usdc = await F.deploy(false); // faucet DISABLED — mainnet config
    await usdc.waitForDeployment();
    return { usdc, owner, user };
  }

  describe("deployment", function () {
    // Anyone inspecting this on an explorer must see it is a demo without
    // needing our docs — the same disclosure rule as MockRWAYieldToken.
    it("labels itself as a demo asset on-chain", async function () {
      const { usdc } = await loadFixture(deployTestnet);
      expect(await usdc.name()).to.equal("DEMO USD Coin (TrustRamp)");
      expect(await usdc.symbol()).to.equal("DEMO-USDC");
    });

    // 6, not 18. The sale contract reconciles this against the asset's 18, and
    // that difference is where real stablecoin integrations get it wrong.
    it("uses 6 decimals, matching real USDC", async function () {
      const { usdc } = await loadFixture(deployTestnet);
      expect(await usdc.decimals()).to.equal(6);
    });

    it("mints the initial supply to the deployer", async function () {
      const { usdc, owner } = await loadFixture(deployTestnet);
      expect(await usdc.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
      expect(await usdc.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("records the faucet flag from the constructor", async function () {
      const { usdc: testnet } = await loadFixture(deployTestnet);
      const { usdc: mainnet } = await loadFixture(deployMainnet);
      expect(await testnet.faucetEnabled()).to.equal(true);
      expect(await mainnet.faucetEnabled()).to.equal(false);
    });

    it("exposes the constants integrators depend on", async function () {
      const { usdc } = await loadFixture(deployTestnet);
      expect(await usdc.FAUCET_CLAIM_AMOUNT()).to.equal(CLAIM);
      expect(await usdc.FAUCET_COOLDOWN()).to.equal(ONE_DAY);
      expect(await usdc.FAUCET_MAX_TOTAL_PER_ADDRESS()).to.equal(PER_ADDRESS_CAP);
      expect(await usdc.FAUCET_MAX_TOTAL_SUPPLY()).to.equal(GLOBAL_CAP);
    });
  });

  describe("mainnet configuration (faucet off)", function () {
    // The highest-severity mistake available here: shipping a free-mint on the
    // token used to pay for things with real money.
    it("reverts every faucet claim", async function () {
      const { usdc, user } = await loadFixture(deployMainnet);
      await expect(usdc.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        usdc,
        "FaucetDisabled"
      );
    });

    it("reverts for the owner too — there is no privileged mint", async function () {
      const { usdc } = await loadFixture(deployMainnet);
      await expect(usdc.claimFaucet()).to.be.revertedWithCustomError(usdc, "FaucetDisabled");
    });

    // faucetEnabled is immutable; there must be no setter to find.
    it("exposes no way to turn the faucet on after deployment", async function () {
      const { usdc } = await loadFixture(deployMainnet);
      const names = usdc.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name.toLowerCase());
      const setters = names.filter(
        (n) => n !== "claimfaucet" && n.includes("faucet") && (n.startsWith("set") || n.startsWith("enable") || n.startsWith("toggle"))
      );
      expect(setters).to.deep.equal([]);
    });
  });

  describe("testnet faucet", function () {
    it("mints the claim amount on first use", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      await expect(usdc.connect(user).claimFaucet())
        .to.emit(usdc, "FaucetClaimed")
        .withArgs(user.address, CLAIM);
      expect(await usdc.balanceOf(user.address)).to.equal(CLAIM);
    });

    it("enforces the cooldown between claims", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      await usdc.connect(user).claimFaucet();
      await expect(usdc.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        usdc,
        "FaucetCooldownActive"
      );
    });

    it("allows a second claim once the cooldown has elapsed", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      await usdc.connect(user).claimFaucet();
      await time.increase(ONE_DAY);
      await usdc.connect(user).claimFaucet();
      expect(await usdc.balanceOf(user.address)).to.equal(CLAIM * 2n);
    });

    it("still reverts one second before the cooldown expires", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      await usdc.connect(user).claimFaucet();
      await time.increase(ONE_DAY - 2);
      await expect(usdc.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        usdc,
        "FaucetCooldownActive"
      );
    });

    it("caps total claims per address", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      for (let i = 0; i < 5; i++) {
        await usdc.connect(user).claimFaucet();
        await time.increase(ONE_DAY);
      }
      expect(await usdc.balanceOf(user.address)).to.equal(PER_ADDRESS_CAP);
      await expect(usdc.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        usdc,
        "FaucetAddressLimitReached"
      );
    });

    it("reports the remaining per-address allowance accurately", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      expect(await usdc.faucetRemainingFor(user.address)).to.equal(PER_ADDRESS_CAP);
      await usdc.connect(user).claimFaucet();
      expect(await usdc.faucetRemainingFor(user.address)).to.equal(PER_ADDRESS_CAP - CLAIM);
    });

    it("returns zero remaining once the address cap is reached", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      for (let i = 0; i < 5; i++) {
        await usdc.connect(user).claimFaucet();
        await time.increase(ONE_DAY);
      }
      expect(await usdc.faucetRemainingFor(user.address)).to.equal(0n);
    });

    // Per-address caps alone do not create scarcity when addresses are free.
    it("tracks global issuance separately from per-address totals", async function () {
      const { usdc, user, other } = await loadFixture(deployTestnet);
      await usdc.connect(user).claimFaucet();
      await usdc.connect(other).claimFaucet();
      expect(await usdc.totalFaucetIssued()).to.equal(CLAIM * 2n);
      expect(await usdc.totalFaucetClaimed(user.address)).to.equal(CLAIM);
      expect(await usdc.totalFaucetClaimed(other.address)).to.equal(CLAIM);
    });

    it("increases total supply — the faucet mints, it does not transfer", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      const before = await usdc.totalSupply();
      await usdc.connect(user).claimFaucet();
      expect(await usdc.totalSupply()).to.equal(before + CLAIM);
    });

    it("records the claim timestamp", async function () {
      const { usdc, user } = await loadFixture(deployTestnet);
      await usdc.connect(user).claimFaucet();
      expect(await usdc.lastFaucetClaim(user.address)).to.equal(await time.latest());
    });
  });

  describe("ERC20 behaviour", function () {
    it("transfers normally", async function () {
      const { usdc, owner, user } = await loadFixture(deployTestnet);
      await usdc.transfer(user.address, 500n * USDC);
      expect(await usdc.balanceOf(user.address)).to.equal(500n * USDC);
      expect(await usdc.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY - 500n * USDC);
    });

    // The whole reason this token is the payment asset: approve() must work.
    it("supports approve and transferFrom", async function () {
      const { usdc, owner, user, other } = await loadFixture(deployTestnet);
      await usdc.approve(other.address, 100n * USDC);
      expect(await usdc.allowance(owner.address, other.address)).to.equal(100n * USDC);
      await usdc.connect(other).transferFrom(owner.address, user.address, 100n * USDC);
      expect(await usdc.balanceOf(user.address)).to.equal(100n * USDC);
      expect(await usdc.allowance(owner.address, other.address)).to.equal(0n);
    });

    it("rejects transferFrom beyond the approved amount", async function () {
      const { usdc, owner, user, other } = await loadFixture(deployTestnet);
      await usdc.approve(other.address, 100n * USDC);
      await expect(
        usdc.connect(other).transferFrom(owner.address, user.address, 101n * USDC)
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });
  });
});
