import React from "react";
import {
  usePrivy,
  useLoginWithPasskey,
  useSignupWithPasskey,
  useCreateWallet,
} from "@privy-io/react-auth";
// SIWE-BYPASS (2026-08-17). Was: `import { useSmartWallets } from
// "@privy-io/react-auth/smart-wallets"`. Privy's SIWE-based smart-wallet
// linking 422s unconditionally on chain 1952 — see lib/smartAccount.js for
// the full history. This hook matches the same `{ client, getClientForChain
// }` shape so nothing downstream needed a rewrite.
import { useTrustRampSmartWallet as useSmartWallets } from "./hooks/useTrustRampSmartWallet.js";
import ChatTutor from "./components/ChatTutor.jsx";
import PracticeFlow from "./components/PracticeFlow.jsx";
import ReputationQuiz from "./components/ReputationQuiz.jsx";
import RealPurchaseFlow from "./components/RealPurchaseFlow.jsx";
import { useQuizFlow } from "./hooks/useQuizFlow.js";
import { ACTIVE_NETWORK, GAS_POLICY_ID_REFERENCE } from "./config/contracts.js";
import { Link } from "./router.jsx";
import NetworkBadge from "./components/NetworkBadge.jsx";

// Unique build fingerprint. Used to confirm the debug panel is present in the
// deployed bundle (grep dist/**/*.js for this string after `vite build`).
// Bump the date suffix if you meaningfully change the panel and need to
// distinguish a new deploy from an old one still in a viewer's cache.
const TR_DEBUG_PANEL_BUILD_ID = "TR-DEBUG-PANEL-2026-08-17-v4-gated";

