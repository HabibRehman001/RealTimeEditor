import "../src/App.css";
import { Editor } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";

/* ─── Helpers ──────────────────────────────────────────────────────── */
const genRoomCode = () =>
  Math.random().toString(36).substring(2, 8).toUpperCase();

const COLORS = [
  "#00ffe7",
  "#ff4ecd",
  "#ffe600",
  "#4ef0ff",
  "#ff6b35",
  "#a8ff3e",
  "#c77dff",
  "#ff9f1c",
];
const pickColor = (i) => COLORS[i % COLORS.length];

/* ─── GSAP Loader Hook ─────────────────────────────────────────────── */
const useEnsureGSAP = (cb) => {
  useEffect(() => {
    if (window.gsap) {
      cb();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }, []);
};

/* ─── App ──────────────────────────────────────────────────────────── */
const App = () => {
  const [screen, setScreen] = useState("name"); // name → lobby → waiting → editor | denied
  const [userName, setUserName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [role, setRole] = useState("");
  const [users, setUsers] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);

  const ydoc = useMemo(() => new Y.Doc(), []);
  const ytext = useMemo(() => ydoc.getText("monaco"), [ydoc]);
  const editorRef = useRef(null);
  const providerRef = useRef(null);

  const handleMount = (editor) => {
    editorRef.current = editor;
    new MonacoBinding(
      ytext,
      editorRef.current.getModel(),
      new Set([editorRef.current]),
    );
  };

  /* Owner: Create Room */
  const handleCreateRoom = useCallback(() => {
    const code = genRoomCode();
    setRoomCode(code);
    setRole("owner");

    const prov = new SocketIOProvider("/", `room-${code}`, ydoc, {
      autoConnect: true,
    });
    providerRef.current = prov;

    prov.awareness.setLocalStateField("user", {
      name: userName,
      role: "owner",
      color: pickColor(0),
      id: Math.random().toString(36).slice(2),
    });

    const updateUsers = () => {
      const states = Array.from(prov.awareness.getStates().values());
      setUsers(states.filter((s) => s.user?.name).map((s) => s.user));
      const reqs = states
        .filter((s) => s.joinRequest)
        .map((s) => s.joinRequest);
      setPendingRequests(reqs);
    };
    updateUsers();
    prov.awareness.on("change", updateUsers);
    window.addEventListener("beforeunload", () =>
      prov.awareness.setLocalStateField("user", null),
    );

    setScreen("editor");
  }, [userName, ydoc]);

  /* Contestant: Request to join */
  const handleJoinRequest = useCallback(
    (code) => {
      setRoomCode(code);
      setRole("contestant");

      const prov = new SocketIOProvider("/", `room-${code}`, ydoc, {
        autoConnect: true,
      });
      providerRef.current = prov;

      const myId = Math.random().toString(36).slice(2);
      prov.awareness.setLocalStateField("joinRequest", {
        name: userName,
        id: myId,
      });

      const checkDecision = () => {
        const states = Array.from(prov.awareness.getStates().values());
        const decision = states.find((s) => s.approvalFor === userName);
        if (!decision) return;

        if (decision.approved === true) {
          prov.awareness.setLocalStateField("joinRequest", null);
          prov.awareness.setLocalStateField("user", {
            name: userName,
            role: "contestant",
            color: pickColor(Math.floor(Math.random() * 8)),
            id: myId,
          });
          const updateUsers = () => {
            const sts = Array.from(prov.awareness.getStates().values());
            setUsers(sts.filter((s) => s.user?.name).map((s) => s.user));
          };
          updateUsers();
          prov.awareness.on("change", updateUsers);
          setScreen("editor");
        }
        if (decision.approved === false) {
          setScreen("denied");
        }
      };

      prov.awareness.on("change", checkDecision);
      setScreen("waiting");
    },
    [userName, ydoc],
  );

  /* Owner: Approve */
  const handleApprove = useCallback((reqName) => {
    providerRef.current?.awareness.setLocalStateField("approvalFor", reqName);
    providerRef.current?.awareness.setLocalStateField("approved", true);
    setPendingRequests((p) => p.filter((r) => r.name !== reqName));
    setTimeout(() => {
      providerRef.current?.awareness.setLocalStateField("approvalFor", null);
      providerRef.current?.awareness.setLocalStateField("approved", null);
    }, 3000);
  }, []);

  /* Owner: Deny */
  const handleDeny = useCallback((reqName) => {
    providerRef.current?.awareness.setLocalStateField("approvalFor", reqName);
    providerRef.current?.awareness.setLocalStateField("approved", false);
    setPendingRequests((p) => p.filter((r) => r.name !== reqName));
    setTimeout(() => {
      providerRef.current?.awareness.setLocalStateField("approvalFor", null);
      providerRef.current?.awareness.setLocalStateField("approved", null);
    }, 3000);
  }, []);

  if (screen === "name")
    return (
      <NameScreen
        onDone={(name) => {
          setUserName(name);
          setScreen("lobby");
        }}
      />
    );
  if (screen === "lobby")
    return (
      <LobbyScreen
        userName={userName}
        onCreate={handleCreateRoom}
        onJoin={handleJoinRequest}
      />
    );
  if (screen === "waiting")
    return <WaitingScreen userName={userName} roomCode={roomCode} />;
  if (screen === "denied")
    return <DeniedScreen onBack={() => setScreen("lobby")} />;
  if (screen === "editor")
    return (
      <EditorScreen
        users={users}
        role={role}
        roomCode={roomCode}
        userName={userName}
        pendingRequests={pendingRequests}
        onApprove={handleApprove}
        onDeny={handleDeny}
        handleMount={handleMount}
      />
    );
  return null;
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Name Entry
══════════════════════════════════════════════════════════════════════ */
const NameScreen = ({ onDone }) => {
  const cardRef = useRef(null);
  const [val, setVal] = useState("");

  useEnsureGSAP(() => {
    window.gsap.from(cardRef.current, {
      y: 60,
      opacity: 0,
      duration: 0.9,
      ease: "power3.out",
    });
  });

  const submit = (e) => {
    e.preventDefault();
    if (val.trim()) onDone(val.trim());
  };

  return (
    <CyberBg>
      <div ref={cardRef} style={S.card}>
        <Logo />
        <h1 style={S.bigTitle}>WHO ARE YOU?</h1>
        <p style={S.sub}>Enter your callsign to begin</p>
        <form
          onSubmit={submit}
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 28,
          }}
        >
          <TermInput
            prefix="~/id >"
            placeholder="your_callsign"
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
          <CyberBtn type="submit">CONFIRM IDENTITY</CyberBtn>
        </form>
        <CornerDots />
      </div>
    </CyberBg>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Lobby
══════════════════════════════════════════════════════════════════════ */
const LobbyScreen = ({ userName, onCreate, onJoin }) => {
  const cardRef = useRef(null);
  const [joinMode, setJoinMode] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  useEnsureGSAP(() => {
    window.gsap.from(cardRef.current, {
      y: 60,
      opacity: 0,
      duration: 0.9,
      ease: "power3.out",
    });
  });

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    if (code.trim().length < 4) {
      setErr("Invalid room code.");
      return;
    }
    onJoin(code.trim().toUpperCase());
  };

  return (
    <CyberBg>
      <div ref={cardRef} style={{ ...S.card, width: 500 }}>
        <Logo />
        <div style={S.greeting}>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>
            WELCOME,&nbsp;
          </span>
          <span
            style={{
              color: "#00ffe7",
              fontFamily: "'Orbitron',sans-serif",
              letterSpacing: "0.1em",
            }}
          >
            {userName}
          </span>
        </div>

        <Divider label="SELECT MODE" />

        {!joinMode ? (
          <div style={S.modeGrid}>
            <ModeCard
              icon="⬡"
              label="CREATE ROOM"
              badge="HOST"
              desc={"Start a new session.\nYou are the owner."}
              color="#00ffe7"
              onClick={onCreate}
            />
            <ModeCard
              icon="◈"
              label="JOIN ROOM"
              badge="CONTESTANT"
              desc={"Enter an existing\nroom with a code."}
              color="#ff4ecd"
              onClick={() => setJoinMode(true)}
            />
          </div>
        ) : (
          <form
            onSubmit={handleJoinSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 6,
            }}
          >
            <p style={{ ...S.sub, textAlign: "left", marginBottom: 4 }}>
              Enter the room code shared by the host:
            </p>
            <TermInput
              prefix="~/code >"
              placeholder="XXXXXX"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setErr("");
              }}
              extraStyle={{
                textTransform: "uppercase",
                letterSpacing: "0.3em",
                fontSize: 16,
              }}
            />
            {err && (
              <span
                style={{
                  color: "#ff4ecd",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                }}
              >
                {err}
              </span>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <CyberBtn
                type="button"
                accent="rgba(255,255,255,0.25)"
                onClick={() => setJoinMode(false)}
                style={{ flex: 1 }}
              >
                BACK
              </CyberBtn>
              <CyberBtn type="submit" style={{ flex: 2 }}>
                REQUEST TO JOIN →
              </CyberBtn>
            </div>
          </form>
        )}

        <CornerDots />
      </div>
    </CyberBg>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Waiting for Approval
══════════════════════════════════════════════════════════════════════ */
const WaitingScreen = ({ userName, roomCode }) => {
  const ringRef = useRef(null);

  useEnsureGSAP(() => {
    window.gsap.to(ringRef.current, {
      rotation: 360,
      duration: 2.5,
      repeat: -1,
      ease: "none",
      transformOrigin: "center center",
    });
  });

  return (
    <CyberBg>
      <div style={{ ...S.card, alignItems: "center", textAlign: "center" }}>
        <Logo />
        <div ref={ringRef} style={{ marginTop: 10 }}>
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle
              cx="38"
              cy="38"
              r="32"
              fill="none"
              stroke="rgba(0,255,231,0.12)"
              strokeWidth="2"
            />
            <circle
              cx="38"
              cy="38"
              r="32"
              fill="none"
              stroke="#00ffe7"
              strokeWidth="2"
              strokeDasharray="48 155"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h2 style={{ ...S.bigTitle, fontSize: 17, marginTop: 18 }}>
          AWAITING APPROVAL
        </h2>
        <p style={{ ...S.sub, lineHeight: 1.8 }}>
          Request sent to room&nbsp;
          <span
            style={{
              color: "#00ffe7",
              fontFamily: "'Orbitron',sans-serif",
              letterSpacing: "0.2em",
            }}
          >
            {roomCode}
          </span>
          <br />
          The host will approve or deny shortly.
        </p>
        <div style={S.waitTag}>
          <span style={S.waitDot} />
          {userName}
        </div>
        <CornerDots />
      </div>
    </CyberBg>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Denied
══════════════════════════════════════════════════════════════════════ */
const DeniedScreen = ({ onBack }) => (
  <CyberBg>
    <div style={{ ...S.card, alignItems: "center", textAlign: "center" }}>
      <div
        style={{
          fontSize: 48,
          color: "#ff4ecd",
          marginBottom: 12,
          lineHeight: 1,
        }}
      >
        ✕
      </div>
      <h2 style={{ ...S.bigTitle, color: "#ff4ecd", fontSize: 20 }}>
        ACCESS DENIED
      </h2>
      <p style={{ ...S.sub, marginTop: 8 }}>The host declined your request.</p>
      <div style={{ marginTop: 28, width: "100%" }}>
        <CyberBtn accent="#ff4ecd" onClick={onBack}>
          ← BACK TO LOBBY
        </CyberBtn>
      </div>
      <CornerDots color="#ff4ecd" />
    </div>
  </CyberBg>
);

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Editor
══════════════════════════════════════════════════════════════════════ */
const EditorScreen = ({
  users,
  role,
  roomCode,
  userName,
  pendingRequests,
  onApprove,
  onDeny,
  handleMount,
}) => {
  const headerRef = useRef(null);
  const sideRef = useRef(null);
  const edRef = useRef(null);
  const [time, setTime] = useState(new Date());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEnsureGSAP(() => {
    const g = window.gsap;
    g.from(headerRef.current, {
      y: -50,
      opacity: 0,
      duration: 0.7,
      ease: "power3.out",
    });
    g.from(sideRef.current, {
      x: -50,
      opacity: 0,
      duration: 0.7,
      delay: 0.1,
      ease: "power3.out",
    });
    g.from(edRef.current, {
      x: 50,
      opacity: 0,
      duration: 0.7,
      delay: 0.2,
      ease: "power3.out",
    });
  });

  useEffect(() => {
    if (window.gsap && users.length > 0)
      window.gsap.from(".u-pill:last-child", {
        x: -14,
        opacity: 0,
        duration: 0.4,
        ease: "back.out(1.7)",
      });
  }, [users.length]);

  useEffect(() => {
    if (window.gsap && pendingRequests.length > 0)
      window.gsap.from(".req-pill:last-child", {
        y: -10,
        opacity: 0,
        duration: 0.35,
        ease: "power2.out",
      });
  }, [pendingRequests.length]);

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const isOwner = role === "owner";
  const timeStr = time.toLocaleTimeString("en-GB", { hour12: false });

  return (
    <div style={S.appBg}>
      <div style={S.grid} />
      <div style={S.scanlines} />

      {/* Header */}
      <header ref={headerRef} style={S.header}>
        <div style={S.hLeft}>
          <Logo small />
          <span style={S.hBrand}>
            SYNCED<span style={{ color: "#00ffe7" }}>CODE</span>
          </span>
          <span
            style={{
              ...S.hTag,
              background: isOwner
                ? "rgba(0,255,231,0.08)"
                : "rgba(255,78,205,0.08)",
              borderColor: isOwner
                ? "rgba(0,255,231,0.3)"
                : "rgba(255,78,205,0.3)",
              color: isOwner ? "#00ffe7" : "#ff4ecd",
            }}
          >
            {isOwner ? "HOST" : "CONTESTANT"}
          </span>
        </div>
        <div style={S.hCenter}>
          <span style={S.statusDot} />
          <span style={S.hStatusTxt}>{users.length} LIVE</span>
          <span style={S.hSep} />
          <span style={S.hClock}>{timeStr}</span>
        </div>
        <div style={S.hRight}>
          <div style={S.codeBox} onClick={copyCode} title="Click to copy">
            <span style={S.codeBoxLabel}>ROOM</span>
            <span style={S.codeBoxVal}>{roomCode}</span>
            <span
              style={{
                fontSize: 11,
                color: copied ? "#00ffe7" : "rgba(255,255,255,0.28)",
                marginLeft: 6,
                transition: "color 0.2s",
              }}
            >
              {copied ? "✓" : "⧉"}
            </span>
          </div>
        </div>
      </header>

      {/* Body */}
      <div style={S.body}>
        {/* Sidebar */}
        <aside ref={sideRef} style={S.sidebar}>
          {/* Join Requests — owner only */}
          {isOwner && pendingRequests.length > 0 && (
            <div style={S.reqSection}>
              <SideLabel color="#ffe600">JOIN REQUESTS</SideLabel>
              {pendingRequests.map((req, i) => (
                <div key={i} className="req-pill" style={S.reqPill}>
                  <span style={S.reqName}>{req.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      style={S.approveBtn}
                      onClick={() => onApprove(req.name)}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(0,255,100,0.25)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(0,255,100,0.1)")
                      }
                    >
                      ✓
                    </button>
                    <button
                      style={S.denyBtn}
                      onClick={() => onDeny(req.name)}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(255,78,205,0.25)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          "rgba(255,78,205,0.1)")
                      }
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Participants */}
          <div style={S.sideSection}>
            <SideLabel>PARTICIPANTS</SideLabel>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {users.map((u, i) => (
                <li
                  key={i}
                  className="u-pill"
                  style={S.userPill}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = `${u.color}12`;
                    e.currentTarget.style.borderColor = u.color;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                    e.currentTarget.style.borderColor =
                      "rgba(255,255,255,0.06)";
                  }}
                >
                  <span
                    style={{
                      ...S.uDot,
                      background: u.color,
                      boxShadow: `0 0 8px ${u.color}`,
                    }}
                  />
                  <span style={S.uName}>
                    {u.name}
                    {u.name === userName ? (
                      <span
                        style={{ color: "rgba(255,255,255,0.3)", fontSize: 9 }}
                      >
                        {" "}
                        (you)
                      </span>
                    ) : (
                      ""
                    )}
                  </span>
                  <span
                    style={{
                      ...S.uRoleBadge,
                      borderColor: u.role === "owner" ? "#00ffe7" : "#ff4ecd",
                      color: u.role === "owner" ? "#00ffe7" : "#ff4ecd",
                    }}
                  >
                    {u.role === "owner" ? "HOST" : "CON"}
                  </span>
                </li>
              ))}
              {users.length === 0 && (
                <li
                  style={{
                    textAlign: "center",
                    padding: "18px 0",
                    color: "rgba(255,255,255,0.2)",
                    fontSize: 10,
                    letterSpacing: "0.1em",
                  }}
                >
                  CONNECTING…
                </li>
              )}
            </ul>
          </div>

          {/* Session Info */}
          <div style={S.statsPanel}>
            <SideLabel>SESSION</SideLabel>
            {[
              ["PROTOCOL", "Y.JS/CRDT"],
              ["TRANSPORT", "SOCKET.IO"],
              ["LANGUAGE", "JS"],
              ["ROOM", roomCode],
            ].map(([k, v]) => (
              <div key={k} style={S.statRow}>
                <span style={S.statK}>{k}</span>
                <span
                  style={{
                    ...S.statV,
                    ...(k === "ROOM"
                      ? {
                          color: "#00ffe7",
                          fontFamily: "'Orbitron',sans-serif",
                          letterSpacing: "0.12em",
                        }
                      : {}),
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>

          {/* Visualizer bars */}
          <div style={S.vizRow}>
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                style={{
                  ...S.vizBar,
                  animationDelay: `${i * 0.14}s`,
                  height: `${6 + Math.random() * 24}px`,
                }}
              />
            ))}
          </div>
        </aside>

        {/* Editor */}
        <section ref={edRef} style={S.edWrap}>
          <div style={S.edHeader}>
            <div style={{ display: "flex", gap: 4 }}>
              <div style={S.tab}>
                <span style={S.tabDot} />
                main.js
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[
                "rgba(255,59,48,0.75)",
                "rgba(245,166,35,0.75)",
                "rgba(126,211,33,0.75)",
              ].map((c, i) => (
                <span key={i} style={{ ...S.winDot, background: c }} />
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Editor
              height="100%"
              defaultLanguage="javascript"
              defaultValue="// some comment"
              theme="vs-dark"
              onMount={handleMount}
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                minimap: { enabled: true },
                padding: { top: 16 },
                scrollbar: { verticalScrollbarSize: 4 },
                lineHeight: 22,
                cursorBlinking: "phase",
                smoothScrolling: true,
              }}
            />
          </div>
        </section>
      </div>

      <GlobalStyles />
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
══════════════════════════════════════════════════════════════════════ */
const CyberBg = ({ children }) => (
  <div style={S.loginBg}>
    <div style={S.grid} />
    <div style={S.scanlines} />
    <div
      style={{
        ...S.blob,
        top: "8%",
        left: "12%",
        background: "rgba(0,255,231,0.055)",
      }}
    />
    <div
      style={{
        ...S.blob,
        bottom: "10%",
        right: "8%",
        background: "rgba(255,78,205,0.045)",
        width: 360,
        height: 360,
      }}
    />
    {children}
  </div>
);

const Logo = ({ small }) => (
  <div
    style={{
      display: "flex",
      justifyContent: small ? "flex-start" : "center",
      marginBottom: small ? 0 : 22,
      marginRight: small ? 10 : 0,
    }}
  >
    <svg
      width={small ? 22 : 32}
      height={small ? 22 : 32}
      viewBox="0 0 36 36"
      fill="none"
    >
      <polygon
        points="18,2 34,32 2,32"
        fill="none"
        stroke="#00ffe7"
        strokeWidth="1.8"
      />
      <polygon points="18,10 28,28 8,28" fill="#00ffe7" opacity="0.15" />
    </svg>
  </div>
);

const TermInput = ({ prefix, extraStyle, ...props }) => (
  <div style={S.inputWrap}>
    <span style={S.inputPfx}>{prefix}</span>
    <input
      {...props}
      style={{ ...S.input, ...extraStyle }}
      onFocus={(e) =>
        (e.target.parentElement.style.boxShadow =
          "0 0 0 1px #00ffe7, 0 0 20px rgba(0,255,231,0.14)")
      }
      onBlur={(e) =>
        (e.target.parentElement.style.boxShadow =
          "0 0 0 1px rgba(0,255,231,0.22)")
      }
    />
  </div>
);

const CyberBtn = ({ children, accent, style: extra, ...props }) => (
  <button
    {...props}
    style={{
      ...S.cyberBtn,
      ...(accent ? { borderColor: accent, color: accent } : {}),
      ...extra,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = accent || "#00ffe7";
      e.currentTarget.style.color = "#000";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = "transparent";
      e.currentTarget.style.color = accent || "#00ffe7";
    }}
  >
    {children}
  </button>
);

const ModeCard = ({ icon, label, badge, desc, color, onClick }) => (
  <div
    style={S.modeCard}
    onClick={onClick}
    onMouseEnter={(e) => {
      e.currentTarget.style.borderColor = color;
      e.currentTarget.style.background = `${color}08`;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.borderColor = "rgba(0,255,231,0.12)";
      e.currentTarget.style.background = "rgba(0,255,231,0.015)";
    }}
  >
    <div style={{ ...S.modeIcon, color }}>{icon}</div>
    <div style={S.modeLabel}>{label}</div>
    <div style={S.modeDesc}>
      {desc.split("\n").map((l, i) => (
        <span key={i}>
          {l}
          <br />
        </span>
      ))}
    </div>
    <div style={{ ...S.modeBadge, borderColor: color, color }}>{badge}</div>
  </div>
);

const CornerDots = ({ color = "#00ffe7" }) => (
  <>
    {[
      {
        top: 10,
        left: 10,
        borderTop: `1.5px solid ${color}`,
        borderLeft: `1.5px solid ${color}`,
      },
      {
        top: 10,
        right: 10,
        borderTop: `1.5px solid ${color}`,
        borderRight: `1.5px solid ${color}`,
      },
      {
        bottom: 10,
        left: 10,
        borderBottom: `1.5px solid ${color}`,
        borderLeft: `1.5px solid ${color}`,
      },
      {
        bottom: 10,
        right: 10,
        borderBottom: `1.5px solid ${color}`,
        borderRight: `1.5px solid ${color}`,
      },
    ].map((s, i) => (
      <div
        key={i}
        style={{ position: "absolute", width: 14, height: 14, ...s }}
      />
    ))}
  </>
);

const Divider = ({ label }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      margin: "6px 0 22px",
    }}
  >
    <span style={{ flex: 1, height: 1, background: "rgba(0,255,231,0.15)" }} />
    <span
      style={{
        fontSize: 8,
        letterSpacing: "0.3em",
        color: "rgba(0,255,231,0.4)",
      }}
    >
      {label}
    </span>
    <span style={{ flex: 1, height: 1, background: "rgba(0,255,231,0.15)" }} />
  </div>
);

const SideLabel = ({ children, color = "rgba(0,255,231,0.45)" }) => (
  <div
    style={{
      fontSize: 7.5,
      letterSpacing: "0.25em",
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
      color,
    }}
  >
    <span
      style={{ flex: 1, height: 1, background: "currentColor", opacity: 0.3 }}
    />
    {children}
    <span
      style={{ flex: 1, height: 1, background: "currentColor", opacity: 0.3 }}
    />
  </div>
);

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Orbitron:wght@400;600;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    input::placeholder { color: rgba(255,255,255,0.18); }
    ::-webkit-scrollbar { width: 4px; background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(0,255,231,0.18); border-radius: 2px; }
    @keyframes gridPulse { 0%,100%{opacity:.04} 50%{opacity:.08} }
    @keyframes barAnim { 0%,100%{opacity:.3;transform:scaleY(1)} 50%{opacity:1;transform:scaleY(1.5)} }
    @keyframes tabBlink { 0%,100%{opacity:1} 50%{opacity:0} }
    @keyframes glowPulse { 0%,100%{box-shadow:0 0 5px rgba(0,255,231,0.5)} 50%{box-shadow:0 0 18px rgba(0,255,231,1)} }
    @keyframes waitAnim { 0%,100%{opacity:0.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.03)} }
  `}</style>
);

/* ══════════════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════════════ */
const S = {
  /* Backgrounds */
  loginBg: {
    height: "100vh",
    width: "100vw",
    background: "#020408",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    fontFamily: "'JetBrains Mono', monospace",
  },
  appBg: {
    height: "100vh",
    width: "100vw",
    background: "#020408",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'JetBrains Mono', monospace",
    overflow: "hidden",
    position: "relative",
  },
  grid: {
    position: "absolute",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(0,255,231,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,231,0.05) 1px,transparent 1px)",
    backgroundSize: "44px 44px",
    animation: "gridPulse 5s ease-in-out infinite",
    pointerEvents: "none",
  },
  scanlines: {
    position: "absolute",
    inset: 0,
    background:
      "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.07) 2px,rgba(0,0,0,0.07) 4px)",
    pointerEvents: "none",
    zIndex: 1,
  },
  blob: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: "50%",
    filter: "blur(100px)",
    pointerEvents: "none",
  },

  /* Card */
  card: {
    position: "relative",
    zIndex: 10,
    background: "rgba(2,4,8,0.93)",
    border: "1px solid rgba(0,255,231,0.16)",
    borderRadius: 3,
    padding: "46px 48px",
    width: 440,
    backdropFilter: "blur(28px)",
    boxShadow:
      "0 0 80px rgba(0,255,231,0.04), inset 0 0 40px rgba(0,255,231,0.02)",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  bigTitle: {
    fontFamily: "'Orbitron',sans-serif",
    fontSize: 22,
    fontWeight: 800,
    color: "#fff",
    letterSpacing: "0.2em",
    textAlign: "center",
    marginBottom: 8,
  },
  sub: {
    fontSize: 10,
    letterSpacing: "0.14em",
    color: "rgba(255,255,255,0.3)",
    textAlign: "center",
    lineHeight: 1.7,
  },
  greeting: {
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 13,
    letterSpacing: "0.08em",
    color: "#fff",
    textAlign: "center",
    marginBottom: 22,
  },

  /* Lobby mode cards */
  modeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  modeCard: {
    border: "1px solid rgba(0,255,231,0.12)",
    borderRadius: 3,
    padding: "24px 14px 18px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    transition: "border-color 0.2s, background 0.2s",
    background: "rgba(0,255,231,0.015)",
  },
  modeIcon: { fontSize: 30, lineHeight: 1 },
  modeLabel: {
    fontFamily: "'Orbitron',sans-serif",
    fontSize: 10.5,
    color: "#fff",
    letterSpacing: "0.15em",
  },
  modeDesc: {
    fontSize: 9,
    color: "rgba(255,255,255,0.3)",
    letterSpacing: "0.06em",
    textAlign: "center",
    lineHeight: 1.7,
  },
  modeBadge: {
    fontSize: 7,
    letterSpacing: "0.2em",
    border: "1px solid",
    padding: "2px 8px",
    borderRadius: 2,
    marginTop: 2,
  },

  /* Inputs */
  inputWrap: {
    display: "flex",
    alignItems: "center",
    background: "rgba(0,255,231,0.025)",
    border: "1px solid rgba(0,255,231,0.22)",
    borderRadius: 2,
    padding: "0 14px",
    transition: "box-shadow 0.2s",
  },
  inputPfx: {
    fontSize: 10,
    color: "#00ffe7",
    fontFamily: "'JetBrains Mono',monospace",
    whiteSpace: "nowrap",
    marginRight: 8,
    opacity: 0.55,
  },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#fff",
    fontFamily: "'JetBrains Mono',monospace",
    fontSize: 13,
    padding: "13px 0",
    letterSpacing: "0.04em",
  },
  cyberBtn: {
    background: "transparent",
    border: "1px solid #00ffe7",
    color: "#00ffe7",
    fontFamily: "'Orbitron',sans-serif",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.22em",
    padding: "13px 20px",
    cursor: "pointer",
    transition: "all 0.18s",
    borderRadius: 2,
    width: "100%",
  },

  /* Waiting */
  waitTag: {
    marginTop: 22,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 11.5,
    color: "#fff",
    letterSpacing: "0.1em",
    animation: "waitAnim 2s ease-in-out infinite",
  },
  waitDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#00ffe7",
    display: "inline-block",
    animation: "glowPulse 1.5s ease-in-out infinite",
  },

  /* Editor Header */
  header: {
    height: 50,
    background: "rgba(2,4,8,0.97)",
    borderBottom: "1px solid rgba(0,255,231,0.09)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 18px",
    flexShrink: 0,
    position: "relative",
    zIndex: 20,
  },
  hLeft: { display: "flex", alignItems: "center", gap: 0 },
  hBrand: {
    fontFamily: "'Orbitron',sans-serif",
    fontSize: 13,
    fontWeight: 800,
    color: "#fff",
    letterSpacing: "0.1em",
    marginRight: 10,
  },
  hTag: {
    fontSize: 7.5,
    letterSpacing: "0.2em",
    border: "1px solid",
    padding: "2px 8px",
    borderRadius: 2,
  },
  hCenter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#00ffe7",
    display: "inline-block",
    animation: "glowPulse 2s ease-in-out infinite",
  },
  hStatusTxt: {
    fontSize: 9.5,
    letterSpacing: "0.2em",
    color: "rgba(0,255,231,0.65)",
  },
  hSep: {
    width: 1,
    height: 11,
    background: "rgba(255,255,255,0.1)",
    display: "inline-block",
  },
  hClock: {
    fontFamily: "'Orbitron',sans-serif",
    fontSize: 11.5,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: "0.08em",
  },
  hRight: { display: "flex", alignItems: "center" },
  codeBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(0,255,231,0.05)",
    border: "1px solid rgba(0,255,231,0.18)",
    borderRadius: 2,
    padding: "5px 12px",
    cursor: "pointer",
    transition: "background 0.2s",
  },
  codeBoxLabel: {
    fontSize: 7,
    letterSpacing: "0.25em",
    color: "rgba(255,255,255,0.28)",
  },
  codeBoxVal: {
    fontFamily: "'Orbitron',sans-serif",
    fontSize: 13,
    color: "#00ffe7",
    letterSpacing: "0.18em",
  },

  /* Layout */
  body: { flex: 1, display: "flex", overflow: "hidden", padding: 12, gap: 12 },
  sidebar: {
    width: 214,
    flexShrink: 0,
    background: "rgba(2,4,8,0.85)",
    border: "1px solid rgba(0,255,231,0.07)",
    borderRadius: 3,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sideSection: { padding: "18px 14px 10px", flex: 1 },
  reqSection: {
    padding: "14px 14px 10px",
    borderBottom: "1px solid rgba(255,230,0,0.09)",
    background: "rgba(255,230,0,0.018)",
  },
  reqPill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px",
    marginBottom: 6,
    borderRadius: 2,
    border: "1px solid rgba(255,230,0,0.2)",
    background: "rgba(255,230,0,0.03)",
  },
  reqName: {
    fontSize: 10.5,
    color: "rgba(255,255,255,0.8)",
    letterSpacing: "0.05em",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    marginRight: 8,
  },
  approveBtn: {
    background: "rgba(0,255,100,0.1)",
    border: "1px solid rgba(0,255,100,0.4)",
    color: "#00ff64",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: 13,
    padding: "2px 8px",
    transition: "background 0.15s",
  },
  denyBtn: {
    background: "rgba(255,78,205,0.1)",
    border: "1px solid rgba(255,78,205,0.4)",
    color: "#ff4ecd",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: 13,
    padding: "2px 8px",
    transition: "background 0.15s",
  },
  userPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    marginBottom: 5,
    borderRadius: 2,
    border: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
    cursor: "default",
    transition: "all 0.18s",
  },
  uDot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  uName: {
    flex: 1,
    fontSize: 10.5,
    color: "rgba(255,255,255,0.8)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    letterSpacing: "0.04em",
  },
  uRoleBadge: {
    fontSize: 7,
    letterSpacing: "0.18em",
    border: "1px solid",
    padding: "2px 5px",
    borderRadius: 2,
    flexShrink: 0,
  },
  statsPanel: {
    borderTop: "1px solid rgba(0,255,231,0.06)",
    padding: "12px 14px",
  },
  statRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 7,
  },
  statK: {
    fontSize: 7.5,
    letterSpacing: "0.18em",
    color: "rgba(255,255,255,0.25)",
  },
  statV: {
    fontSize: 8.5,
    letterSpacing: "0.07em",
    color: "rgba(255,255,255,0.62)",
    fontWeight: 600,
  },
  vizRow: {
    borderTop: "1px solid rgba(0,255,231,0.06)",
    padding: "8px 14px",
    display: "flex",
    alignItems: "flex-end",
    gap: 3,
    height: 44,
  },
  vizBar: {
    flex: 1,
    background: "rgba(0,255,231,0.32)",
    borderRadius: 1,
    animation: "barAnim 1.4s ease-in-out infinite",
  },
  edWrap: {
    flex: 1,
    background: "rgba(2,4,8,0.6)",
    border: "1px solid rgba(0,255,231,0.07)",
    borderRadius: 3,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  edHeader: {
    height: 38,
    background: "rgba(0,0,0,0.42)",
    borderBottom: "1px solid rgba(0,255,231,0.07)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 12px",
    flexShrink: 0,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 10.5,
    color: "rgba(255,255,255,0.72)",
    letterSpacing: "0.05em",
    padding: "3px 12px",
    background: "rgba(0,255,231,0.04)",
    border: "1px solid rgba(0,255,231,0.12)",
    borderRadius: 2,
  },
  tabDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#00ffe7",
    display: "inline-block",
    animation: "tabBlink 2.5s ease-in-out infinite",
  },
  winDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    display: "inline-block",
    cursor: "pointer",
  },
};

export default App;
