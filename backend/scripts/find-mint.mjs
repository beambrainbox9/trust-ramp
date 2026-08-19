// Finds who received the MockUSDC constructor mint on X Layer mainnet.
// Run from the backend directory: node scripts/find-mint.mjs
//
// X Layer caps eth_getLogs to 100-block ranges, so this binary-searches
// for the approximate deploy block, then scans ±3000 blocks in chunks.

import { createPublicClient, http, parseAbi } from "viem";

const USDC = "0x096970D0c7Aa0Ac70Afe6e8c2373a07bF03cB12D";
const rpcUrl = process.env.XLAYER_MAINNET_RPC || "https://rpc.xlayer.tech";
const client = createPublicClient({ transport: http(rpcUrl) });

const targetTs = Math.floor(Date.parse("2026-08-19T07:35:52Z") / 1000);

async function blockTs(n) {
  const b = await client.getBlock({ blockNumber: n });
  return Number(b.timestamp);
}

async function main() {
  let lo = 0n;
  let hi = await client.getBlockNumber();
  console.log(`latest block: ${hi}  target unix ts: ${targetTs}`);

  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const ts = await blockTs(mid);
    if (ts < targetTs) lo = mid + 1n;
    else hi = mid;
  }
  console.log(`estimated deploy-time block: ${lo}`);

  const abi = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);
  const from = lo > 3000n ? lo - 3000n : 0n;
  const to = lo + 3000n;
  const step = 100n;
  console.log(`scanning blocks ${from} -> ${to} in chunks of ${step}...`);

  let found = [];
  for (let start = from; start <= to; start += step) {
    const end = start + step - 1n > to ? to : start + step - 1n;
    try {
      const logs = await client.getContractEvents({
        address: USDC,
        abi,
        eventName: "Transfer",
        args: { from: "0x0000000000000000000000000000000000000000" },
        fromBlock: start,
        toBlock: end,
      });
      if (logs.length) found = found.concat(logs);
    } catch (err) {
      console.error(`chunk ${start}-${end} error: ${err.message}`);
    }
  }

  if (!found.length) {
    console.log("No mint events found in this window. Widen the range.");
    return;
  }
  console.log(`\n=== MINT EVENTS FOUND: ${found.length} ===`);
  for (const log of found) {
    console.log(
      `  to: ${log.args.to}  amount: ${log.args.value}  block: ${log.blockNumber}  tx: ${log.transactionHash}`
    );
  }
}

main();
