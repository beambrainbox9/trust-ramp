import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import Reveal from "../components/Reveal.jsx";
import { Link } from "../router.jsx";

const HOW_IT_WORKS = [
  {
    title: "Sign in",
    body: "No seed phrase, no browser extension, no 12 words to write on a napkin and lose. A passkey creates your wallet in the background. If you can unlock your phone, you can do this.",
  },
  {
    title: "Learn from an AI that's looking at your actual wallet",
    body: "Not a script. Not a generic course. The tutor sees what's actually in your account — empty, or already holding something — and teaches from there. Ask it anything. It won't get bored of your questions.",
  },
  {
    title: "Practice with money that doesn't exist",
    body: "Before anything real is on the line, you run the entire purchase on a test network. Same steps, same screens, zero consequences if you get it wrong. Get it wrong on purpose, even. That's what it's there for.",
  },
  {
    title: "Prove it, then do it for real",
    body: 'A short conversation checks what actually stuck — slippage, approvals, custody, the stuff that costs people money. Pass it, and it\'s written on-chain: a verifiable, portable record that you know what you\'re doing. That record is what unlocks your first real transaction: small, capped, and you tap "approve" yourself. Nothing moves without you.',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />

      {/* --- Hero --- */}
      <section className="mx-auto max-w-5xl px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
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
            <span className="text-guide/60">·</span>
            <span>Human-approved</span>
            <span className="text-guide/60">·</span>
            <span>Verifiable on-chain</span>
          </div>
        </Reveal>
      </section>

      {/* --- Why this exists --- */}
      <section className="border-t border-paper/10 bg-surface/40">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <Reveal>
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

      {/* --- How it works (bento grid) --- */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-paper/10">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <Reveal>
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
                className={`rounded-2xl border border-paper/10 bg-surface p-6 sm:p-8 ${
                  i === 0 ? "sm:col-span-2" : ""
                }`}
              >
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

      {/* --- Not another course --- */}
      <section className="border-t border-paper/10 bg-surface/40">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <Reveal>
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              Everyone else stops at &quot;here&apos;s how it works.&quot; We walk you through
              actually doing it.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
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

      {/* --- Proof strip --- */}
      <section className="border-t border-paper/10">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <Reveal className="mx-auto max-w-2xl">
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              This isn&apos;t a simulation of a real transaction. It is one.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
              Every purchase settles on X Layer mainnet. Every approval, every transfer, every
              on-chain reputation score — public, verifiable, permanent. You don&apos;t have to
              take our word for any of it. Click the transaction hash. Check it yourself.
            </p>
          </Reveal>
        </div>
      </section>

      {/* --- Final CTA --- */}
      <section className="border-t border-paper/10 bg-surface/40">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <Reveal className="mx-auto max-w-2xl">
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              Your first transaction is coming eventually. Might as well make it a good one.
            </h2>
            <div className="mt-8 flex justify-center">
              <Link to="/app" className="btn-primary">
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
