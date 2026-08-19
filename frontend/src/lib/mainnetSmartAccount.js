// Mainnet-specific ERC-4337 smart account client.
//
// Mirrors smartAccount.js but targets xLayerMainnet (chain 196) and routes
// through /api/bundler-mainnet. Created as an additive file so the testnet
// client in smartAccount.js and useTrustRampSmartWallet.js stay untouched.

import { createPublicClient, http } from "viem";
import { entryPoint06Address } from "viem/account-abstraction";
import { toLightSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless";
import { xLayerMainnet } from "../chains.js";
import { apiUrl } from "../config/api.js";

const MAINNET_GAS_POLICY_ID = "c285838d-b936-4dca-afbf-28f4acd1f4e2";
const BUNDLER_PROXY_URL = apiUrl("/api/bundler-mainnet");

export const mainnetPublicClient = createPublicClient({
  chain: xLayerMainnet,
  transport: http(undefined, { retryCount: 2, timeout: 10_000 }),
});

export async function createMainnetSmartAccountClient(embeddedWallet) {
  if (!embeddedWallet) {
    throw new Error("createMainnetSmartAccountClient: no embedded wallet given");
  }
  const provider = await embeddedWallet.getEthereumProvider();

  const account = await toLightSmartAccount({
    client: mainnetPublicClient,
    owner: provider,
    version: "1.1.0",
    entryPoint: { address: entryPoint06Address, version: "0.6" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: xLayerMainnet,
    bundlerTransport: http(BUNDLER_PROXY_URL, {
      retryCount: 3,
      timeout: 20_000,
      fetchOptions: {
        headers: { "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "" },
      },
    }),
    paymaster: true,
    paymasterContext: { policyId: MAINNET_GAS_POLICY_ID },
    userOperation: {
      estimateFeesPerGas: async () => {
        const block = await mainnetPublicClient.getBlock({ blockTag: "latest" });
        const baseFee = block.baseFeePerGas ?? 0n;
        const maxPriorityFeePerGas = 150_000n;
        const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
        return { maxFeePerGas, maxPriorityFeePerGas };
      },
    },
  });

  console.log(
    `[TR-MAINNET-ACCOUNT] client ready address=${smartAccountClient.account.address} ` +
      `chain=${xLayerMainnet.id}`
  );

  return smartAccountClient;
}
