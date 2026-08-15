// Single source of truth for the backend base URL.
//
// WHY THIS EXISTS. In dev, Vite proxies `/api` → localhost:8787, so plain
// `fetch("/api/chat")` works. In production the frontend is on Vercel and the
// backend is on Render at a completely different origin — a relative `/api/…`
// path would hit Vercel and 404. Every fetch site now goes through apiUrl()
// so the same code works in both environments.
//
// If VITE_API_BASE_URL is unset (dev), we keep the current relative behaviour
// and Vite's proxy handles it. In production Vercel MUST have this set to the
// full Render URL, e.g. https://trustramp-backend.onrender.com — with no
// trailing slash, since apiUrl() appends the path directly.
const RAW = import.meta.env.VITE_API_BASE_URL || "";
const BASE = RAW.replace(/\/+$/, ""); // tolerate a trailing slash if someone typos it

/**
 * Build a full backend URL from an /api path. Path MUST start with a slash.
 * Returns the path unchanged when BASE is empty — Vite's dev proxy handles it.
 */
export function apiUrl(path) {
  if (!path.startsWith("/")) {
    throw new Error(`apiUrl path must start with "/", got: ${path}`);
  }
  return BASE ? `${BASE}${path}` : path;
}
