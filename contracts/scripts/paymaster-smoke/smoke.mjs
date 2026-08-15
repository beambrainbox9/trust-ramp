/**
 * PAYMASTER SMOKE TEST — standalone, throwaway, no app code involved.
 *
 * QUESTION IT ANSWERS
 * Does the Alchemy Gas Manager policy actually sponsor a UserOperation on X Layer
 * testnet (1952)? The policy had never sponsored a live transaction, so the
 * practice purchase flow would otherwise be its first test — and a paymaster
 * failure there would be indistinguishable from a purchase-logic failure.
 *
 * POLICY HISTORY — the reason this script exists:
 * The first policy (abbefa29-b23e-42cb-87ec-9fd33dfc2557) was created as a
 * "Bundler Sponsored Operations" policy, which sponsors bundler/RPC usage and
 * NOT gas for UserOperations. Both pm_getPaymasterData (ERC-7677, the method
 * Privy uses) and alchemy_requestGasAndPaymasterAndData rejected it identically
 * with {"code":-32602,"message":"Unsupported Policy Type: BUNDLER_SPONSORSHIP"}.
 * Replaced Aug 11 with an "Onchain Paymaster Policy". Policy TYPE is fixed at
 * creation — if this fails that way again, make a new policy, don't edit one.
 *
 * IMPORTANT LIMITATION — READ BEFORE TRUSTING A PASS
 * This CANNOT use Mo's real smart account (0xab718F24...f663). That account is
 * owned by a passkey held by Privy in the browser; signing a UserOperation as it
 * requires that passkey, which no Node script can reach. There is also no
 * smart-wallet config in the backend to reuse — all AA lives in the frontend.
 *
 * So this derives a DIFFERENT Light Account, owned by the burner deployer key in
 * contracts/.env, and sponsors a UserOperation for that one. It exercises the
 * same policy, paymaster, bundler, LightAccountFactory, EntryPoint and chain.
 * What it does NOT prove: that the policy admits Mo's specific account, if the
 * policy has a sender allowlist. Check the policy's allowlist rules if this
 * passes but the real flow later fails.
 *
 * WHAT IT DOES
 * Sends the smallest useful sponsored operation: the smart account calling
 * approve() on MockUSDC for 1 base unit. Same call type the real approval step
 * uses, and it needs no MockUSDC balance. The account is undeployed, so this
 * also exercises sponsored account DEPLOYMENT (initCode), which is the exact
 * path a first-time user hits.
 *
 * VERIFICATION — a 200 from the bundler is not success
 *   1. UserOperation receipt reports success
 *   2. The transaction hash exists on-chain via eth_getTransactionReceipt, status 1
 *   3. The smart account's native OKB balance is UNCHANGED (it was sponsored,
 *      not silently charged) — and it starts at 0, so any charge would fail anyway
 *   4. The allowance actually changed on-chain, proving the call executed rather
 *      than merely being included
 */