// Local-storage sniff for "is there a prior TrustRamp account on THIS browser".
// Not authoritative — the user could have cleared storage, or this may be a
// fresh browser for a user whose passkey is on the device via Windows Hello
// even though no localStorage exists. That's the whole point of surfacing
// "I already have a passkey" as ALWAYS available; the returning-user hint just
// picks the friendlier default when we have evidence.
//
// Keyed on any prior write from the practice-step or narration caches — either
// means an account was used here before. Reputation is on-chain so it doesn't
// leave a localStorage trace by itself.
function hasLikelyReturningUser() {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) || "";
      if (
        key.startsWith("trustramp.practicestep.v1:") ||
        key.startsWith("trustramp.stepnarration.v1:") ||
        key.startsWith("trustramp.conversation.v1:")
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Signature element: an ascending "ramp" rail with four stops, echoing the
// product name and the literal journey (zero -> learn -> practice -> real,
// approved purchase -> on-chain reputation). Real content, not decoration —
// it doubles as a status indicator once we wire up progress state.
function RampRail({ activeStep = 0 }) {
  const steps = ["Learn", "Practice (testnet)", "Real purchase (approved)", "Reputation minted"];
  return (
    <div className="flex items-end gap-3 sm:gap-6" aria-label="Onboarding progress">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-col items-center" style={{ marginBottom: i * 10 }}>
          <div
            className={`h-2 w-10 sm:w-16 rounded-full ${
              i <= activeStep ? "bg-guide" : "bg-surfaceRaised"
            }`}
          />
          <span className="mt-2 text-[10px] sm:text-xs font-data text-paper/60 text-center max-w-[70px] sm:max-w-none">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Landing-page auth entry.
 *
 * SOLVES THE PROBLEM CONFIRMED AUG 15: our previous single "Start with a passkey"
 * button routed through Privy's generic login() modal. On a fresh incognito
 * profile — where Privy has no session hint — the modal defaulted to the
 * REGISTRATION ceremony (signupWithPasskey). Every incognito run therefore
 * minted a brand-new credential in Windows Hello and a brand-new smart account,
 * even though the passkey for the returning user still existed on the OS.
 *
 * Now: two explicit buttons, wired to the two distinct SDK methods:
 *   - signupWithPasskey()  → registration ceremony, always mints a new credential
 *   - loginWithPasskey()   → authentication ceremony, OS-level lookup of an existing
 *                           credential (returns the SAME smart account across profiles)
 *
 * If localStorage carries evidence of a prior TrustRamp session on this browser,
 * "Resume with your existing passkey" becomes the prominent default so a
 * returning user doesn't have to hunt for the login path.
 */
function AuthEntry() {
  const { loginWithPasskey } = useLoginWithPasskey({
    onError: (err) => console.log(`[TR-AUTH] loginWithPasskey error: ${err?.message || err}`),
  });
  const { signupWithPasskey } = useSignupWithPasskey({
    onError: (err) => console.log(`[TR-AUTH] signupWithPasskey error: ${err?.message || err}`),
  });
  // DIAGNOSTIC (2026-08-17). Temporary fallback path via the Privy modal to
  // isolate whether the SIWE 422 on smart-wallet linking is passkey-specific.
  // Also — the Privy modal path auto-creates the embedded wallet (dashboard
  // setting "Automatically create embedded wallets on login" only fires for
  // the modal, not the whitelabel hooks), so AUTOHEAL is bypassed on this
  // path, removing a variable from the failure. If this path succeeds and
  // reaches the Practice screen where whitelabel passkey does not, the bug
  // is scoped to whitelabel passkey signup and we can ship with modal auth
  // for the demo. Remove after root-cause is found.
  const { login: loginWithModal } = usePrivy();
  const returning = React.useMemo(hasLikelyReturningUser, []);
  React.useEffect(() => {
    console.log(`[TR-AUTH] mounted returningUserHint=${returning}`);
  }, [returning]);

  // Click-guard against double-invocation of the WebAuthn ceremony.
  //
  // On 2026-08-17, fresh-account signup on trust-ramp.vercel.app 422'd every
  // time on Privy's `link_smart_wallet` endpoint with "Invalid SIWE message
  // and/or signature". Console showed TWO `[TR-AUTH] signupWithPasskey CLICKED`
  // + TWO `RESOLVED` lines per attempted signup. Both invocations completed
  // signing; each generated its own SIWE link POST; the second consumed the
  // same nonce the first had already burned server-side, so Privy rejected
  // it. Most likely trigger on iPad Safari: the passkey sheet is slow to
  // appear and the user taps again out of frustration — but the ref-guard
  // holds regardless of the cause (double-tap, event replay, SDK callback,
  // anything). React StrictMode is not the cause: production build, and
  // StrictMode never double-invokes event handlers anyway.
  const inFlightRef = React.useRef(false);

  const doLogin = async () => {
    if (inFlightRef.current) {
      console.log("[TR-AUTH] loginWithPasskey CLICKED (ignored — already in flight)");
      return;
    }
    inFlightRef.current = true;
    console.log("[TR-AUTH] loginWithPasskey CLICKED");
    try {
      await loginWithPasskey();
      console.log("[TR-AUTH] loginWithPasskey RESOLVED");
    } catch (err) {
      console.log(`[TR-AUTH] loginWithPasskey THREW: ${err?.message || err}`);
    } finally {
      inFlightRef.current = false;
    }
  };
  const doSignup = async () => {
    if (inFlightRef.current) {
      console.log("[TR-AUTH] signupWithPasskey CLICKED (ignored — already in flight)");
      return;
    }
    inFlightRef.current = true;
    console.log("[TR-AUTH] signupWithPasskey CLICKED");
    try {
      await signupWithPasskey();
      console.log("[TR-AUTH] signupWithPasskey RESOLVED");
    } catch (err) {
      console.log(`[TR-AUTH] signupWithPasskey THREW: ${err?.message || err}`);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Prominent = the button a judge or returning user should hit first. Secondary
  // = still a real button, not a small link — accidentally hitting signup on a
  // returning user costs them account continuity, and hitting login on a first-
  // time user just fails cleanly with "no credential found".
  const primaryClass = "btn-primary !px-6";
  const secondaryClass = "btn-secondary !px-6";
  // DIAGNOSTIC — plain link so it's visually distinct from the primary flow.
  const diagnosticClass =
    "text-paper/50 underline hover:text-paper/80 text-xs mt-4";
  const doModalLogin = () => {
    console.log("[TR-AUTH-DIAG] opening Privy modal (bypasses whitelabel passkey)");
    loginWithModal();
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        {returning ? (
          <>
            <button onClick={doLogin} className={primaryClass}>
              Resume with your existing passkey
            </button>
            <button onClick={doSignup} className={secondaryClass}>
              Start fresh with a new passkey
            </button>
          </>
        ) : (
          <>
            <button onClick={doSignup} className={primaryClass}>
              Start with a passkey — no seed phrase needed
            </button>
            <button onClick={doLogin} className={secondaryClass}>
              I already have a passkey
            </button>
          </>
        )}
      </div>
      {/* DIAGNOSTIC — remove once passkey SIWE 422 is root-caused. */}
      <div>
        <button onClick={doModalLogin} className={diagnosticClass}>
          Trouble with passkey? Try email instead (diagnostic)
        </button>
      </div>
      {/* Passkey-save guidance. When Chrome offers a choice between "Google
          Password Manager" and "Windows Hello or external security key", the
          first option syncs to the same Google account across profiles and
          devices; the second sometimes falls through to demanding a physical
          USB key on later attempts (a Chrome/Windows quirk we can't override
          from application code — Privy's SDK does not expose the WebAuthn
          `authenticatorSelection` field). Google Password Manager is the
          smoother default; we say so, once, at the point of choice. */}
      <p className="text-xs text-paper/40 mt-3 max-w-lg">
        Tip: if your browser asks where to save the passkey, choosing Google
        Password Manager syncs it to your Google account so you can log back in
        on any device.
      </p>
    </div>
  );
}

/**
 * Runtime probe of the SmartWalletsProvider. READ-ONLY — no attempt to fix
 * anything. Everything it displays is read from the LIVE client at runtime, not
 * from build-time config, so it reflects what Privy actually built in this
 * shipped bundle after the dashboard values landed.
 *
 * Ships in every build (production included) because the failure we are chasing
 * — "Failed to create smart wallet client for chain id: 1952" — only reproduces
 * on the deployed site. A localhost-only debug panel would be useless here.
 */
function useSmartWalletDiagnostics() {
  const { client: smartWalletClient, getClientForChain } = useSmartWallets();
  // Also read the Privy user object so we can surface which of the four
  // `getClientForChain` early-out conditions is failing:
  //   if (!(smartWalletsConfig?.enabled && user && account && signer)) return;
  // - enabled: dashboard toggle, already confirmed true.
  // - user: this hook's `user`.
  // - account: the embedded wallet (an entry in user.linkedAccounts with
  //   type: "wallet", walletClientType: "privy").
  // - signer: `await embeddedWallet.getEthereumProvider()`, which needs an
  //   embedded wallet to even ask.
  // If a user's embedded wallet was never fully created (e.g. Buffer failure
  // during signup before the polyfill was fixed on 2026-08-16), the user
  // record exists but has no embedded wallet entry, so account is undefined
  // and the SDK exits before any bundler call.
  const { user, ready, authenticated } = usePrivy();
  const [diag, setDiag] = React.useState({
    phase: "probing",
    errorMessage: null,
    errorName: null,
    lastCheckedAt: null,
  });

  // SIWE-RACE FIX (2026-08-17). Was previously calling `getClientForChain`
  // concurrently with usePracticePurchase's paymaster loop, both before the
  // smart wallet's SIWE link had completed. Privy's `linkSmartWallet` POST
  // returned 422 "Invalid SIWE message and/or signature" for whichever call
  // lost the race. Gating this probe on the smart-wallet address existing
  // means the link has already succeeded before we probe — Privy returns a
  // cached client and no fresh SIWE is signed. If the smart wallet never
  // materialises, the AUTOHEAL logs and the phase "probing" surface that on
  // their own.
  const smartAccountAddr = smartWalletClient?.account?.address ?? null;
  React.useEffect(() => {
    if (!getClientForChain) return;
    if (!smartAccountAddr) return;
    let cancelled = false;
    let attempts = 0;

    async function probe() {
      attempts += 1;
      try {
        const c = await getClientForChain({ id: ACTIVE_NETWORK.chainId });
        if (cancelled) return;
        if (c?.account?.address) {
          setDiag({
            phase: "ready",
            errorMessage: null,
            errorName: null,
            lastCheckedAt: new Date().toISOString(),
            attempts,
          });
          return true;
        }
        setDiag({
          phase: "no-account",
          errorMessage: "getClientForChain resolved but returned no account",
          errorName: null,
          lastCheckedAt: new Date().toISOString(),
          attempts,
        });
        return false;
      } catch (err) {
        if (cancelled) return;
        setDiag({
          phase: "error",
          errorMessage: err?.message || String(err),
          errorName: err?.name || null,
          lastCheckedAt: new Date().toISOString(),
          attempts,
        });
        return false;
      }
    }

    (async () => {
      // Give the provider up to 60s to finish coming up, then leave the last
      // observed state on screen so the user can read it.
      const started = Date.now();
      while (!cancelled && Date.now() - started < 60_000) {
        const ok = await probe();
        if (ok) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getClientForChain, smartAccountAddr]);

  // Everything below is read straight from the live client on every render, so
  // the panel reflects the current object — not a snapshot taken at mount.
  const c = smartWalletClient;
  const paymaster = c?.paymaster ?? null;
  const paymasterCtx = c?.paymasterContext ?? null;
  const transport = c?.transport ?? null;

  // Attempt to read a URL out of whatever transport permissionless/viem built.
  // Different internal shapes have surfaced across versions — check the common
  // spots and print whichever we find, or "(not exposed)".
  function pickUrl(obj) {
    if (!obj) return null;
    return (
      obj.url ||
      obj.transport?.url ||
      obj.rpcUrls?.default?.http?.[0] ||
      null
    );
  }

  const bundlerUrl = pickUrl(transport) || pickUrl(c?.chain);
  // The paymaster may be an object with methods (getPaymasterData) built from a
  // pimlico client, or a wrapped viem client. Try each shape.
  const paymasterUrl =
    pickUrl(paymaster) ||
    pickUrl(paymaster?.client) ||
    pickUrl(paymaster?.transport) ||
    null;

  const runtimePolicyId =
    paymasterCtx?.policyId ||
    paymasterCtx?.sponsorshipPolicyId ||
    null;

  const bufferInGlobal =
    typeof globalThis !== "undefined" && typeof globalThis.Buffer !== "undefined";
  const bufferInWindow =
    typeof window !== "undefined" && typeof window.Buffer !== "undefined";

  // Enumerate linked accounts safely — array of type/kind labels rather than
  // full objects (some fields carry PII we do not want in a shipped debug UI).
  const linkedAccountSummaries = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts.map((a) => ({
        type: a?.type ?? null,
        walletClientType: a?.walletClientType ?? null,
        connectorType: a?.connectorType ?? null,
        chainType: a?.chainType ?? null,
        addressHead: typeof a?.address === "string" ? a.address.slice(0, 10) : null,
      }))
    : null;

  const embeddedWalletEntry = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts.find(
        (a) => a?.type === "wallet" && a?.walletClientType === "privy"
      )
    : null;

  return {
    buildId: TR_DEBUG_PANEL_BUILD_ID,
    probe: diag,
    hasClient: Boolean(c),
    hasAccount: Boolean(c?.account?.address),
    accountAddress: c?.account?.address || null,
    // Privy-side account state — this is what the SDK's early-out check reads.
    // If `hasEmbeddedWallet` is false while `authenticated` is true, the user
    // record has no embedded wallet: signup failed to create one (most likely
    // pre-Buffer-fix), and getClientForChain will always throw for this user.
    privyReady: ready,
    privyAuthenticated: authenticated,
    userId: user?.id || null,
    userWalletAddress: user?.wallet?.address || null,
    hasEmbeddedWallet: Boolean(embeddedWalletEntry),
    embeddedWalletAddressHead: embeddedWalletEntry?.address
      ? embeddedWalletEntry.address.slice(0, 10)
      : null,
    linkedAccountsCount: user?.linkedAccounts?.length ?? 0,
    linkedAccounts: linkedAccountSummaries,
    configuredChainId: ACTIVE_NETWORK.chainId,
    clientChainId: c?.chain?.id ?? null,
    clientChainName: c?.chain?.name ?? null,
    bundlerUrl: bundlerUrl || "(not exposed on client)",
    paymasterUrl: paymasterUrl || "(not exposed on client)",
    paymasterTypeof: typeof paymaster,
    paymasterKeys: paymaster ? Object.keys(paymaster).slice(0, 12) : null,
    paymasterContext: paymasterCtx,
    referencePolicyId: GAS_POLICY_ID_REFERENCE,
    runtimePolicyId: runtimePolicyId || "(not present in paymasterContext)",
    bufferGlobal: bufferInGlobal,
    bufferWindow: bufferInWindow,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    origin: typeof location !== "undefined" ? location.origin : null,
  };
}

function SmartWalletDebugPanel({ diag }) {
  const [open, setOpen] = React.useState(false);
  const pretty = React.useMemo(() => JSON.stringify(diag, null, 2), [diag]);

  // Gate the panel on `?debug=1` — kept in the shipped bundle so support can
  // send a user the URL and get the full JSON back, but hidden from normal
  // visitors now that the smart-wallet flow is settled. The bug we chased only
  // reproduces on the deployed site, so removing the panel entirely would lose
  // us the tool we would need for the next report. Also honour the previous
  // localStorage flip `trustramp.debug=1` for support sessions.
  const isDebug = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("debug") === "1") return true;
      if (window.localStorage.getItem("trustramp.debug") === "1") return true;
    } catch {
      /* ignore */
    }
    return false;
  }, []);
  if (!isDebug) return null;

  return (
    <div className="mt-6 border border-paper/15 rounded-md">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 text-xs font-data text-paper/70 hover:text-paper flex items-center justify-between"
        data-tr-debug-toggle={TR_DEBUG_PANEL_BUILD_ID}
      >
        <span>{open ? "▼" : "▶"} Show debug info (smart wallet)</span>
        <span className="text-paper/40">{TR_DEBUG_PANEL_BUILD_ID}</span>
      </button>
      {open && (
        <pre
          className="px-3 pb-3 text-[11px] font-data text-paper/80 whitespace-pre-wrap break-words overflow-x-auto"
          data-tr-debug-body="1"
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}

/**
 * Auto-heal: create an embedded wallet for accounts that don't have one.
 *
 * WHY THIS EXISTS (2026-08-17). The Privy dashboard has "Automatically create
 * embedded wallets on login" ON, but its fine print says:
 *   "Automatic wallet creation only applies to login via the Privy modal and
 *    not from whitelabel login methods."
 * Our AuthEntry uses useLoginWithPasskey / useSignupWithPasskey (whitelabel
 * hooks — chosen deliberately on Aug 15 to route signup vs. login to the
 * correct WebAuthn ceremonies in incognito). Consequence: passkey signup
 * authenticates the user but no embedded wallet is ever attached. The Privy
 * smart-wallet SDK then early-outs in getClientForChain because `signer` is
 * missing, and throws "Failed to create smart wallet client for chain id: 1952"
 * on a loop. Confirmed live on 2026-08-17 for
 *   did:privy:cmsv62v6t00ta0bl4vhd6w61v
 * where linkedAccounts contained only `{type:"passkey"}`.
 *
 * The fix is one Privy call — useCreateWallet().createWallet() — but only when
 * the user actually needs it. createWallet() throws if an embedded wallet
 * already exists, so we gate on !hasEmbeddedWallet and on !inFlight to prevent
 * a StrictMode double-fire from producing that error in dev.
 */
function useAutoHealEmbeddedWallet({ authenticated, hasEmbeddedWallet, ready }) {
  const [state, setState] = React.useState({
    phase: "idle", // 'idle' | 'creating' | 'done' | 'error'
    error: null,
    lastAttemptAt: null,
  });
  const inFlightRef = React.useRef(false);
  const { createWallet } = useCreateWallet({
    onSuccess: ({ wallet }) => {
      console.log(`[TR-AUTOHEAL] createWallet SUCCESS address=${wallet?.address}`);
      setState({ phase: "done", error: null, lastAttemptAt: new Date().toISOString() });
      inFlightRef.current = false;
    },
    onError: (err) => {
      console.log(`[TR-AUTOHEAL] createWallet ERROR: ${err?.message || err}`);
      setState({
        phase: "error",
        error: err?.message || String(err),
        lastAttemptAt: new Date().toISOString(),
      });
      inFlightRef.current = false;
    },
  });

  // Auto-fire once when we observe the missing-wallet state. Gated on ready +
  // authenticated so we do not race Privy's own hydration.
  React.useEffect(() => {
    if (!ready || !authenticated) return;
    if (hasEmbeddedWallet) return;
    if (inFlightRef.current) return;
    if (state.phase === "done" || state.phase === "error") return;
    inFlightRef.current = true;
    setState({ phase: "creating", error: null, lastAttemptAt: new Date().toISOString() });
    console.log("[TR-AUTOHEAL] no embedded wallet on record — calling createWallet()");
    // createWallet is not itself a promise in some SDK versions — the callbacks
    // above are the source of truth. Fire-and-forget is intentional.
    try {
      createWallet();
    } catch (err) {
      console.log(`[TR-AUTOHEAL] createWallet threw synchronously: ${err?.message || err}`);
      setState({
        phase: "error",
        error: err?.message || String(err),
        lastAttemptAt: new Date().toISOString(),
      });
      inFlightRef.current = false;
    }
  }, [ready, authenticated, hasEmbeddedWallet, state.phase, createWallet]);

  const retry = React.useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ phase: "creating", error: null, lastAttemptAt: new Date().toISOString() });
    try {
      createWallet();
    } catch (err) {
      setState({
        phase: "error",
        error: err?.message || String(err),
        lastAttemptAt: new Date().toISOString(),
      });
      inFlightRef.current = false;
    }
  }, [createWallet]);

  return { ...state, retry };
}

export default function App() {
  // `login` deliberately not destructured: <AuthEntry /> uses the specific
  // useLoginWithPasskey / useSignupWithPasskey hooks so signup and login are
  // routed to their distinct WebAuthn ceremonies, not disambiguated inside a
  // Privy modal that defaults wrong on fresh incognito profiles.
  const { ready, authenticated, user } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  // Runs on every render while authenticated — cheap read from live objects,
  // plus a background probe of getClientForChain. See useSmartWalletDiagnostics.
  const diag = useSmartWalletDiagnostics();
  // See the block comment above useAutoHealEmbeddedWallet for why this call
  // is here at all. Reads hasEmbeddedWallet off `diag` so the two hooks agree
  // on what "has a wallet" means.
  const autoHeal = useAutoHealEmbeddedWallet({
    ready,
    authenticated,
    hasEmbeddedWallet: diag.hasEmbeddedWallet,
  });

  // `user.wallet.address` is the raw embedded signer (the key that approves
  // things) — it can sign, but it's not the account that holds funds or sends
  // transactions. `smartWalletClient.account` is the actual ERC-4337 smart
  // contract account (Alchemy Light Account), which the signer owns.
  //
  // The address exists before the contract does: ERC-4337 accounts are
  // COUNTERFACTUAL, deterministically derived from (factory, owner, salt), and
  // only deployed on-chain when the first user operation is sent. So a real
  // address here with no bytecode at it is correct, not a half-finished state.
  //
  // If this is undefined while `authenticated` is true, check in this order:
  //   1. Console for `Buffer is not defined` — Vite doesn't polyfill Node
  //      globals by default and Privy's creation path needs Buffer. Fixed via
  //      vite-plugin-node-polyfills in vite.config.js; a stale
  //      node_modules/.vite pre-bundle can resurrect it.
  //   2. Privy dashboard bundler/paymaster config for chain 1952 (see main.jsx).
  // STICKY. `smartWalletClient` is swapped by Privy during initialisation, so
  // reading the address straight off it makes this value FLICKER:
  // undefined -> 0xabc -> undefined -> 0xabc. That flicker caused two separate
  // bugs (both reproduced Aug 11):
  //
  //  1. ChatTutor takes this as `walletAddress`, and uses it as its
  //     localStorage key. A flicker wrote the conversation under ":anon" and
  //     then read it back under ":0xabc", so the history appeared to vanish and
  //     the tutor stopped responding until a hard refresh.
  //  2. It re-triggered useWalletState mid-conversation, and re-ran effects in
  //     the practice flow.
  //
  // An address never legitimately reverts to undefined while a user stays
  // logged in, so we latch the first real one. Cleared on logout below.
  const [stickyAddress, setStickyAddress] = React.useState(null);
  const liveAddress = smartWalletClient?.account?.address;
  React.useEffect(() => {
    if (liveAddress) setStickyAddress(liveAddress);
    else if (!authenticated) setStickyAddress(null);
  }, [liveAddress, authenticated]);
  const smartAccountAddress = liveAddress || stickyAddress;

  // Graduation status for the real-purchase gate. useQuizFlow reads
  // TrustRampReputation.getScore() once per address — a lightweight chain read.
  //
  // SINGLE INSTANCE, passed down to ReputationQuiz below rather than let it
  // call useQuizFlow itself. Two independent hook instances used to exist —
  // this one and ReputationQuiz's own — each with its own `onchain` state. A
  // successful mint() calls refreshOnchain() on whichever instance owns the
  // button, which was ReputationQuiz's; this instance's `graduated` (the one
  // RealPurchaseFlow actually gates on) never got told to refresh, so the
  // Real Purchase section stayed locked until a full reload remounted both
  // and re-ran their independent initial reads. Confirmed live, reproduced
  // twice. One shared instance means one refresh updates both consumers.
  const quizState = useQuizFlow(smartAccountAddress);
  const graduated = quizState.onchain.graduated;

  return (
    <div className="min-h-screen bg-ink">
      <header className="max-w-3xl mx-auto px-6 pt-16 pb-10">
        <div className="flex items-center justify-between mb-4">
          <p className="font-data text-xs tracking-widest text-guide uppercase">
            TrustRamp · X Layer
          </p>
          <Link to="/" className="text-xs text-paper/40 hover:text-paper/70 transition">
            ← Back to home
          </Link>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl leading-tight text-paper">
          Your first real step into DeFi,
          <br />
          <span className="text-guide">taken with a guide, not a leap of faith.</span>
        </h1>
        <p className="mt-5 text-paper/70 max-w-xl">
          No seed phrase to lose. An AI tutor that teaches using your actual
          wallet. A risk-free practice round before anything real. Then one
          small, human-approved purchase — and an on-chain score proving what
          you actually understood.
        </p>

        <div className="mt-10">
          <RampRail activeStep={authenticated ? 1 : 0} />
        </div>

        <div className="mt-10">
          {!ready ? (
            <p className="text-paper/50 text-sm">Loading…</p>
          ) : authenticated ? (
            <div className="text-sm font-data">
              <p className="text-safe">
                Connected as{" "}
                {user?.email?.address ||
                  (smartAccountAddress
                    ? `${smartAccountAddress.slice(0, 6)}…${smartAccountAddress.slice(-4)}`
                    : "beginner wallet")}
              </p>
              {smartAccountAddress ? (
                <p className="text-paper/50 mt-1">
                  Smart account: {smartAccountAddress}
                </p>
              ) : (
                <div className="text-guide/80 mt-1 space-y-1">
                  {/* Auto-heal has the strongest signal — surface it first. If
                      the user has no embedded wallet, that IS the whole reason
                      the smart account is missing (see block comment on
                      useAutoHealEmbeddedWallet). Once the wallet lands, Privy
                      swaps in a real smart wallet client and this branch
                      unmounts on its own. */}
                  {!diag.hasEmbeddedWallet ? (
                    autoHeal.phase === "creating" ? (
                      <p className="text-paper/70">
                        Finishing wallet setup… this happens once per account.
                      </p>
                    ) : autoHeal.phase === "error" ? (
                      <div className="space-y-2">
                        <p className="text-risk break-words">
                          Wallet setup failed: {autoHeal.error}
                        </p>
                        <button
                          onClick={autoHeal.retry}
                          className="border border-paper/30 text-paper text-xs px-3 py-1 rounded hover:border-paper/60"
                        >
                          Retry wallet setup
                        </button>
                      </div>
                    ) : (
                      <p className="text-paper/60">
                        Setting up your wallet…
                      </p>
                    )
                  ) : (
                    <>
                      <p>Smart account not yet active.</p>
                      {/* Real error text from the live probe — readable on a
                          phone or iPad with no devtools. Do NOT collapse to a
                          friendly string; the raw message is the diagnostic. */}
                      {diag.probe?.errorMessage ? (
                        <p className="text-risk break-words">
                          Error ({diag.probe.errorName || "unknown"}):{" "}
                          {diag.probe.errorMessage}
                        </p>
                      ) : (
                        <p className="text-paper/60">
                          Probe phase: {diag.probe?.phase || "n/a"} (attempts:{" "}
                          {diag.probe?.attempts ?? 0})
                        </p>
                      )}
                    </>
                  )}
                  <p className="text-paper/50 text-xs">
                    Open “Show debug info” below for full config that Privy
                    actually built into this bundle.
                  </p>
                </div>
              )}
              {/* Debug panel ships in production intentionally. The bug we are
                  chasing only reproduces on the deployed site. */}
              <SmartWalletDebugPanel diag={{ ...diag, autoHeal }} />
            </div>
          ) : (
            <AuthEntry />
          )}
        </div>
      </header>

      {authenticated && (
        <main className="max-w-3xl mx-auto px-6 pb-16">
          <ChatTutor walletAddress={smartAccountAddress || user?.wallet?.address} />
          {/* Practice purchase needs the SMART account specifically — the
              embedded signer can't hold the tokens or be the buyer. */}
          <PracticeFlow smartAccountAddress={smartAccountAddress} />
          {/* Sibling to PracticeFlow — reads chain state to decide whether to
              show itself. Renders nothing until the user has either done the
              practice OR already graduated on-chain. */}
          <ReputationQuiz smartAccountAddress={smartAccountAddress} quizState={quizState} />
          <RealPurchaseFlow
            smartAccountAddress={smartAccountAddress}
            graduated={graduated}
            reputationOverall={quizState.onchain.overall}
          />
        </main>
      )}

      <footer className="max-w-3xl mx-auto px-6 pb-10 space-y-4">
        <NetworkBadge />
        <p className="text-paper/40 text-xs">
          The demo tokenized asset in this app is self-issued for the hackathon —
          it is not a real yield-bearing security. Digital assets are volatile;
          you can lose the value of what you put in.
        </p>
      </footer>
    </div>
  );
}
