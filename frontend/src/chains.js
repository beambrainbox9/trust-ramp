import { defineChain } from "viem";

// X Layer isn't a viem built-in, so we define it manually. Values confirmed
// against OKX's live developer docs, Aug 7 2026.
//
// Correction from an earlier draft: the block explorer migrated OFF OKLink
// to OKX's own integrated explorer (confirmed via OKX's current docs and an
// independent third-party guide dated June 2026 that explicitly calls out
// the migration). oklink.com URLs are the stale pre-migration ones — don't
// reuse them even though they still resolve.
//
// The drpc.org fallback RPCs are real and verified (dRPC lists X Layer
// mainnet/testnet with matching chain IDs) — kept as secondary endpoints in
// case the primary OKX RPC is congested during a live demo.

export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://testrpc.xlayer.tech/terigon",
        "https://xlayertestrpc.okx.com/terigon",
        "https://xlayer-testnet.drpc.org",
      ],
    },
  },
  blockExplorers: {
    default: { name: "X Layer Testnet Explorer", url: "https://www.okx.com/web3/explorer/xlayer-test" },
  },
  testnet: true,
});

export const xLayerMainnet = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        "https://rpc.xlayer.tech",
        "https://xlayerrpc.okx.com",
        "https://xlayer-mainnet.drpc.org",
      ],
    },
  },
  blockExplorers: {
    default: { name: "X Layer Explorer", url: "https://www.okx.com/web3/explorer/xlayer" },
  },
  testnet: false,
});
