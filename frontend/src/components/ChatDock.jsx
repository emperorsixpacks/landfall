import React, { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useMotion";

export default function ChatDock({ result, askRequest, onAskHandled }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [context, setContext] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | streaming
  const [unread, setUnread] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const abortRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const reduced = useReducedMotion();

  const starterChips = useMemoStarter(result);
  const suggestChips = starterChips.slice(0, 2);

  // Suggestion chips fade in after 1.5s of idleness on first load.
  useEffect(() => {
    const t = setTimeout(() => { if (!hasInteracted) setShowChips(true); }, 1500);
    return () => clearTimeout(t);
  }, [hasInteracted]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, status]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Ask-about-this from the report opens the dock with a context chip + question.
  useEffect(() => {
    if (!askRequest) return;
    setOpen(true);
    setUnread(false);
    setContext(askRequest.context || null);
    setInput(askRequest.question || "");
    onAskHandled?.();
  }, [askRequest]);

  // Global keys: "/" opens, Cmd/Ctrl+K toggles, Esc closes.
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setUnread(false);
      inputRef.current?.focus();
    }
  }, [open]);

  function send(text) {
    const q = (text ?? input).trim();
    if (!q && !context) return;
    if (status === "loading" || status === "streaming") return;

    setHasInteracted(true);
    setShowChips(false);

    const history = messages
      .filter((m) => !m.pending && !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.text }));

    const ctx = context;
    setMessages((prev) => [...prev, { id: uid(), role: "user", text: q }]);
    setInput("");
    setContext(null);
    setStatus("loading");

    const assistantId = uid();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", text: "", streaming: true, pending: null, evidence: [] }]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: result.run_id, message: q, context: ctx, history }),
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 429) { markError(assistantId, "Too many questions, try again in a minute."); return null; }
        if (!res.ok || !res.body) { markError(assistantId, "Couldn't reach the model. Retry."); return null; }
        return res.body;
      })
      .then(async (body) => {
        if (!body) return;
        setStatus("streaming");
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let evList = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const ev = parseSSE(part);
            if (!ev) continue;
            if (ev.event === "token") {
              append(assistantId, ev.data.text);
            } else if (ev.event === "tool_start") {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: ev.data.label || "Working…" } : m)));
            } else if (ev.event === "tool_end") {
              evList = [...evList, ...(ev.data.evidence || [])];
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, pending: null, evidence: evList } : m)));
            } else if (ev.event === "done") {
              evList = [...evList, ...(ev.data.evidence || [])];
            } else if (ev.event === "error") {
              markError(assistantId, ev.data.message || "Couldn't reach the model. Retry.");
              return;
            }
          }
        }
        finalize(assistantId, evList);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        markError(assistantId, "Couldn't reach the model. Retry.");
      });
  }

  function append(id, chunk) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text + chunk } : m)));
  }
  function finalize(id, evidence) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false, evidence } : m)));
    setStatus("idle");
    if (!open) setUnread(true);
    inputRef.current?.focus();
  }
  function markError(id, msg) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false, pending: null, error: msg } : m)));
    setStatus("idle");
  }
  function stop() {
    abortRef.current?.abort();
    setStatus("idle");
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-center px-4 print:hidden"
      style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
    >
      {open && (
        <div
          role="dialog"
          aria-label="Ask Landfall"
          className={`dock-pop mb-2 flex w-[min(720px,calc(100%-32px))] flex-col overflow-hidden rounded-[14px] border border-border bg-panel max-h-[calc(100dvh-120px)] md:max-h-[min(60vh,560px)] ${
            reduced ? "" : "opacity-100"
          }`}
        >
          {/* Window header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-small font-semibold text-text">Ask Landfall</span>
              {context && (
                <span className="rounded-pill border border-accent/40 bg-raised px-2 py-0.5 font-mono text-[10px] text-accent">
                  {context.type}{context.id ? `: ${context.id}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setMessages([])} className="text-small text-muted hover:text-text">New chat</button>
              <button onClick={() => { setOpen(false); triggerRef.current?.focus(); }} aria-label="Minimize" className="text-muted hover:text-text">–</button>
            </div>
          </div>

          {/* Messages */}
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-small text-muted">Ask about this run.</p>
                {starterChips.map((q) => (
                  <button key={q} onClick={() => send(q)} className="block w-full rounded-control border border-border px-3 py-2 text-left text-small text-text hover:border-accent">
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <Message key={m.id} m={m} reduced={reduced} />
            ))}
            {status === "loading" && (
              <div className="flex items-center gap-2 text-small text-muted">
                <Dots reduced={reduced} />
                <span>Thinking…</span>
              </div>
            )}
            <p className="pt-1 text-[10px] leading-relaxed text-muted">
              Answers come from this run's data. Qloo values are affinity, not chart data.
            </p>
          </div>

          {/* Composer */}
          <div className="border-t border-border p-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value.slice(0, 500)); autoGrow(e.target); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about this run…"
              rows={1}
              aria-label="Ask Landfall"
              className="max-h-24 w-full resize-none rounded-control border border-border bg-raised p-2 text-small text-text placeholder:text-muted outline-none focus:border-accent"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
              <span>{status === "streaming" ? <button onClick={stop} className="text-muted hover:text-text">Stop</button> : <span>Enter to send · Shift+Enter for newline</span>}</span>
              <span className="num">{input.length}/500</span>
            </div>
          </div>
        </div>
      )}

      {/* Suggestion chips */}
      {!open && showChips && !hasInteracted && suggestChips.length > 0 && (
        <div className="mb-2 flex w-[min(720px,calc(100%-32px))] flex-col items-center gap-2">
          {suggestChips.map((q) => (
            <button
              key={q}
              onClick={() => { setOpen(true); send(q); }}
              className="dock-chip rounded-pill border border-border bg-panel px-3 py-1.5 text-small text-text hover:border-accent"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Collapsed bar */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[52px] w-[min(720px,calc(100%-32px))] items-center gap-3 rounded-[14px] border border-[#3A4350] bg-[#15171C] px-4 text-left hover:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent"
        aria-label="Ask Landfall about this run"
      >
        <img src="/landfall-mark.svg" alt="" className="h-5 w-5" />
        <span className="flex-1 truncate text-body text-muted">Ask Landfall about this run</span>
        {unread && <span className="h-2 w-2 rounded-full bg-accent" />}
        <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">/</kbd>
      </button>
    </div>
  );
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 96) + "px";
}

function Message({ m, reduced }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-raised px-3 py-2 text-small text-text">{m.text}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[15px] leading-relaxed text-text">
        {m.error ? (
          <span className="text-danger">{m.error}</span>
        ) : m.text ? (
          <span className="whitespace-pre-wrap">{m.text}{m.streaming && <Caret reduced={reduced} />}</span>
        ) : (
          <span className="text-muted">{m.pending || ""}</span>
        )}
      </div>
      {m.pending && !m.text && (
        <div className="flex items-center gap-2 font-mono text-small text-muted">
          <Dots reduced={reduced} />
          <span>{m.pending}</span>
        </div>
      )}
      {m.evidence?.length > 0 && <EvidenceChips evidence={m.evidence} />}
    </div>
  );
}

function EvidenceChips({ evidence }) {
  const seen = new Set();
  const unique = evidence.filter((e) => {
    const k = `${e.kind}:${e.label}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
  return (
    <div className="flex flex-wrap gap-1.5">
      {unique.map((e, i) => (
        <button
          key={i}
          onClick={() => jumpToRef(e.ref)}
          className="flex items-center gap-1 rounded-pill border border-border bg-raised px-2 py-0.5 font-mono text-[10px] text-muted hover:border-accent hover:text-text"
        >
          <span className="uppercase">{e.kind}</span>
          {e.label ? <span className="text-text">· {e.label}</span> : null}
          {e.ref?.startsWith("step:") && <span className="text-accent">{e.ref.slice(5)}</span>}
        </button>
      ))}
    </div>
  );
}

function jumpToRef(ref) {
  if (!ref) return;
  let el = null;
  if (ref.startsWith("section:")) el = document.getElementById("section-" + ref.slice(8));
  else if (ref.startsWith("step:")) el = document.getElementById("section-trace");
  else if (ref === "panel:lyrics") el = document.getElementById("lyrics-panel") || document.getElementById("lyrics-card");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) {
    const prev = el.style.boxShadow;
    el.style.boxShadow = "0 0 0 2px var(--accent)";
    el.style.transition = "box-shadow 150ms ease";
    setTimeout(() => { el.style.boxShadow = prev; }, 600);
  }
}

function Dots({ reduced }) {
  return (
    <span className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full bg-muted ${reduced ? "" : "animate-pulse"}`} style={reduced ? undefined : { animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

function Caret({ reduced }) {
  if (reduced) return null;
  return <span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-accent align-middle" />;
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function useMemoStarter(result) {
  return React.useMemo(() => {
    const chips = [];
    const markets = (result.markets || []).filter((m) => m.score != null);
    if (markets[0]) chips.push(`Why is ${markets[0].country} ranked first?`);
    if ((result.clips || []).length > 0) chips.push("Which clip should I post first?");
    if (result.fit_score != null) chips.push("What drove the fit score?");
    if (markets[1]) chips.push(`Compare ${markets[0].country} and ${markets[1].country}`);
    return chips.slice(0, 4);
  }, [result]);
}

function parseSSE(part) {
  let event = "message";
  let data = "";
  for (const line of part.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
