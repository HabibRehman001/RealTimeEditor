import { useState, useRef, useCallback, useEffect } from "react";

/* ── Output types ── */
const T = {
  LOG: "log", WARN: "warn", ERROR: "error",
  INFO: "info", CLEAR: "clear", RESULT: "result", TIME: "time",
};

const ICONS = {
  [T.LOG]: "▸", [T.WARN]: "⚠", [T.ERROR]: "✕",
  [T.INFO]: "ℹ", [T.RESULT]: "→", [T.TIME]: "⏱",
};

/* ── Serialize any JS value for display ── */
const serialize = (val) => {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "function") return `[Function: ${val.name || "anonymous"}]`;
  if (typeof val === "symbol") return val.toString();
  if (val instanceof Error) return `${val.name}: ${val.message}\n${val.stack || ""}`;
  if (typeof val === "object") {
    try { return JSON.stringify(val, null, 2); } catch { return String(val); }
  }
  return String(val);
};

/* ── Core sandboxed execution engine ── */
const runCode = (code) => {
  const entries = [];
  const startTime = performance.now();

  const capture = (type) => (...args) => {
    entries.push({
      type,
      text: args.map(serialize).join(" "),
      ts: performance.now() - startTime,
    });
  };

  const fakeConsole = {
    log: capture(T.LOG),
    warn: capture(T.WARN),
    error: capture(T.ERROR),
    info: capture(T.INFO),
    debug: capture(T.LOG),
    dir: capture(T.LOG),
    table: (data) => {
      try {
        entries.push({ type: T.LOG, text: JSON.stringify(data, null, 2), ts: performance.now() - startTime });
      } catch {
        capture(T.LOG)(data);
      }
    },
    group: capture(T.INFO),
    groupEnd: () => {},
    groupCollapsed: capture(T.INFO),
    time: (label = "default") => {
      entries.push({ type: T.INFO, text: `timer '${label}' started`, ts: performance.now() - startTime });
    },
    timeEnd: (label = "default") => {
      entries.push({ type: T.INFO, text: `timer '${label}' ended`, ts: performance.now() - startTime });
    },
    timeLog: capture(T.INFO),
    count: capture(T.INFO),
    countReset: capture(T.INFO),
    assert: (condition, ...args) => {
      if (!condition) {
        entries.push({ type: T.ERROR, text: `Assertion failed: ${args.map(serialize).join(" ")}`, ts: performance.now() - startTime });
      }
    },
    clear: () => entries.push({ type: T.CLEAR, text: "", ts: performance.now() - startTime }),
    trace: capture(T.INFO),
  };

  let returnVal;
  let execError = null;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("console", `"use strict";\n${code}`);
    returnVal = fn(fakeConsole);
  } catch (err) {
    execError = err;
    entries.push({
      type: T.ERROR,
      text: serialize(err),
      ts: performance.now() - startTime,
    });
  }

  const elapsed = performance.now() - startTime;

  if (!execError && returnVal !== undefined) {
    entries.push({ type: T.RESULT, text: serialize(returnVal), ts: elapsed });
  }

  entries.push({ type: T.TIME, text: `Executed in ${elapsed.toFixed(3)}ms`, ts: elapsed });

  return { entries, elapsed, hasError: !!execError };
};

