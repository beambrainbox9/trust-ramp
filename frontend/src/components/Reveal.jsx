import { useScrollReveal } from "../hooks/useScrollReveal.js";

// Wraps a section in the fade/slide-in-on-scroll treatment. `as` lets callers
// pick the right element (section/div) without duplicating the hook wiring.
export default function Reveal({ as: Tag = "div", className = "", delay = 0, children, ...rest }) {
  const ref = useScrollReveal();
  return (
    <Tag
      ref={ref}
      className={`fade-in-up ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
