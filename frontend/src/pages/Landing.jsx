import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import Reveal from "../components/Reveal.jsx";
import { Link } from "../router.jsx";

const HOW_IT_WORKS = [
  {
    title: "Sign in",
    body: "No seed phrase, no browser extension, no 12 words to write on a napkin and lose. A passkey creates your wallet in the background. If you can unlock your phone, you can do this.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10 text-guide" aria-hidden="true">
        <rect x="14" y="20" width="20" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
        <path d="M20 20v-5a4 4 0 0 1 8 0v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="24" cy="30" r="2" fill="currentColor" />
        <path d="M24 32v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Learn from an AI that's looking at your actual wallet",
    body: "Not a script. Not a generic course. The tutor sees what's actually in your account — empty, or already holding something — and teaches from there. Ask it anything. It won't get bored of your questions.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10 text-guide" aria-hidden="true">
        <rect x="8" y="12" width="24" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
        <path d="M8 26l-2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="21" r="1.5" fill="currentColor" />
        <circle cx="22" cy="21" r="1.5" fill="currentColor" />
        <path d="M14 25c1 1.5 3.5 2.5 6 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M36 16l4-2m-4 6h4m-4 4l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      </svg>
    ),
  },
  {
    title: "Practice with money that doesn't exist",
    body: "Before anything real is on the line, you run the entire purchase on a test network. Same steps, same screens, zero consequences if you get it wrong. Get it wrong on purpose, even. That's what it's there for.",
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10 text-guide" aria-hidden="true">
        <path d="M18 36V18a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M26 28v5a3 3 0 0 0 3 3h0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="22" cy="24" r="2" fill="currentColor" opacity="0.6" />
        <path d="M14 36h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M30 14l2-4m4 8h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  {
    title: "Prove it, then do it for real",
    body: 'A short conversation checks what actually stuck — slippage, approvals, custody, the stuff that costs people money. Pass it, and it\'s written on-chain: a verifiable, portable record that you know what you\'re doing. That record is what unlocks your first real transaction: small, capped, and you tap "approve" yourself. Nothing moves without you.',
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10 text-guide" aria-hidden="true">
        <path d="M24 8l12 6v10c0 8-5.5 14-12 16C17.5 38 12 32 12 24V14l12-6z" stroke="currentColor" strokeWidth="2" />
        <path d="M18 24l4 4 8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

// Decorative blockchain nodes SVG for the proof strip
function ChainGraphic() {
  return (
    <svg
      viewBox="0 0 320 80"
      fill="none"
      className="w-full max-w-xs mx-auto opacity-[0.08]"
      aria-hidden="true"
    >
      <circle cx="40" cy="40" r="12" stroke="#F2661C" strokeWidth="1.5" />
      <circle cx="120" cy="40" r="12" stroke="#F2661C" strokeWidth="1.5" />
      <circle cx="200" cy="40" r="12" stroke="#F2661C" strokeWidth="1.5" />
      <circle cx="280" cy="40" r="12" stroke="#F2661C" strokeWidth="1.5" />
      <line x1="52" y1="40" x2="108" y2="40" stroke="#F2661C" strokeWidth="1.5" />
      <line x1="132" y1="40" x2="188" y2="40" stroke="#F2661C" strokeWidth="1.5" />
      <line x1="212" y1="40" x2="268" y2="40" stroke="#F2661C" strokeWidth="1.5" />
      <circle cx="40" cy="40" r="4" fill="#F2661C" opacity="0.4" />
      <circle cx="120" cy="40" r="4" fill="#F2661C" opacity="0.4" />
      <circle cx="200" cy="40" r="4" fill="#F2661C" opacity="0.4" />
      <circle cx="280" cy="40" r="4" fill="#F2661C" opacity="0.4" />
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />

      {/* --- Hero --- */}
      <section className="relative overflow-hidden">
        {/* Gradient glow */}
        <div className="gradient-glow -top-40 -right-40 sm:right-10 absolute" />
        {/* Dot pattern overlay */}
        <div className="absolute inset-0 dot-pattern" />

        <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <Reveal className="max-w-3xl">
            <p className="font-data text-xs uppercase tracking-widest text-guide">
              Built on X Layer
            </p>
            <h1 className="mt-5 font-display text-4xl leading-tight text-paper sm:text-5xl md:text-6xl">
              Your first crypto purchase shouldn&apos;t be a coin flip.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-paper/70 sm:text-lg">
              Most people who try DeFi lose money before they understand what happened. TrustRamp
              teaches you the mechanics on a practice account, checks that it actually landed, and
              only then walks you through one real, small, human-approved purchase — with an AI
              tutor next to you the whole way.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link to="/app" className="btn-primary">
                Start free — no wallet needed
              </Link>
              <a href="#how-it-works" className="btn-secondary">
                See how it works ↓
              </a>
            </div>

            <p className="mt-5 text-sm text-paper/45">
              No seed phrase to lose. No app to install. Sign in with a passkey and you&apos;re in.
            </p>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-data text-xs uppercase tracking-wide text-paper/40">
              <span>Self-custodial</span>
              <span className="text-guide/60">&middot;</span>
              <span>Human-approved</span>
              <span className="text-guide/60">&middot;</span>
              <span>Verifiable on-chain</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Divider */}
      <div className="section-divider" />

      {/* --- Why this exists --- */}
      <section className="relative overflow-hidden bg-surface/40">
        {/* Decorative shield watermark */}
        <svg
          viewBox="0 0 200 240"
          fill="none"
          className="absolute -right-10 top-8 w-48 sm:w-64 opacity-[0.04]"
          aria-hidden="true"
        >
          <path
            d="M100 10l80 35v60c0 55-35 95-80 110C55 200 20 160 20 105V45l80-35z"
            stroke="#F2661C"
            strokeWidth="4"
          />
          <path
            d="M100 40l55 24v42c0 38-24 65-55 76-31-11-55-38-55-76V64l55-24z"
            stroke="#F2661C"
            strokeWidth="2"
            opacity="0.5"
          />
        </svg>

        <div className="relative mx-auto max-w-4xl px-6 py-20">
          <Reveal>
            <span className="section-label">Why this exists</span>
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              Nobody fails at crypto because they&apos;re not smart enough.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
              They fail because the first real transaction they ever make is also the one with the
              least room for error — and nobody checked if they were ready. An estimated{" "}
              <span className="text-guide">73–81%</span> of retail investors have lost money on
              their first crypto investment. Over <span className="text-guide">$2.7 billion</span>{" "}
              has disappeared to &quot;approval phishing&quot; alone — people signing away
              permission to move their tokens without realizing what they&apos;d agreed to. And
              it&apos;s not that people don&apos;t want in: there are more than 600 million crypto
              wallets in the world, but only a fraction of them are ever used more than once. Most
              people connect a wallet, get overwhelmed, and never come back. That&apos;s not a
              knowledge gap you fix with an article. It&apos;s a confidence gap you fix by
              practicing first.
            </p>
            <p className="mt-6 text-xs text-paper/35">
              (Sources: BIS Working Paper No. 1049; Chainalysis 2025 Crypto Crime Report; a16z
              State of Crypto 2024)
            </p>
          </Reveal>
        </div>
      </section>

      {/* Divider */}
      <div className="section-divider" />

      {/* --- How it works (bento grid) --- */}
      <section id="how-it-works" className="scroll-mt-20">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <Reveal>
            <span className="section-label">How it works</span>
            <h2 className="max-w-2xl font-display text-3xl text-paper sm:text-4xl">
              Four steps. One of them uses real money — and only after you&apos;ve proven
              you&apos;re ready for it.
            </h2>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {HOW_IT_WORKS.map((card, i) => (
              <Reveal
                key={card.title}
                delay={i * 80}
                className={`bento-card ${
                  i === 0 ? "sm:col-span-2 bg-gradient-to-br from-guide/[0.04] to-transparent" : ""
                }`}
              >
                <div className="mb-4">{card.icon}</div>
                <span className="font-data text-xs text-guide">0{i + 1}</span>
                <h3 className="mt-3 font-display text-xl text-paper sm:text-2xl">{card.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-paper/65 sm:text-base">
                  {card.body}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="section-divider" />

      {/* --- Not another course --- */}
      <section className="bg-surface/40">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <Reveal>
            <span className="section-label">Not another course</span>
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              Everyone else stops at &quot;here&apos;s how it works.&quot; We walk you through
              actually doing it.
            </h2>

            {/* Visual comparison */}
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-paper/10 bg-ink/60 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-paper/30" />
                  <span className="font-data text-xs uppercase tracking-wide text-paper/40">Others</span>
                </div>
                <ul className="space-y-3 text-sm text-paper/50">
                  <li className="flex items-start gap-2">
                    <span className="text-paper/30 mt-0.5">&#8212;</span>
                    <span>Simulated wallets</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-paper/30 mt-0.5">&#8212;</span>
                    <span>Generic articles and videos</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-paper/30 mt-0.5">&#8212;</span>
                    <span>Built for developers</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-risk/60 mt-0.5">&#10005;</span>
                    <span className="text-paper/40">Stop before the real transaction</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-guide/20 bg-guide/[0.03] p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-guide" />
                  <span className="font-data text-xs uppercase tracking-wide text-guide">TrustRamp</span>
                </div>
                <ul className="space-y-3 text-sm text-paper/70">
                  <li className="flex items-start gap-2">
                    <span className="text-safe mt-0.5">&#10003;</span>
                    <span>AI tutor that sees your actual wallet</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-safe mt-0.5">&#10003;</span>
                    <span>Real practice on testnet</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-safe mt-0.5">&#10003;</span>
                    <span>Proof of understanding on-chain</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-guide mt-0.5">&#10003;</span>
                    <span className="text-paper">Your first real, human-approved purchase</span>
                  </li>
                </ul>
              </div>
            </div>

            <p className="mt-8 text-base leading-relaxed text-paper/70 sm:text-lg">
              MetaMask Learn simulates a wallet. Coinbase Learn gives you articles. LearnWeb3 is
              built for developers, not for someone buying their first token. All of them stop
              short of the moment that actually matters — the first real transaction. TrustRamp
              doesn&apos;t. It&apos;s the only place where an AI that knows your wallet teaches
              you, a test run proves you understood it, and a real purchase — small, capped,
              entirely your call — closes the loop. Everything before that purchase is rehearsal.
              The purchase is real.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Divider */}
      <div className="section-divider" />

      {/* --- Proof strip --- */}
      <section className="relative overflow-hidden">
        {/* Chain graphic behind */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <ChainGraphic />
        </div>

        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center">
          <Reveal className="mx-auto max-w-2xl">
            <span className="section-label">Verifiable</span>
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              This isn&apos;t a simulation of a real transaction. It is one.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
              Every purchase settles on X Layer mainnet. Every approval, every transfer, every
              on-chain reputation score — public, verifiable, permanent. You don&apos;t have to
              take our word for any of it. Click the transaction hash. Check it yourself.
            </p>

            {/* Animated pulse indicator */}
            <div className="mt-8 flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-safe animate-subtle-pulse" />
              <span className="font-data text-xs text-safe/70 uppercase tracking-wide">Live on-chain</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Divider */}
      <div className="section-divider" />

      {/* --- Final CTA --- */}
      <section className="relative overflow-hidden bg-surface/40">
        {/* Warm gradient background */}
        <div className="absolute inset-0 bg-gradient-to-t from-guide/[0.04] to-transparent pointer-events-none" />

        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center">
          <Reveal className="mx-auto max-w-2xl">
            <h2 className="font-display text-3xl text-paper sm:text-4xl md:text-5xl">
              Your first transaction is coming eventually. Might as well make it a good one.
            </h2>
            <div className="mt-10 flex justify-center">
              <Link to="/app" className="btn-primary text-base !px-8 !py-4">
                Start free
              </Link>
            </div>
            <p className="mt-5 text-sm text-paper/45">
              Takes about 10 minutes. No card, no seed phrase, no risk until you say so.
            </p>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
