import { useState, useEffect, useCallback } from "react";

// Minimal client-side router. No dependency added on purpose — the app has
// three static routes (/, /about, /app) and does not need react-router's
// nested-route machinery for that. Plain pathname state + History API.

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to) => {
    if (to !== window.location.pathname) {
      window.history.pushState({}, "", to);
    }
    setPath(to);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }, []);
  return [path, navigate];
}

// A same-app link that updates history without a full reload. Renders a real
// <a> (so middle-click / ctrl-click / "open in new tab" keep working) and only
// intercepts a plain left click.
export function Link({ to, className, children, onClick, ...rest }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onClick?.(e);
        window.history.pushState({}, "", to);
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
