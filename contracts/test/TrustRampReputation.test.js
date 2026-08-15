const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Concept enum indices — these are part of the contract ABI. If a test here
// starts failing on ordering, the enum was reordered, which is a breaking
// change to anything already deployed. Append only.
const SLIPPAGE = 0;
const APPROVALS = 1;
const CUSTODY = 2;
const REDEMPTION = 3;
const PASS_THRESHOLD = 70;

describe("TrustRampReputation", function () {
  async function deploy() {
    const [owner, student, other, stranger] = await ethers.getSigners();
    const F = await ethers.getContractFactory("TrustRampReputation");
    const rep = await F.deploy();
    await rep.waitForDeployment();
    return { rep, owner, student, other, stranger };
  }

  describe("deployment", function () {
    it("sets name, symbol and owner", async function () {
      const { rep, owner } = await loadFixture(deploy);
      expect(await rep.name()).to.equal("TrustRamp Onchain Score");
      expect(await rep.symbol()).to.equal("TRS");
      expect(await rep.owner()).to.equal(owner.address);
    });

    it("exposes the constants integrators depend on", async function () {
      const { rep } = await loadFixture(deploy);
      expect(await rep.CONCEPT_COUNT()).to.equal(4n);
      expect(await rep.PASS_THRESHOLD()).to.equal(BigInt(PASS_THRESHOLD));
    });
  });

  describe("token ids", function () {
    // Regression test for a real audit finding: ids used to start at 0, which
    // collided with the default value of userTokenId for addresses that never
    // graduated. Any integrator reading userTokenId directly got a false hit.
    it("starts at 1, never 0", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      expect(await rep.userTokenId(student.address)).to.equal(1n);
    });

    it("increments for each new student", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      await rep.recordGraduation(other.address, [80, 80, 80, 80]);
      expect(await rep.userTokenId(other.address)).to.equal(2n);
    });

    it("leaves userTokenId at 0 for a non-graduate, distinguishable via hasGraduated", async function () {
      const { rep, stranger } = await loadFixture(deploy);
      expect(await rep.userTokenId(stranger.address)).to.equal(0n);
      expect(await rep.hasGraduated(stranger.address)).to.equal(false);
    });
  });

  describe("recording graduations", function () {
    it("mints once and records all four concepts", async function () {
      const { rep, student } = await loadFixture(deploy);
      await expect(rep.recordGraduation(student.address, [80, 60, 90, 75]))
        .to.emit(rep, "ReputationMinted")
        .withArgs(student.address, 1n, 76); // (80+60+90+75)/4 = 76

      expect(await rep.balanceOf(student.address)).to.equal(1n);
      expect(await rep.ownerOf(1)).to.equal(student.address);

      const scores = await rep.getConceptScores(student.address);
      expect(scores.map(Number)).to.deep.equal([80, 60, 90, 75]);
    });

    it("updates in place on re-attestation without minting a second token", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 60, 90, 75]);
      await expect(rep.recordGraduation(student.address, [95, 95, 95, 95]))
        .to.emit(rep, "ReputationUpdated")
        .withArgs(student.address, 1n, 95);

      expect(await rep.balanceOf(student.address)).to.equal(1n);
      const [, , count] = [null, ...(await rep.getAttestationMeta(student.address))];
      expect(count).to.equal(2n);
      expect((await rep.getConceptScores(student.address)).map(Number)).to.deep.equal([95, 95, 95, 95]);
    });

    it("rejects a score above 100", async function () {
      const { rep, student } = await loadFixture(deploy);
      await expect(rep.recordGraduation(student.address, [101, 0, 0, 0]))
        .to.be.revertedWithCustomError(rep, "ScoreOutOfRange")
        .withArgs(101);
    });

    it("accepts the boundary values 0 and 100", async function () {
      const { rep, student } = await loadFixture(deploy);
      await expect(rep.recordGraduation(student.address, [0, 100, 0, 100])).to.not.be.reverted;
      expect((await rep.getConceptScores(student.address)).map(Number)).to.deep.equal([0, 100, 0, 100]);
    });

    it("is onlyOwner", async function () {
      const { rep, student, stranger } = await loadFixture(deploy);
      await expect(
        rep.connect(stranger).recordGraduation(student.address, [50, 50, 50, 50])
      ).to.be.revertedWithCustomError(rep, "OwnableUnauthorizedAccount");
    });

    it("records a timestamp", async function () {
      const { rep, student } = await loadFixture(deploy);
      const tx = await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const [ts] = await rep.getAttestationMeta(student.address);
      expect(ts).to.equal(BigInt(block.timestamp));
    });
  });

  describe("derived score and RWA flag", function () {
    it("derives the overall score as the mean of the four concepts", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 60, 90, 75]);
      const [overall, , graduated] = await rep.getScore(student.address);
      expect(overall).to.equal(76n);
      expect(graduated).to.equal(true);
    });

    // The point of deriving rather than storing: a strong average must not be
    // able to carry a failing redemption or custody score into an RWA claim.
    it("withholds the RWA flag when redemption fails, even with a high average", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [100, 100, 100, 40]);
      const [overall, verifiedRWA] = await rep.getScore(student.address);
      expect(overall).to.equal(85n);
      expect(verifiedRWA).to.equal(false);
    });

    it("withholds the RWA flag when custody fails", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [100, 100, 40, 100]);
      expect((await rep.getScore(student.address))[1]).to.equal(false);
    });

    it("grants the RWA flag only when custody AND redemption both clear the threshold", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [0, 0, PASS_THRESHOLD, PASS_THRESHOLD]);
      expect((await rep.getScore(student.address))[1]).to.equal(true);
    });

    it("treats the threshold as inclusive at 70 and exclusive at 69", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [0, 0, 70, 70]);
      expect((await rep.getScore(student.address))[1]).to.equal(true);
      await rep.recordGraduation(other.address, [0, 0, 69, 70]);
      expect((await rep.getScore(other.address))[1]).to.equal(false);
    });

    it("distinguishes a non-graduate from a genuine zero score", async function () {
      const { rep, student, stranger } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [0, 0, 0, 0]);

      const [sOverall, sRwa, sGrad] = await rep.getScore(student.address);
      expect([sOverall, sRwa, sGrad]).to.deep.equal([0n, false, true]);

      const [nOverall, nRwa, nGrad] = await rep.getScore(stranger.address);
      expect([nOverall, nRwa, nGrad]).to.deep.equal([0n, false, false]);
    });
  });

  describe("integrator read surface", function () {
    it("understands() reports per-concept pass/fail", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [90, 20, 90, 90]);
      expect(await rep.understands(student.address, SLIPPAGE)).to.equal(true);
      expect(await rep.understands(student.address, APPROVALS)).to.equal(false);
      expect(await rep.understands(student.address, CUSTODY)).to.equal(true);
      expect(await rep.understands(student.address, REDEMPTION)).to.equal(true);
    });

    it("understands() returns false rather than reverting for a non-graduate", async function () {
      const { rep, stranger } = await loadFixture(deploy);
      expect(await rep.understands(stranger.address, SLIPPAGE)).to.equal(false);
    });

    it("getConceptScore returns the right value per index", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [11, 22, 33, 44]);
      expect(await rep.getConceptScore(student.address, SLIPPAGE)).to.equal(11n);
      expect(await rep.getConceptScore(student.address, APPROVALS)).to.equal(22n);
      expect(await rep.getConceptScore(student.address, CUSTODY)).to.equal(33n);
      expect(await rep.getConceptScore(student.address, REDEMPTION)).to.equal(44n);
    });

    // Reverting rather than returning 0 stops an integrator silently reading
    // "never took the course" as "took it and failed".
    it("getConceptScore and getConceptScores revert for a non-graduate", async function () {
      const { rep, stranger } = await loadFixture(deploy);
      await expect(rep.getConceptScore(stranger.address, SLIPPAGE))
        .to.be.revertedWithCustomError(rep, "NotGraduated")
        .withArgs(stranger.address);
      await expect(rep.getConceptScores(stranger.address)).to.be.revertedWithCustomError(rep, "NotGraduated");
    });
  });

  describe("soulbound enforcement", function () {
    it("blocks transferFrom", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      await expect(
        rep.connect(student).transferFrom(student.address, other.address, 1)
      ).to.be.revertedWithCustomError(rep, "NonTransferable");
    });

    it("blocks safeTransferFrom", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      await expect(
        rep.connect(student)["safeTransferFrom(address,address,uint256)"](student.address, other.address, 1)
      ).to.be.revertedWithCustomError(rep, "NonTransferable");
    });

    it("blocks transfer even after an approval is granted", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      await rep.connect(student).approve(other.address, 1);
      await expect(
        rep.connect(other).transferFrom(student.address, other.address, 1)
      ).to.be.revertedWithCustomError(rep, "NonTransferable");
    });

    it("blocks transfer via setApprovalForAll", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 80, 80, 80]);
      await rep.connect(student).setApprovalForAll(other.address, true);
      await expect(
        rep.connect(other).transferFrom(student.address, other.address, 1)
      ).to.be.revertedWithCustomError(rep, "NonTransferable");
    });

    it("still allows minting (from == address(0))", async function () {
      const { rep, student } = await loadFixture(deploy);
      await expect(rep.recordGraduation(student.address, [80, 80, 80, 80])).to.not.be.reverted;
      expect(await rep.ownerOf(1)).to.equal(student.address);
    });
  });

  describe("tokenURI", function () {
    it("returns a base64 data URI with no off-chain dependency", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 60, 90, 75]);
      const uri = await rep.tokenURI(1);

      expect(uri).to.match(/^data:application\/json;base64,/);
      // The whole point of on-chain metadata: no IPFS, no server, no link rot.
      expect(uri).to.not.include("ipfs");
      expect(uri).to.not.include("http");

      const meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
      expect(meta.name).to.equal("TrustRamp Score #1");
      expect(meta.image).to.match(/^data:image\/svg\+xml;base64,/);

      const svg = Buffer.from(meta.image.split(",")[1], "base64").toString();
      expect(svg.startsWith("<svg")).to.equal(true);
      expect(svg.endsWith("</svg>")).to.equal(true);
      expect(svg).to.include("APPROVALS");
      expect(svg).to.not.include("LIQUIDATION");
    });

    it("exposes every concept as a named attribute", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [80, 60, 90, 75]);
      const meta = JSON.parse(
        Buffer.from((await rep.tokenURI(1)).split(",")[1], "base64").toString()
      );
      const byName = Object.fromEntries(meta.attributes.map((a) => [a.trait_type, a.value]));

      expect(byName["Overall Score"]).to.equal(76);
      expect(byName["Slippage"]).to.equal(80);
      expect(byName["Approval Risk"]).to.equal(60);
      expect(byName["Custody Risk"]).to.equal(90);
      expect(byName["Redemption Terms"]).to.equal(75);
      expect(byName["RWA Verified"]).to.equal("Yes");
      expect(byName["Attestations"]).to.equal(1);
    });

    it("reports RWA Verified as No when the underlying concepts fail", async function () {
      const { rep, student } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [100, 100, 100, 40]);
      const meta = JSON.parse(
        Buffer.from((await rep.tokenURI(1)).split(",")[1], "base64").toString()
      );
      const byName = Object.fromEntries(meta.attributes.map((a) => [a.trait_type, a.value]));
      expect(byName["RWA Verified"]).to.equal("No");
    });

    it("produces valid JSON and SVG at both extremes", async function () {
      const { rep, student, other } = await loadFixture(deploy);
      await rep.recordGraduation(student.address, [0, 0, 0, 0]);
      await rep.recordGraduation(other.address, [100, 100, 100, 100]);
      for (const id of [1, 2]) {
        const meta = JSON.parse(
          Buffer.from((await rep.tokenURI(id)).split(",")[1], "base64").toString()
        );
        const svg = Buffer.from(meta.image.split(",")[1], "base64").toString();
        expect(svg.endsWith("</svg>")).to.equal(true);
      }
    });

    it("reverts for a nonexistent token", async function () {
      const { rep } = await loadFixture(deploy);
      await expect(rep.tokenURI(999)).to.be.revertedWithCustomError(rep, "ERC721NonexistentToken");
    });
  });

  describe("ERC721 conformance", function () {
    it("advertises the ERC165 and ERC721 interfaces", async function () {
      const { rep } = await loadFixture(deploy);
      expect(await rep.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC165
      expect(await rep.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
      expect(await rep.supportsInterface("0x5b5e139f")).to.equal(true); // ERC721Metadata
    });
  });
});
