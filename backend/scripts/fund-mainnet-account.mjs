// Standalone operational script — NOT part of the app's request path, not
// imported by server.js or anything else. Run manually (e.g. from Render's
// Shell tab) to send DEMO-USDC (MockUSDC, mainnet, chain 196) from the
// deployer wallet to a target address.
//
// Usage:
//   node backend/scripts/fund-mainnet-account.mjs <targetAddress> <amountUSDC>
//
// Example:
//   node backend/scripts/fund-mainnet-account.mjs 0x9aa1201b2b04E518f4bf7a82B911BF79203e9a64 10
//
// Env required:
//   MAINNET_FUNDING_KEY    — deployer key that holds the MockUSDC mainnet supply.
//   XLAYER_MAINNET_RPC     — optional, defaults to https://rpc.xlayer.tech.
//                            Deliberately a plain JSON-RPC endpoint, not
//                            ALCHEMY_BUNDLER_URL_MAINNET: this sends a normal
//                            EOA transaction (eth_sendRawTransaction), not an
//                            ERC-4337 UserOperation, so a bundler endpoint is
//                            the wrong tool here.
//
// amountUSDC is WHOLE DEMO-USDC (e.g. "10" = 10.000000), converted to base
// units at 6 decimals to match MockUSDC.sol's constructor.

import { createPublicClient, createWalletClient, http, parseAbi, isAddress, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAINNET_CHAIN_ID = 196;
const USDC_ADDRESS = "0x096970D0c7Aa0Ac70Afe6e8c2373a07bF03cB12D";
const USDC_DECIMALS = 6;

const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

function fail(msg) {
  console.error(`[fund-mainnet-account] ${msg}`);
  process.exit(1);
}

async function main() {
  const [, , targetArg, amountArg] = process.argv;
  if (!targetArg || !amountArg) {
    fail("Usage: node backend/scripts/fund-mainnet-account.mjs <targetAddress> <amountUSDC>");
  }
  if (!isAddress(targetArg)) {
    fail(`"${targetArg}" is not a valid address.`);
  }
  let amountBaseUnits;
  try {
    amountBaseUnits = parseUnits(amountArg, USDC_DECIMALS);
  } catch {
    fail(`"${amountArg}" is not a valid USDC amount.`);
  }
  if (amountBaseUnits <= 0n) {
    fail("Amount must be greater than zero.");
  }

  const deployerKey = process.env.MAINNET_FUNDING_KEY;
  if (!deployerKey) fail("MAINNET_FUNDING_KEY is not set.");
  const pk = deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`;

  const rpcUrl = process.env.XLAYER_MAINNET_RPC || "https://rpc.xlayer.tech";

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });

  // Refuse on the wrong chain — same posture as contracts/scripts/deploy.js.
  const chainId = await publicClient.getChainId();
  if (chainId !== MAINNET_CHAIN_ID) {
    fail(`RPC at ${rpcUrl} reports chain ${chainId}, expected X Layer mainnet (${MAINNET_CHAIN_ID}).`);
  }

  console.log(`Deployer:  ${account.address}`);
  console.log(`Target:    ${targetArg}`);
  console.log(`Amount:    ${amountArg} DEMO-USDC (${amountBaseUnits} base units)`);
  console.log(`RPC:       ${rpcUrl} (chain ${chainId})`);

  const deployerBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`Deployer DEMO-USDC balance: ${formatUnits(deployerBalance, USDC_DECIMALS)}`);
  if (deployerBalance < amountBaseUnits) {
    fail(
      `Deployer only holds ${formatUnits(deployerBalance, USDC_DECIMALS)} DEMO-USDC, ` +
        `cannot send ${amountArg}.`
    );
  }

  try {
    const hash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [targetArg, amountBaseUnits],
      chain: null, // account carries chain identity for viem's wallet client
    });
    console.log(`Tx sent: ${hash}`);
    console.log("Waiting for confirmation…");

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") {
      fail(`Transaction reverted on-chain (${hash}).`);
    }
    console.log(`Confirmed in block ${receipt.blockNumber} (status: ${receipt.status}).`);
    process.exit(0);
  } catch (err) {
    fail(`Transfer failed: ${err?.message || err}`);
  }
}

main();
