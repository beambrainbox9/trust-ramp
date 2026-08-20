import { Link } from "../router.jsx";
import NetworkBadge from "./NetworkBadge.jsx";

const CONTACT_EMAIL = "mobabst@gmail.com";

export default function SiteFooter() {
  return (
    <footer className="bg-surface border-t border-paper/10">
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-8">
        {/* --- Three-column grid --- */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {/* Column 1: Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <img src="/brand/logo-wordmark-light.svg" alt="TrustRamp" className="h-6 w-auto" />
            <p className="mt-3 text-sm text-paper/50 max-w-xs">
              The safe way into your first real crypto purchase.
            </p>
            {/* Social icons */}
            <div className="mt-5 flex items-center gap-4">
              <a
                href="https://github.com/beambrainbox9/trust-ramp"
                target="_blank"
                rel="noreferrer"
                className="text-paper/40 hover:text-guide transition"
                aria-label="GitHub"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M10 0C4.477 0 0 4.477 0 10c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0110 4.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C17.138 18.163 20 14.418 20 10c0-5.523-4.477-10-10-10z" clipRule="evenodd" />
                </svg>
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noreferrer"
                className="text-paper/40 hover:text-guide transition"
                aria-label="X (Twitter)"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M11.903 8.476L18.355 1h-1.529l-5.604 6.494L6.89 1H1l6.766 9.82L1 18.354h1.529l5.917-6.858L13.11 18.354H19L11.903 8.476zm-2.095 2.427l-.686-.978L3.2 2.16h2.348l4.403 6.282.686.978 5.722 8.16h-2.348l-4.703-6.697z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Column 2: Navigation */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h4 className="font-data text-xs uppercase tracking-widest text-paper/40 mb-4">Product</h4>
              <nav className="flex flex-col gap-3">
                <Link to="/" className="text-sm text-paper/60 hover:text-guide transition">
                  Home
                </Link>
                <a href="/#how-it-works" className="text-sm text-paper/60 hover:text-guide transition">
                  How it works
                </a>
                <Link to="/app" className="text-sm text-paper/60 hover:text-guide transition">
                  Launch app
                </Link>
              </nav>
            </div>
            <div>
              <h4 className="font-data text-xs uppercase tracking-widest text-paper/40 mb-4">Company</h4>
              <nav className="flex flex-col gap-3">
                <Link to="/about" className="text-sm text-paper/60 hover:text-guide transition">
                  About
                </Link>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="text-sm text-paper/60 hover:text-guide transition"
                >
                  Contact
                </a>
              </nav>
            </div>
          </div>

          {/* Column 3: Network info */}
          <div>
            <h4 className="font-data text-xs uppercase tracking-widest text-paper/40 mb-4">Network</h4>
            <NetworkBadge />
            <p className="mt-3 text-xs text-paper/35">
              Built on X Layer — fast, low-cost, and purpose-built for DeFi onboarding.
            </p>
          </div>
        </div>

        {/* --- Bottom bar --- */}
        <div className="mt-12 border-t border-paper/10 pt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-2xl text-xs leading-relaxed text-paper/35">
            The demo tokenized asset used in this app is self-issued for the hackathon and is not
            a real yield-bearing security. Digital assets are volatile — you can lose the value of
            what you put in.
          </p>
          <p className="text-xs text-paper/30 shrink-0">
            &copy; 2026 TrustRamp
          </p>
        </div>
      </div>
    </footer>
  );
}
