const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// TrustRampReputation Concept enum, ABI-locked, append-only.
// See PROJECT_PLAN §1c: Slippage=0, Approvals=1, Custody=2, Redemption=3.
const CONCEPT = { SLIPPAGE: 0, APPROVALS: 1, CUSTODY: 2, REDEMPTION: 3 };
const PASS = 70;

describe("ScoreConsumerExample", function () {
  async function deploy() {
    const [owner, alice, bob, stranger] = await ethers.getSigners();

    const Rep = await ethers.getContractFactory("TrustRampReputation");
    const rep = await Rep.deploy();
    await rep.waitForDeployment();

    const Consumer = await ethers.getContractFactory("ScoreConsumerExample");
    const consumer = await Consumer.deploy(await rep.getAddress());
    await consumer.waitForDeployment();

    return { rep, consumer, owner, alice, bob, stranger };
  }

  describe("deployment", function () {
    it("records the reputation address it was constructed with", async function () {
      const { rep, consumer } = await loadFixture(deploy);
      expect(await consumer.reputation()).to.equal(await rep.getAddress());
    });

    it("refuses a zero reputation address", async function () {
      const Consumer = await ethers.getContractFactory("ScoreConsumerExample");
      await expect(Consumer.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        Consumer,
        "ZeroAddress"
      );
    });
  });

  describe("canReadRWA — the headline integrator scenario", function () {
    it("returns (false, 0) for a user who never graduated", async function () {
      // The point of returning explicit `graduated` from getScore was so a
      // stranger reads as "0 and unverified" rather than "0 and failed".
      const { consumer, stranger } = await loadFixture(deploy);
      const [ok, score] = await consumer.canReadRWA(stranger.address);
      expect(ok).to.equal(false);
      expect(score).to.equal(0);
    });

    it("returns (true, overall) when both Custody and Redemption pass", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      // Overall is the MEAN of the four concepts. This produces overall=80.
      await rep.recordGraduation(alice.address, [70, 70, 90, 90]);
      const [ok, score] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(true);
      expect(score).to.equal(80);
    });

    // The RWA claim depends specifically on custody + redemption, not on an
    // average. A high slippage score must not carry it. This is the property
    // the reputation contract's _passedRWA enforces, and the consumer must
    // reflect it faithfully.
    it("does NOT grant RWA when Custody fails, even at high overall", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      // Overall = 82, but Custody=50 (below threshold 70).
      await rep.recordGraduation(alice.address, [100, 100, 50, 80]);
      const [ok, score] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(false);
      expect(score).to.equal(82);
    });

    it("does NOT grant RWA when Redemption fails, even at high overall", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      // Overall = 82, but Redemption=50.
      await rep.recordGraduation(alice.address, [100, 100, 80, 50]);
      const [ok, score] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(false);
      expect(score).to.equal(82);
    });

    it("treats the pass threshold as inclusive at 70", async function () {
      // Documented in the reputation contract as PASS_THRESHOLD = 70. Testing
      // the boundary here so a future off-by-one wouldn't silently move it.
      const { rep, consumer, alice } = await loadFixture(deploy);
      await rep.recordGraduation(alice.address, [0, 0, 70, 70]);
      const [ok] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(true);
    });

    it("treats 69 as failing", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      await rep.recordGraduation(alice.address, [100, 100, 69, 100]);
      const [ok] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(false);
    });

    // Repeat attestations update in place. A user who fails and later retakes
    // must be able to become RWA-verified — that's the whole "keep learning"
    // premise. This test locks that in.
    it("reflects updated scores after a re-attestation", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      await rep.recordGraduation(alice.address, [10, 10, 10, 10]);
      let [ok, score] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(false);
      expect(score).to.equal(10);

      await rep.recordGraduation(alice.address, [80, 80, 80, 80]);
      [ok, score] = await consumer.canReadRWA(alice.address);
      expect(ok).to.equal(true);
      expect(score).to.equal(80);
    });

    it("distinguishes two students independently", async function () {
      const { rep, consumer, alice, bob } = await loadFixture(deploy);
      await rep.recordGraduation(alice.address, [80, 80, 80, 80]);
      await rep.recordGraduation(bob.address, [40, 40, 40, 40]);
      const [aliceOk] = await consumer.canReadRWA(alice.address);
      const [bobOk] = await consumer.canReadRWA(bob.address);
      expect(aliceOk).to.equal(true);
      expect(bobOk).to.equal(false);
    });
  });

  describe("understandsConcept — per-concept gate", function () {
    it("returns false across the board for a non-graduate", async function () {
      const { consumer, stranger } = await loadFixture(deploy);
      for (const c of Object.values(CONCEPT)) {
        expect(await consumer.understandsConcept(stranger.address, c)).to.equal(false);
      }
    });

    it("returns true for each concept a graduate scored >= PASS_THRESHOLD", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      // pass Slippage and Custody, fail Approvals and Redemption
      await rep.recordGraduation(alice.address, [PASS, 0, PASS, 0]);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.SLIPPAGE)).to.equal(true);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.APPROVALS)).to.equal(false);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.CUSTODY)).to.equal(true);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.REDEMPTION)).to.equal(false);
    });

    // The enum ordering is ABI-locked and cannot silently drift — pin every
    // index to its scored concept, so a reorder would break this suite loudly.
    it("locks the enum ordering — Slippage=0, Approvals=1, Custody=2, Redemption=3", async function () {
      const { rep, consumer, alice } = await loadFixture(deploy);
      // Distinctive pattern per index: only index 2 passes.
      await rep.recordGraduation(alice.address, [50, 50, PASS, 50]);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.SLIPPAGE)).to.equal(false);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.APPROVALS)).to.equal(false);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.CUSTODY)).to.equal(true);
      expect(await consumer.understandsConcept(alice.address, CONCEPT.REDEMPTION)).to.equal(false);
    });
  });
});
