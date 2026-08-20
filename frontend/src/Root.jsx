import { usePathname } from "./router.jsx";
import Landing from "./pages/Landing.jsx";
import About from "./pages/About.jsx";
import App from "./App.jsx";

// Three static routes: "/" (new landing page), "/about" (new about page),
// and "/app" (the existing onboarding flow, unchanged in behavior — this
// file only decides which page component mounts for a given pathname).
export default function Root() {
  const [path] = usePathname();

  if (path === "/about") return <About />;
  if (path.startsWith("/app")) return <App />;
  return <Landing />;
}
