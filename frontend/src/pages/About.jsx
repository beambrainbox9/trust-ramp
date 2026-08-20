import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import Reveal from "../components/Reveal.jsx";
import { Link } from "../router.jsx";

export default function About() {
  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />

      {/* --- Hero --- */}
      <section className="mx-auto max-w-4xl px-6 pt-16 pb-16 sm:pt-24">
        <Reveal>
          <h1 className="font-display text-4xl leading-tight text-paper sm:text-5xl">
            We built TrustRamp because the crypto industry keeps blaming users for a problem it
            designed.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-paper/70 sm:text-lg">
            Nobody wakes up wanting to lose money on their first transaction. They just
            weren&apos;t given anything better than &quot;good luck.&quot;
          </p>
        </Reveal>
      </section>

      {/* --- What this isn't — kept high per the copy's own build notes --- */}
      <section className="border-t border-paper/10 bg-surface/40">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <Reveal>
            <h2 className="font-display text-2xl text-paper sm:text-3xl">
              We&apos;d rather tell you the truth than sound impressive.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
              The asset you practice buying is a demo asset we built for this — not a real
              yield-bearing security, and we say so everywhere it appears, on-chain and in the
              app. Any &quot;yield&quot; you see in the practice flow is illustrative, not real
              money growing. The AI tutor teaches you what these mechanics mean. It is not a
              financial advisor, and nothing it says should be treated as investment advice. And
              right now, every real transaction requires your explicit, one-tap approval — on
              purpose. We could make this fully automatic. We&apos;re choosing not to, until a
              human-approved version has proven itself safe first. That&apos;s not a limitation
              we&apos;re stuck with. It&apos;s a decision we&apos;re standing behind.
            </p>
          </Reveal>
        </div>
      </section>

      {/* --- The problem --- */}
      <section className="border-t border-paper/10">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <Reveal>
            <h2 className="font-display text-2xl text-paper sm:text-3xl">
              Crypto doesn&apos;t have a trust problem. It has a first-time problem.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
              Somewhere between 73% and 81% of people who buy their first crypto lose money on it
              — not because the market is rigged, but because nobody explained what they were
              actually doing until after they&apos;d already done it. Over $2.7 billion has been
              drained from wallets through &quot;approval phishing&quot; alone: a scam that only
              works because most people don&apos;t understand what they&apos;re agreeing to when
              they click &quot;approve.&quot; It gets worse before it gets better. Roughly
              two-thirds of people who connect a wallet to a crypto app never complete a single
              transaction with it. They open the door, look inside, and leave — because the room
              is unfamiliar and the stakes feel too high to guess. There are over 600 million
              crypto wallets in the world and, by some estimates, fewer than 60 million of them
              are used with any regularity. That gap isn&apos;t a lack of interest. It&apos;s a
              lack of anywhere safe to learn. Every existing &quot;solution&quot; treats this as a
              content problem — write an article, record a video, publish a glossary. But you
              don&apos;t learn to drive by reading about driving. You learn by sitting in the car,
              in a parking lot, with someone next to you, before anyone lets you near a highway.
              Nobody had built the parking lot. So we did.
            </p>
            <p className="mt-6 text-xs text-paper/35">
              (Sources: BIS Working Paper No. 1049, 2022; Chainalysis 2025 Crypto Crime Report;
              Blockchain-Ads User Acquisition Trends Report 2026; a16z State of Crypto 2024;
              Crypto.com wallet estimates, 2024)
            </p>
          </Reveal>
        </div>
      </section>

      {/* --- What we're building toward --- */}
      <section className="border-t border-paper/10 bg-surface/40">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <Reveal>
            <h2 className="font-display text-2xl text-paper sm:text-3xl">
              Understanding you can prove, before money you can lose.
            </h2>
            <div className="mt-6 space-y-5 text-base leading-relaxed text-paper/70 sm:text-lg">
              <p>
                Our mission is small and specific: make sure nobody&apos;s first real crypto
                transaction is also their first real crypto mistake.
              </p>
              <p>
                Our vision is bigger. We think &quot;I understand how this works&quot; should be
                something you can actually demonstrate — not a box you check, not a certificate
                nobody reads, but a real, on-chain, verifiable record that follows you. A record
                other apps could eventually trust the same way a credit history gets trusted: not
                because you say you&apos;re ready, but because you can prove it.
              </p>
              <p>
                We think that record should be earned the same way real competence is earned
                anywhere else — by doing the thing, safely, first, with someone watching who can
                catch you before it costs you anything.
              </p>
              <p>
                Most people who&apos;ve never bought crypto aren&apos;t apathetic about it.
                They&apos;re scared of losing money, and they&apos;re lost in the jargon. That&apos;s
                the real shape of the gap between over 600 million crypto wallets and the fewer
                than 60 million used with any regularity — not disinterest, fear and confusion,
                compounding every time someone opens an app and doesn&apos;t know what a button
                does. Not another feature. Not more content. Proof, at the exact moment before
                anything real is on the line, that you understood what you were about to do — that&apos;s
                the bet TrustRamp is built on.
              </p>
              <p>
                And we think this shouldn&apos;t be complicated enough to need a computer science
                degree to attempt. If a curious 12-year-old could sit down, get taught in plain
                language, practice without risk, and walk away actually understanding what a
                wallet approval does — that&apos;s not a stretch goal. That&apos;s the actual bar
                we&apos;re building to.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* --- Why this, why now --- */}
      <section className="border-t border-paper/10">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <Reveal>
            <h2 className="font-display text-2xl text-paper sm:text-3xl">
              The tools to do this properly finally exist.
            </h2>
            <p className="mt-6 text-base leading-relaxed text-paper/70 sm:text-lg">
              Wallets that don&apos;t require a seed phrase. AI that can actually teach, not just
              answer. Blockchains fast and cheap enough that a small real transaction doesn&apos;t
              cost more in fees than it&apos;s worth. Two years ago, building this responsibly —
              with real human approval on every step, with a real spending cap enforced where a
              user can&apos;t quietly bypass it, with a real test run before anything real — would
              have been slower, clunkier, and probably less honest about what it actually was. We
              built TrustRamp on X Layer for that reason. Fast, low-cost, and it let us do the
              thing that actually matters: keep every single real transaction small, capped, and
              gated behind a human tap — not an AI deciding on your behalf, not a &quot;trust
              us.&quot; You approve. Every time.
            </p>
          </Reveal>
        </div>
      </section>

      {/* --- Closing --- */}
      <section className="border-t border-paper/10 bg-surface/40">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <Reveal>
            <h2 className="font-display text-3xl text-paper sm:text-4xl">
              Come practice before you play for real.
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-paper/70 sm:text-lg">
              It takes about ten minutes, costs you nothing until you decide otherwise, and ends
              with something most people never get from their first time in crypto: proof, in your
              own hands, that you actually understood what you were doing.
            </p>
            <div className="mt-8 flex justify-center">
              <Link to="/app" className="btn-primary">
                Try TrustRamp
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
