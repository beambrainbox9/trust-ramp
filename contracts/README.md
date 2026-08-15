# Contracts — status

Both contracts are **compiled and executed**, not just eyeballed.

- `solc 0.8.20+commit.a1b79de6` + `@openzeppelin/contracts@5.0.2`, optimizer on
- **0 errors, 0 warnings**
- `TrustRampReputation` 10,778 bytes deployed / `MockRWAYieldToken` 3,011 bytes — both well under
  the 24,576-byte EIP-170 limit
- **14/14 behavioural tests pass** on a local EVM (deploy, mint, per-concept scoring, soulbound
  transfer blocking, access control, tokenURI rendering, faucet gating and cooldown)

## Chain compatibility — corrected reasoning

An earlier note here pinned OpenZeppelin to 5.0.2 to avoid the `mcopy` opcode, on the grounds
that Cancun support on X Layer was unconfirmed. That conclusion was right. The reasoning was
incomplete, and the correction matters more than the conclusion:

**`mcopy` was never the nearest hazard — `PUSH0` was, and it was never checked.** Disassembling
the compiled output shows 0 `MCOPY` but **160 `PUSH0`** instructions across the two contracts.
`PUSH0` is a *Shanghai* opcode, an earlier and historically more troublesome hurdle on L2s than
Cancun. The original analysis stopped one hardfork short of the risk it was actually running.

It does not bite, and here is why, with a source: **X Layer migrated from Polygon zkEVM to the
OP Stack on 2025-10-27**, moving from Erigon-based nodes to `op-geth`, which is near-EVM-equivalent
(OKX's own writeup: `web3.okx.com/learn/x-layer-architecture-migration-from-polygon-zkevm-to-op-stack`).
On `op-geth`, both `PUSH0` and `MCOPY` are supported.

**Keep the 5.0.2 pin through Aug 21 anyway.** Changing a working dependency 13 days from a
deadline is a bad trade. Just don't trust the old justification — the next person to read it
would inherit the same blind spot.

## Deployment parameters — read before deploying

`MockRWAYieldToken` takes a constructor argument:

```
new MockRWAYieldToken(true)   // X Layer TESTNET  — faucet enabled
new MockRWAYieldToken(false)  // X Layer MAINNET  — faucet permanently disabled
```

This is **immutable**. It cannot be toggled after deployment, deliberately: a switch that can be
flipped is a switch a compromised owner key can flip, and there is no legitimate reason to enable
a free-mint faucet on mainnet after launch. Deploy mainnet with `false` or you will publish an
unlimited free-mint function on the token users are asked to pay for.

`TrustRampReputation` takes no constructor arguments. The deployer becomes `owner` and is the only
address that can call `recordGraduation`. **Admin key custody is still an open decision** — env
var vs. a real secrets manager — and needs resolving before the testnet deploy, not after.

## Setting up Hardhat (still to do — Day 7-8)

There are currently **no Hardhat tests in this repo**. PROJECT_PLAN §8 commits to local Hardhat
testing before any testnet deployment; the 14 local-EVM tests above cover the behaviour but are
not a substitute for the committed test suite.

```bash
cd contracts
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npx hardhat init
# move the .sol files into contracts/
npx hardhat compile
```

## Still missing (tracked, Day 7-10)

- **No purchase function on `MockRWAYieldToken`** — no price, no payable path. PROJECT_PLAN §5
  item 6 has no on-chain counterpart yet, which is why the backend's prepared transaction still
  points at the zero address.
- **No example consumer contract** reading the reputation score (§5 item 7).
- **Neither contract is deployed anywhere.**
- **`_mint` vs `_safeMint`:** `TrustRampReputation` uses `_mint` deliberately. `_safeMint` calls
  back into the recipient, and every recipient here is an ERC-4337 smart account — that callback
  was a live dependency on whatever account implementation Privy provisions. Since this token can
  never be transferred by anyone, the check guarded against nothing while adding a real revert
  path. Documented as a tradeoff, not an oversight.
