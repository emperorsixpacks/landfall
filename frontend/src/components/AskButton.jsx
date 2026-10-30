import { useContext } from "react";
import { AskContext } from "../lib/askContext.js";

export default function AskButton({ context, question, title, className }) {
  const ask = useContext(AskContext);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); ask(context, question); }}
      title={title || `Ask about ${context?.label || context?.id || "this"}`}
      aria-label={title || `Ask about ${context?.label || context?.id || "this"}`}
      className={
        className ||
        "shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] leading-none text-muted hover:border-accent hover:text-text transition-colors"
      }
    >
      Ask
    </button>
  );
}
