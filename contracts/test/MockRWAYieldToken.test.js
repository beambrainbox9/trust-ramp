const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE = 10n ** 18n;
const CLAIM = 100n * ONE;
const PER_ADDRESS_CAP = 500n * ONE;
const GLOBAL_CAP = 1_000_000n * ONE;
const ONE_DAY = 24 * 60 * 60;

describe("MockRWAYieldToken", function () {
  async function deployTestnet() {
    const [owner, user, other] = await ethers.getSigners();
    const F = await ethers.getContractFactory("MockRWAYieldToken");
    const token = await F.deploy(true); // faucet ENABLED — testnet config
    await token.waitForDeployment();
    return { token, owner, user, other };
  }

  async function deployMainnet() {
    const [owner, user] = await ethers.getSigners();
    const F = await ethers.getContractFactory("MockRWAYieldToken");
    const token = await F.deploy(false); // faucet DISABLED — mainnet config
    await token.waitForDeployment();
    return { token, owner, user };
  }

  describe("deployment", function () {
    // The name and symbol are a disclosure mechanism: anyone inspecting this on
    // a block explorer must be able to see it's a demo without reading our docs.
    it("labels itself as a demo asset on-chain", async function () {
      const { token } = await loadFixture(deployTestnet);
      expect(await token.name()).to.equal("DEMO xT-BILL (TrustRamp)");
      expect(await token.symbol()).to.equal("DEMO-xTBILL");
    });

    it("mints the initial supply to the deployer", async function () {
      const { token, owner } = await loadFixture(deployTestnet);
      expect(await token.balanceOf(owner.address)).to.equal(GLOBAL_CAP);
      expect(await token.totalSupply()).to.equal(GLOBAL_CAP);
    });

    it("records the faucet flag from the constructor", async function () {
      const { token: testnet } = await loadFixture(deployTestnet);
      const { token: mainnet } = await loadFixture(deployMainnet);
      expect(await testnet.faucetEnabled()).to.equal(true);
      expect(await mainnet.faucetEnabled()).to.equal(false);
    });
  });

  describe("mainnet configuration (faucet off)", function () {
    // Regression test for the highest-severity contract finding in the Day 2
    // audit: the previous version would have shipped an unlimited free-mint
    // function on mainnet, on the token users are asked to pay real money for.
    it("reverts every faucet claim", async function () {
      const { token, user } = await loadFixture(deployMainnet);
      await expect(token.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        token,
        "FaucetDisabled"
      );
    });

    it("exposes no way to turn the faucet on after deployment", async function () {
      const { token } = await loadFixture(deployMainnet);
      const names = token.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name.toLowerCase());
      for (const n of names) {
        expect(n).to.not.match(/setfaucet|enablefaucet|togglefaucet|disablefaucet/);
      }
    });
  });

  describe("testnet faucet", function () {
    it("mints the claim amount on first use", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      await expect(token.connect(user).claimFaucet())
        .to.emit(token, "FaucetClaimed")
        .withArgs(user.address, CLAIM);
      expect(await token.balanceOf(user.address)).to.equal(CLAIM);
    });

    it("enforces the cooldown between claims", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      await token.connect(user).claimFaucet();
      await expect(token.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        token,
        "FaucetCooldownActive"
      );
    });

    it("allows a second claim once the cooldown has elapsed", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      await token.connect(user).claimFaucet();
      await time.increase(ONE_DAY);
      await expect(token.connect(user).claimFaucet()).to.not.be.reverted;
      expect(await token.balanceOf(user.address)).to.equal(CLAIM * 2n);
    });

    it("still reverts one second before the cooldown expires", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      await token.connect(user).claimFaucet();
      await time.increase(ONE_DAY - 2);
      await expect(token.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        token,
        "FaucetCooldownActive"
      );
    });

    it("caps total claims per address at 500 tokens", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      for (let i = 0; i < 5; i++) {
        await token.connect(user).claimFaucet();
        await time.increase(ONE_DAY);
      }
      expect(await token.balanceOf(user.address)).to.equal(PER_ADDRESS_CAP);
      expect(await token.faucetRemainingFor(user.address)).to.equal(0n);
      await expect(token.connect(user).claimFaucet()).to.be.revertedWithCustomError(
        token,
        "FaucetAddressLimitReached"
      );
    });

    it("reports the remaining per-address allowance accurately", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      expect(await token.faucetRemainingFor(user.address)).to.equal(PER_ADDRESS_CAP);
      await token.connect(user).claimFaucet();
      expect(await token.faucetRemainingFor(user.address)).to.equal(PER_ADDRESS_CAP - CLAIM);
    });

    it("tracks global issuance separately from per-address totals", async function () {
      const { token, user, other } = await loadFixture(deployTestnet);
      await token.connect(user).claimFaucet();
      await token.connect(other).claimFaucet();
      expect(await token.totalFaucetIssued()).to.equal(CLAIM * 2n);
      expect(await token.totalFaucetClaimed(user.address)).to.equal(CLAIM);
    });

    it("increases total supply — the faucet mints, it does not transfer", async function () {
      const { token, user } = await loadFixture(deployTestnet);
      const before = await token.totalSupply();
      await token.connect(user).claimFaucet();
      expect(await token.totalSupply()).to.equal(before + CLAIM);
    });
  });

  describe("ERC20 behaviour", function () {
    it("uses 18 decimals", async function () {
      const { token } = await loadFixture(deployTestnet);
      expect(await token.decimals()).to.equal(18n);
    });

    it("transfers normally — this token is NOT soulbound", async function () {
      const { token, user, other } = await loadFixture(deployTestnet);
      await token.connect(user).claimFaucet();
      await token.connect(user).transfer(other.address, CLAIM);
      expect(await token.balanceOf(other.address)).to.equal(CLAIM);
    });
  });
});
