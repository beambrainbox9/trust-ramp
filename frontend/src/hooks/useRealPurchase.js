import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http, encodeFunctionData, formatUnits, parseUnits } from "viem";
import { useWallets } from "@privy-io/react-auth";
import { usePurchaseFlow } from "../context/PurchaseFlowContext.jsx";
import {
  NETWORKS,
  ERC20_ABI,
  SALE_ABI,
  ASSET_DECIMALS,
  PAYMENT_DECIMALS,
} from "../config/contracts.js";
import { apiUrl } from "../config/api.js";
import { createMainnetSmartAccountClient, mainnetPublicClient } from "../lib/mainnetSmartAccount.js";

const NET = NETWORKS.mainnet;
const { contracts } = NET;

const publicClient = createPublicClient({
  chain: NET.chain,
  transport: http(undefined, { retryCount: 2, timeout: 10_000 }),
});

export const REAL_STEP = {
  IDLE: "idle",
  RISK_BRIEFING: "risk_briefing",
  APPROVAL: "approval",
  APPROVAL_DONE: "approval_done",
  PURCHASE: "purchase",
  PURCHASE_DONE: "purchase_done",
};

export function useRealPurchase(smartAccountAddress) {
  const { wallets, ready: walletsReady } = useWallets();
  const { emitTransaction } = usePurchaseFlow();

  const [step, setStep] = useState(REAL_STEP.IDLE);
  const [busy, setBusy] = useState(null);
  const [txHashes, setTxHashes] = useState({ approve: null, buy: null });
  const [txError, setTxError] = useState(null);
  const [lastFailedAction, setLastFailedAction] = useState(null);
  const [capError, setCapError] = useState(null);

  const [pendingApproval, setPendingApproval] = useState(null);
  const approvalResolveRef = useRef(null);

  const [state, setState] = useState({
    loading: false,
    error: null,
    paymentBalance: 0n,
    assetBalance: 0n,
    allowance: 0n,
    pricePerToken: 0n,
    availableSupply: 0n,
  });

  // Risk briefing from /api/narrate
  const [riskBriefing, setRiskBriefing] = useState(null);
  const [riskBriefingLoading, setRiskBriefingLoading] = useState(false);

  // --- Mainnet smart account client ---
  const [mainnetClient, setMainnetClient] = useState(null);
  const [clientReady, setClientReady] = useState(false);
  const [clientError, setClientError] = useState(null);
  const buildRef = useRef(null);

  const embeddedWallet = walletsReady
    ? wallets.find((w) => w.walletClientType === "privy")
    : null;

  useEffect(() => {
    if (!embeddedWallet || mainnetClient || buildRef.current) return;
    const promise = createMainnetSmartAccountClient(embeddedWallet)
      .then((c) => {
        setMainnetClient(c);
        setClientReady(true);
        return c;
      })
      .catch((err) => {
        console.log(`[TR-MAINNET-ACCOUNT] build FAILED: ${err?.message || err}`);
        setClientError(err?.message || String(err));
        buildRef.current = null;
      });
    buildRef.current = promise;
  }, [embeddedWallet, mainnetClient]);

  // --- Chain reads ---
  const refresh = useCallback(async (atBlock) => {
    if (!smartAccountAddress) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    const at = atBlock !== undefined ? { blockNumber: atBlock } : {};
    try {
      const [paymentBalance, assetBalance, allowance, pricePerToken, availableSupply] =
        await Promise.all([
          publicClient.readContract({
            address: contracts.paymentToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [smartAccountAddress],
            ...at,
          }),
          publicClient.readContract({
            address: contracts.assetToken,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [smartAccountAddress],
            ...at,
          }),
          publicClient.readContract({
            address: contracts.paymentToken,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [smartAccountAddress, contracts.sale],
            ...at,
          }),
          publicClient.readContract({
            address: contracts.sale,
            abi: SALE_ABI,
            functionName: "pricePerTokenUnits",
            ...at,
          }),
          publicClient.readContract({
            address: contracts.sale,
            abi: SALE_ABI,
            functionName: "availableSupply",
            ...at,
          }),
        ]);
      setState({
        loading: false,
        error: null,
        paymentBalance,
        assetBalance,
        allowance,
        pricePerToken,
        availableSupply,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err?.shortMessage || err?.message || "Could not read mainnet chain state.",
      }));
    }
  }, [smartAccountAddress]);

  useEffect(() => { refresh(); }, [refresh]);

  const quote = useCallback(async (tokenAmountWei) => {
    return publicClient.readContract({
      address: contracts.sale,
      abi: SALE_ABI,
      functionName: "costFor",
      args: [tokenAmountWei],
    });
  }, []);

  // --- Fetch risk briefing from /api/narrate ---
  const fetchRiskBriefing = useCallback(async (context) => {
    setRiskBriefingLoading(true);
    try {
      const res = await fetch(apiUrl("/api/narrate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
        },
        body: JSON.stringify({
          step: "overview",
          context: {
            ...context,
            networkLabel: NET.label,
            isMainnet: true,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.narration) {
        setRiskBriefing(data.narration);
      }
    } catch {
      // Non-fatal — the briefing is informational
    } finally {
      setRiskBriefingLoading(false);
    }
  }, []);

  // --- Send with mandatory mainnetGate ---
  const send = useCallback(
    async (label, to, data, txMeta, mainnetGate) => {
      const client = mainnetClient;
      if (!client?.account?.address) {
        throw new Error("Mainnet account is still being set up — give it a moment and try again.");
      }
      setBusy(label);
      setTxError(null);
      setLastFailedAction(null);
      setCapError(null);

      // Mainnet spending-cap gate (before modal)
      let preparedTx = null;
      if (mainnetGate) {
        try {
          const prepRes = await fetch(apiUrl("/api/prepare-transaction"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
            },
            body: JSON.stringify({
              userAddress: mainnetGate.userAddress,
              amountUsd: mainnetGate.amountUsd,
              network: "mainnet",
            }),
          });
          const prepData = await prepRes.json();
          if (!prepRes.ok) {
            setCapError(prepData.error || "Transaction could not be prepared.");
            setBusy(null);
            return;
          }
          preparedTx = prepData.preparedTx;
        } catch {
          setCapError("Could not reach the server to validate this transaction. Please try again.");
          setBusy(null);
          return;
        }
      }

      // Human-approval modal
      const modalMeta = preparedTx
        ? {
            ...txMeta,
            label: txMeta.label,
            amount: `$${preparedTx.valueUsd.toFixed(2)} USD`,
            summary: preparedTx.plainLanguageSummary,
            riskNotes: preparedTx.riskNotes,
            network: NET.label,
          }
        : { ...txMeta, network: NET.label };

      try {
        await new Promise((resolve, reject) => {
          approvalResolveRef.current = { resolve, reject };
          setPendingApproval(modalMeta);
        });
      } catch {
        setBusy(null);
        setPendingApproval(null);
        approvalResolveRef.current = null;
        return;
      } finally {
        setPendingApproval(null);
        approvalResolveRef.current = null;
      }

      // Server approve gate (after human clicked Approve)
      if (preparedTx) {
        try {
          const appRes = await fetch(apiUrl("/api/approve-transaction"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-TrustRamp-Secret": import.meta.env.VITE_API_SHARED_SECRET || "",
            },
            body: JSON.stringify({ preparedTx, humanApproved: true }),
          });
          const appData = await appRes.json();
          if (!appData.allowed) {
            setCapError(appData.reason || "Transaction was not approved by the server.");
            setBusy(null);
            return;
          }
          to = preparedTx.to;
          if (mainnetGate.rebuildData) {
            data = mainnetGate.rebuildData(preparedTx);
          }
        } catch {
          setCapError("Could not reach the server to finalize approval. Please try again.");
          setBusy(null);
          return;
        }
      }

      // Retry loop
      const TRANSIENT = [
        "gas required exceeds allowance",
        "invalid auth token",
        "401",
        "403",
        "failed to get block",
        "fetch failed",
        "network request failed",
      ];
      const errText = (e) =>
        [e?.shortMessage, e?.message, e?.details, e?.cause?.message, e?.cause?.details, String(e)]
          .filter(Boolean)
          .join(" | ")
          .toLowerCase();
      const isTransient = (e) => TRANSIENT.some((t) => errText(e).includes(t));

      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const hash = await client.sendTransaction({ to, data, value: 0n });
          const receipt = await mainnetPublicClient.waitForTransactionReceipt({
            hash,
            timeout: 180_000,
          });
          if (receipt.status !== "success") {
            throw new Error(`Transaction reverted on-chain (${hash}).`);
          }
          setTxHashes((h) => ({ ...h, [label]: hash }));
          emitTransaction({ kind: label, address: smartAccountAddress, hash });
          await refresh(receipt.blockNumber);
          setBusy(null);
          return hash;
        } catch (err) {
          lastErr = err;
          console.log(
            `[TR-MAINNET-RETRY] attempt ${attempt}/3 failed, transient=${isTransient(err)} :: ${errText(err).slice(0, 200)}`
          );
          if (attempt < 3 && isTransient(err)) {
            await new Promise((r) => setTimeout(r, 1200 * attempt));
            continue;
          }
          break;
        }
      }

      setBusy(null);
      setTxError(lastErr?.message || lastErr?.shortMessage || String(lastErr));
      setLastFailedAction({ label, to, data, txMeta, mainnetGate });
      throw lastErr;
    },
    [mainnetClient, refresh, emitTransaction, smartAccountAddress]
  );

  const retryLast = useCallback(async () => {
    if (!lastFailedAction) return;
    const { label, to, data, txMeta, mainnetGate: gate } = lastFailedAction;
    return send(label, to, data, txMeta, gate);
  }, [lastFailedAction, send]);

  const approveExact = useCallback(
    async (costUnits) => {
      return send(
        "approve",
        contracts.paymentToken,
        encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [contracts.sale, costUnits],
        }),
        {
          label: "Approve spending (mainnet)",
          amount: `${formatUnits(costUnits, PAYMENT_DECIMALS)} USDC`,
          spender: contracts.sale,
          token: "USDC",
          network: NET.label,
        }
      );
    },
    [send]
  );

  const buy = useCallback(
    async (tokenAmountWei, maxPaymentIn) => {
      const gate = {
        userAddress: smartAccountAddress,
        amountUsd: Number(formatUnits(maxPaymentIn, PAYMENT_DECIMALS)),
        rebuildData: (ptx) => {
          const serverMaxPayment = parseUnits(
            (ptx.valueCents / 100).toFixed(PAYMENT_DECIMALS),
            PAYMENT_DECIMALS
          );
          return encodeFunctionData({
            abi: SALE_ABI,
            functionName: "buy",
            args: [tokenAmountWei, serverMaxPayment],
          });
        },
      };
      return send(
        "buy",
        contracts.sale,
        encodeFunctionData({
          abi: SALE_ABI,
          functionName: "buy",
          args: [tokenAmountWei, maxPaymentIn],
        }),
        {
          label: "Purchase asset tokens (mainnet)",
          amount: `${formatUnits(tokenAmountWei, ASSET_DECIMALS)} xTBILL for ${formatUnits(maxPaymentIn, PAYMENT_DECIMALS)} USDC`,
          spender: contracts.sale,
          token: "xTBILL",
          network: NET.label,
        },
        gate
      );
    },
    [send, smartAccountAddress]
  );

  const approvePending = useCallback(() => {
    approvalResolveRef.current?.resolve();
  }, []);

  const cancelPending = useCallback(() => {
    approvalResolveRef.current?.reject(new Error("User cancelled"));
  }, []);

  return {
    ...state,
    step,
    setStep,
    busy,
    txHashes,
    txError,
    capError,
    clearCapError: useCallback(() => setCapError(null), []),
    clientReady,
    clientError,
    canRetry: Boolean(lastFailedAction),
    retryLast,
    refresh,
    quote,
    approveExact,
    buy,
    pendingApproval,
    approvePending,
    cancelPending,
    riskBriefing,
    riskBriefingLoading,
    fetchRiskBriefing,
    fmtPayment: (v) => formatUnits(v ?? 0n, PAYMENT_DECIMALS),
    fmtAsset: (v) => formatUnits(v ?? 0n, ASSET_DECIMALS),
    parseAsset: (v) => parseUnits(String(v), ASSET_DECIMALS),
  };
}