import "dotenv/config";
import { createPublicClient, http, encodeFunctionData, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { toLightSmartAccount } from "permissionless/accounts";
import { createPaymasterClient, entryPoint07Address } from "viem/account-abstraction";

// --- Configuration (all values already in use elsewhere in the project) ------
const CHAIN_ID = 1952;
const RPC_URL = "https://testrpc.xlayer.tech/terigon";
const ALCHEMY_URL =
  "https://xlayer-testnet.g.alchemy.com/v2/alch_zrl4-_tEzBePVEwk3I2HZ";
const GAS_POLICY_ID = "655835a1-eb5d-4045-b10e-24fabf56dd64"; // Onchain Paymaster Policy
const MOCK_USDC = "0xa9B8b8Aba1Fc34c790Ec9D7D452d65E4b0A3A9E5";
const SALE = "0x6466218A596e7FCB933ED5a02Fe5204dDa46435e";
const LIGHT_ACCOUNT_VERSION = "2.0.0";

const xLayerTestnet = {
  id: CHAIN_ID,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

/** Raw JSON-RPC call against the Alchemy bundler endpoint. */
async function bundlerRpc(method, params) {
  const res = await fetch(ALCHEMY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method} failed: ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

const line = (s = "") => console.log(s);
const step = (n, s) => console.log(`\n[${n}] ${s}`);

// Prints the FULL error, not a paraphrase — the whole point of requirement 5.
function dumpError(err) {
  line("\n--- RAW ERROR ---");
  line(`name:    ${err?.name}`);
  line(`message: ${err?.message}`);
  if (err?.shortMessage) line(`short:   ${err.shortMessage}`);
  if (err?.details) line(`details: ${err.details}`);
  if (err?.metaMessages) line(`meta:\n  ${err.metaMessages.join("\n  ")}`);
  if (err?.cause) {
    line(`cause.name:    ${err.cause?.name}`);
    line(`cause.message: ${err.cause?.message}`);
    if (err.cause?.details) line(`cause.details: ${err.cause.details}`);
  }
  line("--- FULL OBJECT ---");
  line(JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}), 2));
  line("--- END ---\n");
}

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY missing. This script reads contracts/.env — run it from " +
        "contracts/scripts/paymaster-smoke with that file present."
    );
  }

  const owner = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  const publicClient = createPublicClient({ chain: xLayerTestnet, transport: http(RPC_URL) });

  step(1, "Environment");
  line(`  chainId (from RPC): ${await publicClient.getChainId()}  (expect ${CHAIN_ID})`);
  line(`  owner EOA:          ${owner.address}`);
  line(`  policy:             ${GAS_POLICY_ID}`);

  step(2, "Deriving the Light Account");
  const account = await toLightSmartAccount({
    client: publicClient,
    owner,
    version: LIGHT_ACCOUNT_VERSION,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });
  const sender = account.address;
  const deployedBefore = await publicClient.getBytecode({ address: sender });
  line(`  smart account:      ${sender}`);
  line(`  deployed already:   ${deployedBefore && deployedBefore !== "0x" ? "yes" : "no (initCode will deploy it)"}`);

  // Requirement 4: capture native balance BEFORE. If this is non-zero and drops,
  // the operation was charged rather than sponsored.
  const balanceBefore = await publicClient.getBalance({ address: sender });
  const allowanceBefore = await publicClient.readContract({
    address: MOCK_USDC,
    abi: ERC20,
    functionName: "allowance",
    args: [sender, SALE],
  });
  line(`  OKB balance before: ${formatEther(balanceBefore)} OKB`);
  line(`  allowance before:   ${allowanceBefore}`);

  step(3, "Building sponsored client (Alchemy bundler + Gas Manager policy)");
  const paymasterClient = createPaymasterClient({ transport: http(ALCHEMY_URL) });
  const smartAccountClient = createSmartAccountClient({
    account,
    chain: xLayerTestnet,
    bundlerTransport: http(ALCHEMY_URL),
    paymaster: paymasterClient,
    // This is what attaches the Gas Manager policy to the sponsorship request.
    paymasterContext: { policyId: GAS_POLICY_ID },
    userOperation: {
      // Fees must come from the BUNDLER, not the chain. X Layer's
      // eth_maxPriorityFeePerGas returns 1 wei, and Alchemy's bundler rejects
      // that with "precheck failed: maxPriorityFeePerGas is 1 but must be at
      // least 100000". rundler_maxPriorityFeePerGas is Alchemy's own endpoint
      // and returns the value its bundler will actually accept.
      estimateFeesPerGas: async () => {
        const priorityHex = await bundlerRpc("rundler_maxPriorityFeePerGas", []);
        const maxPriorityFeePerGas = BigInt(priorityHex);
        const block = await publicClient.getBlock({ blockTag: "latest" });
        const baseFee = block.baseFeePerGas ?? 0n;
        // 2x base fee headroom so the op stays valid if the base fee rises
        // between pricing and inclusion.
        return {
          maxPriorityFeePerGas,
          maxFeePerGas: baseFee * 2n + maxPriorityFeePerGas,
        };
      },
    },
  });

  step(4, "Sending UserOperation: approve(SALE, 1) on MockUSDC");
  const callData = encodeFunctionData({
    abi: ERC20,
    functionName: "approve",
    args: [SALE, 1n],
  });

  // Explicit gas limits with headroom. The estimator returned
  // verificationGasLimit=185035, and the bundler rejected it with "Simulation ran
  // out of gas for entity: factory" — deploying the Light Account inside
  // validation costs more than the estimate allowed on this chain. Over-stating
  // limits is safe: unused gas is not charged, and the paymaster is paying.
  const userOpHash = await smartAccountClient.sendUserOperation({
    calls: [{ to: MOCK_USDC, data: callData, value: 0n }],
    // Narrow window, found empirically:
    //   185,035 -> "Simulation ran out of gas for entity: factory"
    //   1,500,000 -> "Verification gas limit efficiency too low. Required: 0.4,
    //                 Actual: 0.1067"  (=> actual usage ~160,000)
    // Alchemy requires used/limit >= 0.4, so the limit must be <= ~400,000 while
    // still clearing what deployment actually costs. 300,000 sits in the middle
    // (efficiency ~0.53). Everything else is left to the estimator.
    verificationGasLimit: 300_000n,
  });
  line(`  userOpHash: ${userOpHash}`);

  step(5, "Waiting for the UserOperation receipt");
  const receipt = await smartAccountClient.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: 180_000,
  });
  line(`  success:      ${receipt.success}`);
  line(`  txHash:       ${receipt.receipt.transactionHash}`);
  line(`  actualGasUsed:  ${receipt.actualGasUsed}`);
  line(`  actualGasCost:  ${receipt.actualGasCost} wei`);
  line(`  paymaster:      ${receipt.paymaster ?? "(none reported)"}`);

  step(6, "Independent on-chain verification");
  const txReceipt = await publicClient.getTransactionReceipt({
    hash: receipt.receipt.transactionHash,
  });
  line(`  eth_getTransactionReceipt status: ${txReceipt.status}`);
  line(`  block:                            ${txReceipt.blockNumber}`);

  const balanceAfter = await publicClient.getBalance({ address: sender });
  const allowanceAfter = await publicClient.readContract({
    address: MOCK_USDC,
    abi: ERC20,
    functionName: "allowance",
    args: [sender, SALE],
  });
  const deployedAfter = await publicClient.getBytecode({ address: sender });

  line(`  OKB balance after:  ${formatEther(balanceAfter)} OKB`);
  line(`  balance delta:      ${balanceAfter - balanceBefore} wei`);
  line(`  allowance after:    ${allowanceAfter}`);
  line(`  account deployed:   ${deployedAfter && deployedAfter !== "0x" ? "yes" : "no"}`);

  step(7, "Verdict");
  const checks = [
    ["UserOperation reported success", receipt.success === true],
    ["Transaction landed on-chain (status success)", txReceipt.status === "success"],
    ["Smart account OKB balance did NOT decrease", balanceAfter >= balanceBefore],
    ["Gas was actually charged to someone (non-zero cost)", receipt.actualGasCost > 0n],
    ["Allowance changed — the call really executed", allowanceAfter !== allowanceBefore],
    ["Smart account is now deployed", Boolean(deployedAfter && deployedAfter !== "0x")],
  ];
  let allOk = true;
  for (const [label, ok] of checks) {
    line(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) allOk = false;
  }

  line();
  if (allOk) {
    line("  RESULT: SPONSORED. The Gas Manager policy paid for this UserOperation.");
    line(`  Explorer: https://www.okx.com/web3/explorer/xlayer-test/tx/${receipt.receipt.transactionHash}`);
  } else {
    line("  RESULT: NOT PROVEN — see the FAIL lines above.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  line("\n==============================");
  line("  PAYMASTER SMOKE TEST FAILED");
  line("==============================");
  dumpError(err);
  process.exitCode = 1;
});