/* ══════════════════════════════════════════════════════
   JSCompiler Component

   Props:
     getCode  : () => string   — call this to get editor content
     isOpen   : boolean        — controls visibility
     onClose  : () => void     — called when user closes panel
══════════════════════════════════════════════════════ */
export default function JSCompiler({ getCode, isOpen, onClose }) {
  const [output, setOutput] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | running | success | error
  const [elapsed, setElapsed] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [fontSize, setFontSize] = useState(13);
  const outputRef = useRef(null);

  /* ── Run ── */
  const run = useCallback(() => {
    const code = getCode?.() ?? "";
    if (!code.trim()) {
      setOutput([{ type: T.WARN, text: "No code to execute.", ts: 0 }]);
      setStatus("error");
      return;
    }
    setStatus("running");
    setTimeout(() => {
      const { entries, elapsed: ms, hasError } = runCode(code);
      setOutput(entries);
      setElapsed(ms);
      setStatus(hasError ? "error" : "success");
      setTimeout(() => {
        outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
      }, 50);
    }, 30);
  }, [getCode]);

  /* ── Clear ── */
  const clear = () => { setOutput([]); setStatus("idle"); setElapsed(null); };

  /* ── Ctrl+Enter to run ── */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, run]);

  /* ── Counts per type ── */
  const counts = {
    [T.LOG]:   output.filter((e) => e.type === T.LOG).length,
    [T.WARN]:  output.filter((e) => e.type === T.WARN).length,
    [T.ERROR]: output.filter((e) => e.type === T.ERROR).length,
    [T.INFO]:  output.filter((e) => e.type === T.INFO).length,
  };
  const clearCount = output.filter((e) => e.type === T.CLEAR).length;

  /* ── Filtered visible lines ── */
  const visible = output.filter((e) => {
    if (e.type === T.CLEAR) return false;
    const passFilter = filter === "all" || e.type === filter;
    const passSearch = !search || e.text.toLowerCase().includes(search.toLowerCase());
    return passFilter && passSearch;
  });

  if (!isOpen) return null;

  return (
    <>
      <style>{CSS}</style>
      <div className="jsc-panel">

        {/* ── Top Bar ── */}
        <div className="jsc-topbar">
          <div className="jsc-topbar-left">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="14" height="14" rx="2" fill="#F7DF1E"/>
              <text x="3" y="12" fontFamily="monospace" fontWeight="bold" fontSize="9" fill="#000">JS</text>
            </svg>
            <span className="jsc-title">RUNTIME</span>
            <span className={`jsc-badge jsc-badge--${status}`}>
              {status === "idle"    && "IDLE"}
              {status === "running" && "● RUNNING"}
              {status === "success" && `✓ OK · ${elapsed?.toFixed(2)}ms`}
              {status === "error"   && "✕ ERROR"}
            </span>
          </div>
          <div className="jsc-topbar-right">
            <button
              className={`jsc-btn jsc-btn--run${status === "running" ? " jsc-btn--running" : ""}`}
              onClick={run}
              title="Run (Ctrl+Enter)"
            >
              {status === "running" ? "◌" : "▶"}&nbsp;RUN
            </button>
            <button className="jsc-btn" onClick={clear} title="Clear output">⊘&nbsp;CLR</button>
            <button className="jsc-btn jsc-btn--close" onClick={onClose} title="Close panel">✕</button>
          </div>
        </div>

        {/* ── Filter + Search Bar ── */}
        <div className="jsc-filterbar">
          <div className="jsc-filters">
            {["all", T.LOG, T.WARN, T.ERROR, T.INFO].map((f) => (
              <button
                key={f}
                className={[
                  "jsc-filter",
                  filter === f ? "jsc-filter--active" : "",
                  f !== "all" ? `jsc-filter--${f}` : "",
                ].join(" ")}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "ALL" : f.toUpperCase()}
                {f !== "all" && counts[f] > 0 && (
                  <span className={`jsc-count jsc-count--${f}`}>{counts[f]}</span>
                )}
              </button>
            ))}
          </div>

          <div className="jsc-search-wrap">
            <span className="jsc-search-icon">⌕</span>
            <input
              className="jsc-search"
              placeholder="search output…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="jsc-search-clr" onClick={() => setSearch("")}>×</button>
            )}
          </div>

          <div className="jsc-font-btns">
            <button className="jsc-icon-btn" onClick={() => setFontSize((f) => Math.min(f + 1, 20))} title="Increase font">A+</button>
            <button className="jsc-icon-btn" onClick={() => setFontSize((f) => Math.max(f - 1, 10))} title="Decrease font">A−</button>
          </div>
        </div>

        {/* ── Output Area ── */}
        <div className="jsc-output" ref={outputRef}>

          {clearCount > 0 && (
            <div className="jsc-cleared">— console.clear() called {clearCount}× —</div>
          )}

          {visible.length === 0 && status === "idle" && (
            <div className="jsc-empty">
              <span className="jsc-empty-icon">▷</span>
              <span>Press <kbd>▶ RUN</kbd> or <kbd>Ctrl+Enter</kbd> to execute</span>
            </div>
          )}

          {visible.length === 0 && status !== "idle" && (
            <div className="jsc-empty">
              <span>No output matches the current filter</span>
            </div>
          )}

          {visible.map((entry, i) => (
            <OutputLine key={i} entry={entry} fontSize={fontSize} />
          ))}
        </div>

        {/* ── Status Bar ── */}
        <div className="jsc-statusbar">
          <span>{visible.length} line{visible.length !== 1 ? "s" : ""}</span>
          {counts[T.WARN]  > 0 && <span className="jsc-sb--warn">{counts[T.WARN]} warn</span>}
          {counts[T.ERROR] > 0 && <span className="jsc-sb--error">{counts[T.ERROR]} error{counts[T.ERROR] > 1 ? "s" : ""}</span>}
          <span style={{ marginLeft: "auto", fontFamily: "'Orbitron',sans-serif", fontSize: 8 }}>
            {elapsed !== null ? `${elapsed.toFixed(3)}ms` : "—"}
          </span>
        </div>
      </div>
    </>
  );
}

