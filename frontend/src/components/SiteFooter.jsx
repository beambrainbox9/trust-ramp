import { Link } from "../router.jsx";
import NetworkBadge from "./NetworkBadge.jsx";

const CONTACT_EMAIL = "mobabst@gmail.com";

const LINK_ITEMS = [
  { label: "About", to: "/about", internal: true },
  { label: "How it works", to: "/#how-it-works", internal: false },
  {
    label: "Explorer",
    to: "https://www.okx.com/web3/explorer/xlayer",
    internal: false,
    external: true,
  },
  { label: "GitHub", to: "https://github.com", internal: false, external: true },
  { label: "X (Twitter)", to: "https://twitter.com", internal: false, external: true },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-paper/10">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <img src="/brand/logo-wordmark-light.svg" alt="TrustRamp" className="h-6 w-auto" />
            <p className="mt-3 text-sm text-paper/50">
              The safe way into your first real crypto purchase.
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {LINK_ITEMS.map((item) =>
              item.internal ? (
                <Link key={item.label} to={item.to} className="text-paper/60 hover:text-guide transition">
                  {item.label}
                </Link>
              ) : (
                <a
                  key={item.label}
                  href={item.to}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noreferrer" : undefined}
                  className="text-paper/60 hover:text-guide transition"
                >
                  {item.label}
                </a>
              )
            )}
          </nav>

          {/* Contact email is never printed as plain text — it lives only in
              this mailto href, per the Step 6 requirement. */}
          <a href={`mailto:${CONTACT_EMAIL}`} className="btn-secondary shrink-0">
            Contact us
          </a>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-paper/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <NetworkBadge />
          <p className="max-w-2xl text-xs leading-relaxed text-paper/35">
            The demo tokenized asset used in this app is self-issued for the hackathon and is not
            a real yield-bearing security. Digital assets are volatile — you can lose the value of
            what you put in.
          </p>
        </div>
      </div>
    </footer>
  );
}
