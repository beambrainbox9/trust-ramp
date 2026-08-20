import { useState } from "react";
import { Link, usePathname } from "../router.jsx";

// Real TrustRamp mark — light/off-white version, for this dark header.
function Wordmark() {
  return (
    <img
      src="/brand/logo-wordmark-light.svg"
      alt="TrustRamp"
      className="h-7 w-auto sm:h-8"
    />
  );
}

const NAV = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About" },
  { to: "/#how-it-works", label: "How it works" },
];

export default function SiteHeader() {
  const [path] = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-paper/10 bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link to="/" className="shrink-0" onClick={() => setOpen(false)}>
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-8 sm:flex">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.to}
              onClick={(e) => {
                if (item.to.startsWith("/#")) return; // let in-page anchors behave natively
                e.preventDefault();
                window.history.pushState({}, "", item.to);
                window.dispatchEvent(new PopStateEvent("popstate"));
                window.scrollTo(0, 0);
              }}
              className={`text-sm transition hover:text-guide ${
                path === item.to ? "text-guide" : "text-paper/70"
              }`}
            >
              {item.label}
            </a>
          ))}
          <Link to="/app" className="btn-primary !px-4 !py-2 !min-h-0 text-xs">
            Launch app
          </Link>
        </nav>

        <button
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-paper/15 text-paper sm:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <div className="space-y-1.5">
            <span className="block h-0.5 w-5 bg-paper" />
            <span className="block h-0.5 w-5 bg-paper" />
            <span className="block h-0.5 w-5 bg-paper" />
          </div>
        </button>
      </div>

      {open && (
        <nav className="border-t border-paper/10 px-6 pb-5 pt-2 sm:hidden">
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <a
                key={item.label}
                href={item.to}
                onClick={(e) => {
                  setOpen(false);
                  if (item.to.startsWith("/#")) return;
                  e.preventDefault();
                  window.history.pushState({}, "", item.to);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                  window.scrollTo(0, 0);
                }}
                className="rounded-lg px-2 py-3 text-base text-paper/80 hover:bg-paper/5"
              >
                {item.label}
              </a>
            ))}
            <Link to="/app" onClick={() => setOpen(false)} className="btn-primary mt-2 w-full">
              Launch app
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