/* ── Single output line with expand toggle ── */
function OutputLine({ entry, fontSize }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.text.length > 140 || entry.text.includes("\n");
  const preview = isLong && !expanded
    ? entry.text.slice(0, 140).split("\n")[0] + " …"
    : entry.text;

  return (
    <div
      className={`jsc-line jsc-line--${entry.type}`}
      style={{ fontSize }}
      onClick={() => isLong && setExpanded((v) => !v)}
    >
      <span className={`jsc-line-icon jsc-icon--${entry.type}`}>{ICONS[entry.type]}</span>
      <span className="jsc-line-ts">{entry.ts.toFixed(1)}ms</span>
      <pre className="jsc-line-text">{preview}</pre>
      {isLong && (
        <span className="jsc-expand">{expanded ? "▲" : "▼"}</span>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Styles
══════════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Orbitron:wght@600;800&display=swap');

  .jsc-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: #020408;
    border: 1px solid rgba(0,255,231,0.12);
    border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
    overflow: hidden;
    color: rgba(255,255,255,0.82);
  }

  /* Top bar */
  .jsc-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    height: 42px;
    flex-shrink: 0;
    background: rgba(0,0,0,0.55);
    border-bottom: 1px solid rgba(0,255,231,0.08);
    gap: 10px;
  }
  .jsc-topbar-left  { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .jsc-topbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

  .jsc-title {
    font-family: 'Orbitron', sans-serif;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.22em;
    color: rgba(255,255,255,0.65);
    white-space: nowrap;
  }

  .jsc-badge {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.16em;
    padding: 2px 9px;
    border-radius: 2px;
    border: 1px solid;
    white-space: nowrap;
  }
  .jsc-badge--idle    { color:rgba(255,255,255,0.3); border-color:rgba(255,255,255,0.1); background:rgba(255,255,255,0.02); }
  .jsc-badge--running { color:#ffe600; border-color:rgba(255,230,0,0.35); background:rgba(255,230,0,0.07); animation:jsc-pulse 0.9s ease-in-out infinite; }
  .jsc-badge--success { color:#00ffe7; border-color:rgba(0,255,231,0.35); background:rgba(0,255,231,0.06); }
  .jsc-badge--error   { color:#ff4ecd; border-color:rgba(255,78,205,0.35); background:rgba(255,78,205,0.07); }

  @keyframes jsc-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes jsc-spin  { to{transform:rotate(360deg)} }

  /* Buttons */
  .jsc-btn {
    font-family: 'Orbitron', sans-serif;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.18em;
    padding: 5px 11px;
    border-radius: 2px;
    border: 1px solid rgba(0,255,231,0.28);
    background: rgba(0,255,231,0.05);
    color: #00ffe7;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .jsc-btn:hover { background: #00ffe7; color: #000; border-color: #00ffe7; }
  .jsc-btn--run   { border-color: rgba(0,255,231,0.5); }
  .jsc-btn--running { opacity: 0.7; cursor: not-allowed; }
  .jsc-btn--close {
    background: transparent;
    border-color: rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.35);
  }
  .jsc-btn--close:hover { background: rgba(255,78,205,0.12); border-color:#ff4ecd; color:#ff4ecd; }

  .jsc-icon-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.35);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 3px 7px;
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .jsc-icon-btn:hover { border-color: rgba(0,255,231,0.4); color: #00ffe7; }

  /* Filter bar */
  .jsc-filterbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-bottom: 1px solid rgba(0,255,231,0.06);
    background: rgba(0,0,0,0.28);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .jsc-filters { display: flex; gap: 3px; flex-shrink: 0; }

  .jsc-filter {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.12em;
    padding: 3px 8px;
    border-radius: 2px;
    border: 1px solid rgba(255,255,255,0.07);
    background: transparent;
    color: rgba(255,255,255,0.3);
    cursor: pointer;
    transition: all 0.14s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .jsc-filter:hover { border-color: rgba(255,255,255,0.18); color: rgba(255,255,255,0.65); }
  .jsc-filter--active { border-color: rgba(0,255,231,0.45); color: #00ffe7; background: rgba(0,255,231,0.06); }
  .jsc-filter--warn.jsc-filter--active  { border-color:rgba(255,230,0,0.45);  color:#ffe600; background:rgba(255,230,0,0.06); }
  .jsc-filter--error.jsc-filter--active { border-color:rgba(255,78,205,0.45); color:#ff4ecd; background:rgba(255,78,205,0.06); }
  .jsc-filter--info.jsc-filter--active  { border-color:rgba(100,180,255,0.45);color:#64b4ff; background:rgba(100,180,255,0.06); }

  .jsc-count {
    font-size: 7.5px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 10px;
  }
  .jsc-count--warn  { background:rgba(255,230,0,0.18);  color:#ffe600; }
  .jsc-count--error { background:rgba(255,78,205,0.18); color:#ff4ecd; }
  .jsc-count--info  { background:rgba(100,180,255,0.18);color:#64b4ff; }
  .jsc-count--log   { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5); }

  /* Search */
  .jsc-search-wrap {
    flex: 1;
    position: relative;
    min-width: 100px;
  }
  .jsc-search-icon {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 13px;
    color: rgba(255,255,255,0.22);
    pointer-events: none;
    line-height: 1;
  }
  .jsc-search {
    width: 100%;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 2px;
    padding: 4px 26px 4px 24px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: rgba(255,255,255,0.72);
    outline: none;
    transition: border-color 0.15s;
  }
  .jsc-search:focus { border-color: rgba(0,255,231,0.38); }
  .jsc-search::placeholder { color: rgba(255,255,255,0.16); }
  .jsc-search-clr {
    position: absolute; right: 6px; top: 50%;
    transform: translateY(-50%);
    background: transparent; border: none;
    color: rgba(255,255,255,0.28); cursor: pointer; font-size: 13px; line-height:1;
  }
  .jsc-search-clr:hover { color: #ff4ecd; }

  .jsc-font-btns { display: flex; gap: 4px; flex-shrink: 0; }

  /* Output */
  .jsc-output {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    min-height: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(0,255,231,0.14) transparent;
  }
  .jsc-output::-webkit-scrollbar { width: 4px; }
  .jsc-output::-webkit-scrollbar-thumb { background: rgba(0,255,231,0.14); border-radius: 2px; }

  .jsc-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 32px 20px;
    font-size: 11px;
    color: rgba(255,255,255,0.2);
    letter-spacing: 0.08em;
    text-align: center;
  }
  .jsc-empty-icon { font-size: 30px; color: rgba(0,255,231,0.18); }
  .jsc-empty kbd {
    background: rgba(0,255,231,0.07);
    border: 1px solid rgba(0,255,231,0.25);
    border-radius: 2px;
    padding: 1px 7px;
    color: #00ffe7;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
  }

  .jsc-cleared {
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.14em;
    color: rgba(255,255,255,0.18);
    padding: 5px 0;
    border-top: 1px dashed rgba(255,255,255,0.05);
    border-bottom: 1px dashed rgba(255,255,255,0.05);
    margin: 3px 0;
  }

  /* Output lines */
  .jsc-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 3px 12px 3px 10px;
    border-left: 2px solid transparent;
    transition: background 0.1s;
    cursor: default;
  }
  .jsc-line:hover { background: rgba(255,255,255,0.022); }
  .jsc-line--log    { border-left-color: rgba(255,255,255,0.06); }
  .jsc-line--warn   { border-left-color: #ffe600; background: rgba(255,230,0,0.03); }
  .jsc-line--error  { border-left-color: #ff4ecd; background: rgba(255,78,205,0.04); }
  .jsc-line--info   { border-left-color: #64b4ff; background: rgba(100,180,255,0.03); }
  .jsc-line--result { border-left-color: #00ffe7; background: rgba(0,255,231,0.035); }
  .jsc-line--time   { border-left-color: rgba(255,255,255,0.08); opacity: 0.45; }

  .jsc-line-icon {
    flex-shrink: 0;
    width: 14px;
    font-size: 10px;
    margin-top: 2px;
    text-align: center;
  }
  .jsc-icon--log    { color: rgba(255,255,255,0.25); }
  .jsc-icon--warn   { color: #ffe600; }
  .jsc-icon--error  { color: #ff4ecd; }
  .jsc-icon--info   { color: #64b4ff; }
  .jsc-icon--result { color: #00ffe7; }
  .jsc-icon--time   { color: rgba(255,255,255,0.18); }

  .jsc-line-ts {
    flex-shrink: 0;
    font-size: 9px;
    color: rgba(255,255,255,0.16);
    letter-spacing: 0.04em;
    margin-top: 3px;
    min-width: 46px;
    text-align: right;
  }

  .jsc-line-text {
    flex: 1;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.6;
    font-family: 'JetBrains Mono', monospace;
    color: rgba(255,255,255,0.82);
  }
  .jsc-line--warn   .jsc-line-text { color: #ffe600; }
  .jsc-line--error  .jsc-line-text { color: #ff4ecd; }
  .jsc-line--info   .jsc-line-text { color: #64b4ff; }
  .jsc-line--result .jsc-line-text { color: #00ffe7; }
  .jsc-line--time   .jsc-line-text { color: rgba(255,255,255,0.35); font-style: italic; }

  .jsc-expand {
    flex-shrink: 0;
    font-size: 9px;
    color: rgba(255,255,255,0.18);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 2px;
    margin-top: 2px;
    transition: color 0.12s;
  }
  .jsc-expand:hover { color: #00ffe7; }

  /* Status bar */
  .jsc-statusbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    height: 24px;
    background: rgba(0,0,0,0.42);
    border-top: 1px solid rgba(0,255,231,0.06);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.22);
    flex-shrink: 0;
  }
  .jsc-sb--warn  { color: #ffe600; }
  .jsc-sb--error { color: #ff4ecd; }
`;