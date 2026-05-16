import "../src/App.css";
import { Editor } from "@monaco-editor/react";
import { MonacoBinding } from "y-monaco";
import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import * as Y from "yjs";
import { SocketIOProvider } from "y-socket.io";
import JSCompiler from "./components/JScompiler";

/* ─── Helpers ──────────────────────────────────────────────────────── */
const genRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const COLORS = ["#00ffe7","#ff4ecd","#ffe600","#4ef0ff","#ff6b35","#a8ff3e","#c77dff","#ff9f1c"];
const pickColor = (i) => COLORS[i % COLORS.length];

const VALID_SCREENS = new Set(["lobby","waiting","editor","denied"]);
const VALID_ROLES   = new Set(["owner","contestant"]);

const getClientId = () => {
  let id = sessionStorage.getItem("syncedcode_clientId");
  if (!id) { id = Math.random().toString(36).slice(2); sessionStorage.setItem("syncedcode_clientId", id); }
  return id;
};

const parseUrlState = () => {
  const p = new URLSearchParams(window.location.search);
  return {
    userName: p.get("user")?.trim() || "",
    screen:   p.get("screen") || "",
    roomCode: (p.get("room") || "").trim().toUpperCase(),
    role:     p.get("role") || "",
  };
};

const getInitialAppState = () => {
  const { userName, screen, roomCode, role } = parseUrlState();
  if (!userName) return { screen: "name", userName: "", roomCode: "", role: "" };
  return {
    screen:   VALID_SCREENS.has(screen) ? screen : "lobby",
    userName, roomCode,
    role: VALID_ROLES.has(role) ? role : "",
  };
};

const syncUrl = ({ userName, screen, roomCode, role }) => {
  if (screen === "name" || !userName) {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    return;
  }
  const params = new URLSearchParams();
  params.set("user", userName);
  if (screen !== "lobby") params.set("screen", screen);
  if (roomCode) params.set("room", roomCode);
  if (role) params.set("role", role);
  const next = `${window.location.pathname}?${params.toString()}`;
  if (`${window.location.pathname}${window.location.search}` !== next)
    window.history.replaceState(null, "", next);
};

const registerRoom  = async (code) => { const r = await fetch(`/api/rooms/${code.trim().toUpperCase()}`,{method:"POST"}); if(!r.ok) throw new Error("Failed to register room"); };
const checkRoomExists = async (code) => { try { const r = await fetch(`/api/rooms/${code.trim().toUpperCase()}`); if(!r.ok) return false; const d = await r.json(); return d.exists===true; } catch { return false; } };

/* ─── GSAP Loader ── */
const useEnsureGSAP = (cb) => {
  useEffect(() => {
    if (window.gsap) { cb(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }, []);
};

/* ══════════════════════════════════════════════════════════════════════
   App
══════════════════════════════════════════════════════════════════════ */
const App = () => {
  const initial = useMemo(() => getInitialAppState(), []);
  const [screen,          setScreen]          = useState(initial.screen);
  const [userName,        setUserName]        = useState(initial.userName);
  const [roomCode,        setRoomCode]        = useState(initial.roomCode);
  const [role,            setRole]            = useState(initial.role);
  const [users,           setUsers]           = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [compilerOpen,    setCompilerOpen]    = useState(false);
  const [bootstrapping,   setBootstrapping]   = useState(() => initial.screen === "editor" || initial.screen === "waiting");

  // Permission map: { [userName]: { canWrite: bool, isSenior: bool, kicked: bool } }
  const [permissions, setPermissions] = useState({});

  const ydoc        = useMemo(() => new Y.Doc(), []);
  const ytext       = useMemo(() => ydoc.getText("monaco"), [ydoc]);
  const editorRef   = useRef(null);
  const providerRef = useRef(null);
  const unloadCleanupRef = useRef(null);

  useEffect(() => { syncUrl({ userName, screen, roomCode, role }); }, [userName, screen, roomCode, role]);

  // Sync editor read-only state whenever permissions change
  useEffect(() => {
    if (!editorRef.current) return;
    if (role === "owner") { editorRef.current.updateOptions({ readOnly: false }); return; }
    const myPerms = permissions[userName];
    const canWrite = myPerms?.canWrite === true;
    editorRef.current.updateOptions({ readOnly: !canWrite });
  }, [permissions, userName, role]);

  const connectProvider = useCallback((code) => {
    if (providerRef.current) { providerRef.current.destroy?.(); unloadCleanupRef.current?.(); unloadCleanupRef.current = null; }
    const prov = new SocketIOProvider("/", `room-${code}`, ydoc, { autoConnect: true });
    providerRef.current = prov;
    return prov;
  }, [ydoc]);

  const attachOwnerSession = useCallback((prov, name) => {
    const clientId = getClientId();
    prov.awareness.setLocalStateField("user", { name, role: "owner", color: pickColor(0), id: clientId });

    const updateUsers = () => {
      const states = Array.from(prov.awareness.getStates().values());
      setUsers(states.filter((s) => s.user?.name).map((s) => s.user));
      setPendingRequests(states.filter((s) => s.joinRequest).map((s) => s.joinRequest));

      // Sync permission updates broadcast by owner (from awareness permsFor field)
      const permState = states.find((s) => s.permsUpdate);
      if (permState?.permsUpdate) setPermissions(permState.permsUpdate);

      // Handle kick signals
      // (owner doesn't get kicked, ignore)
    };
    updateUsers();
    prov.awareness.on("change", updateUsers);
    const onUnload = () => prov.awareness.setLocalStateField("user", null);
    window.addEventListener("beforeunload", onUnload);
    unloadCleanupRef.current = () => { window.removeEventListener("beforeunload", onUnload); prov.awareness.off("change", updateUsers); };
  }, []);

  const attachContestantEditor = useCallback((prov, name) => {
    const clientId = getClientId();
    prov.awareness.setLocalStateField("joinRequest", null);
    prov.awareness.setLocalStateField("user", { name, role: "contestant", color: pickColor(Math.floor(Math.random()*8)), id: clientId });

    const updateUsers = () => {
      const states = Array.from(prov.awareness.getStates().values());
      setUsers(states.filter((s) => s.user?.name).map((s) => s.user));

      // Receive permission changes
      const permState = states.find((s) => s.permsUpdate);
      if (permState?.permsUpdate) setPermissions(prev => ({ ...prev, ...permState.permsUpdate }));

      // Detect kick
      const kickState = states.find((s) => s.kickTarget === name);
      if (kickState) {
        prov.awareness.setLocalStateField("user", null);
        setScreen("denied");
      }
    };
    updateUsers();
    prov.awareness.on("change", updateUsers);
    unloadCleanupRef.current = () => prov.awareness.off("change", updateUsers);
  }, []);

  const attachContestantWaiting = useCallback((prov, name) => {
    const clientId = getClientId();
    prov.awareness.setLocalStateField("joinRequest", { name, id: clientId });
    const checkDecision = () => {
      const states = Array.from(prov.awareness.getStates().values());
      const decision = states.find((s) => s.approvalFor === name);
      if (!decision) return;
      if (decision.approved === true)  { attachContestantEditor(prov, name); setScreen("editor"); }
      if (decision.approved === false) { setScreen("denied"); }
    };
    prov.awareness.on("change", checkDecision);
    unloadCleanupRef.current = () => prov.awareness.off("change", checkDecision);
  }, [attachContestantEditor]);

  const restoreSession = useCallback(async () => {
    const { userName: name, screen: scr, roomCode: room, role: r } = initial;
    if (!name || !room) { setScreen("lobby"); setRoomCode(""); setRole(""); setBootstrapping(false); return; }
    try {
      if (scr === "editor" && r === "owner") {
        await registerRoom(room);
        attachOwnerSession(connectProvider(room), name);
        setScreen("editor");
      } else if (scr === "editor" && r === "contestant") {
        if (!(await checkRoomExists(room))) { setScreen("lobby"); setRoomCode(""); setRole(""); }
        else { attachContestantEditor(connectProvider(room), name); setScreen("editor"); }
      } else if (scr === "waiting") {
        if (!(await checkRoomExists(room))) { setScreen("lobby"); setRoomCode(""); setRole(""); }
        else { setRole("contestant"); attachContestantWaiting(connectProvider(room), name); setScreen("waiting"); }
      } else { setScreen("lobby"); setRoomCode(""); setRole(""); }
    } catch { setScreen("lobby"); setRoomCode(""); setRole(""); }
    finally { setBootstrapping(false); }
  }, [initial, connectProvider, attachOwnerSession, attachContestantEditor, attachContestantWaiting]);

  useEffect(() => {
    if (initial.screen === "editor" || initial.screen === "waiting") restoreSession();
    return () => { unloadCleanupRef.current?.(); providerRef.current?.destroy?.(); };
  }, [initial.screen, restoreSession]);

  const handleMount = (editor) => {
    editorRef.current = editor;
    new MonacoBinding(ytext, editorRef.current.getModel(), new Set([editorRef.current]));
    // Set initial read-only state
    if (role !== "owner") editor.updateOptions({ readOnly: true });
  };

  /* Owner: Create Room */
  const handleCreateRoom = useCallback(async () => {
    const code = genRoomCode();
    await registerRoom(code);
    setRoomCode(code); setRole("owner");
    attachOwnerSession(connectProvider(code), userName);
    setScreen("editor");
  }, [userName, connectProvider, attachOwnerSession]);

  /* Contestant: Request to join */
  const handleJoinRequest = useCallback(async (code) => {
    if (!(await checkRoomExists(code))) return { ok: false };
    setRoomCode(code); setRole("contestant");
    attachContestantWaiting(connectProvider(code), userName);
    setScreen("waiting");
    return { ok: true };
  }, [userName, connectProvider, attachContestantWaiting]);

  /* Owner: Approve / Deny */
  const handleApprove = useCallback((reqName) => {
    providerRef.current?.awareness.setLocalStateField("approvalFor", reqName);
    providerRef.current?.awareness.setLocalStateField("approved", true);
    setPendingRequests((p) => p.filter((r) => r.name !== reqName));
    setTimeout(() => {
      providerRef.current?.awareness.setLocalStateField("approvalFor", null);
      providerRef.current?.awareness.setLocalStateField("approved", null);
    }, 3000);
  }, []);

  const handleDeny = useCallback((reqName) => {
    providerRef.current?.awareness.setLocalStateField("approvalFor", reqName);
    providerRef.current?.awareness.setLocalStateField("approved", false);
    setPendingRequests((p) => p.filter((r) => r.name !== reqName));
    setTimeout(() => {
      providerRef.current?.awareness.setLocalStateField("approvalFor", null);
      providerRef.current?.awareness.setLocalStateField("approved", null);
    }, 3000);
  }, []);

  /* ── Permission actions (owner only) ── */
  const broadcastPerms = useCallback((newPerms) => {
    setPermissions(newPerms);
    providerRef.current?.awareness.setLocalStateField("permsUpdate", newPerms);
    setTimeout(() => providerRef.current?.awareness.setLocalStateField("permsUpdate", null), 3000);
  }, []);

  const handleGrantWrite = useCallback((targetName) => {
    setPermissions((prev) => {
      const next = { ...prev, [targetName]: { ...prev[targetName], canWrite: true } };
      broadcastPerms(next);
      return next;
    });
  }, [broadcastPerms]);

  const handleRevokeWrite = useCallback((targetName) => {
    setPermissions((prev) => {
      const next = { ...prev, [targetName]: { ...prev[targetName], canWrite: false } };
      broadcastPerms(next);
      return next;
    });
  }, [broadcastPerms]);

  const handleGrantSenior = useCallback((targetName) => {
    setPermissions((prev) => {
      const next = { ...prev, [targetName]: { ...prev[targetName], isSenior: true, canWrite: true } };
      broadcastPerms(next);
      return next;
    });
  }, [broadcastPerms]);

  const handleRevokeSenior = useCallback((targetName) => {
    setPermissions((prev) => {
      const next = { ...prev, [targetName]: { ...prev[targetName], isSenior: false } };
      broadcastPerms(next);
      return next;
    });
  }, [broadcastPerms]);

  const handleKick = useCallback((targetName) => {
    providerRef.current?.awareness.setLocalStateField("kickTarget", targetName);
    setUsers((prev) => prev.filter((u) => u.name !== targetName));
    setTimeout(() => providerRef.current?.awareness.setLocalStateField("kickTarget", null), 4000);
  }, []);

  if (bootstrapping) return (
    <CyberBg>
      <div style={{ ...S.card, alignItems: "center", textAlign: "center" }}>
        <Logo />
        <h2 style={{ ...S.bigTitle, fontSize: 17, marginTop: 8 }}>RECONNECTING</h2>
        <p style={S.sub}>Restoring your session…</p>
        <CornerDots />
      </div>
    </CyberBg>
  );

  if (screen === "name")    return <NameScreen initialName={parseUrlState().userName} onDone={(name) => { setUserName(name); setScreen("lobby"); }} />;
  if (screen === "lobby")   return <LobbyScreen userName={userName} onCreate={handleCreateRoom} onJoin={handleJoinRequest} />;
  if (screen === "waiting") return <WaitingScreen userName={userName} roomCode={roomCode} />;
  if (screen === "denied")  return <DeniedScreen onBack={() => { setScreen("lobby"); setRoomCode(""); setRole(""); }} />;
  if (screen === "editor")  return (
    <EditorScreen
      users={users} role={role} roomCode={roomCode} userName={userName}
      pendingRequests={pendingRequests}
      permissions={permissions}
      onApprove={handleApprove} onDeny={handleDeny}
      onGrantWrite={handleGrantWrite} onRevokeWrite={handleRevokeWrite}
      onGrantSenior={handleGrantSenior} onRevokeSenior={handleRevokeSenior}
      onKick={handleKick}
      handleMount={handleMount}
      compilerOpen={compilerOpen} setCompilerOpen={setCompilerOpen}
      editorRef={editorRef}
    />
  );
  return null;
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Name Entry
══════════════════════════════════════════════════════════════════════ */
const NameScreen = ({ onDone, initialName = "" }) => {
  const cardRef = useRef(null);
  const [val, setVal] = useState(initialName);
  useEnsureGSAP(() => window.gsap.from(cardRef.current, { y: 60, opacity: 0, duration: 0.9, ease: "power3.out" }));
  const submit = (e) => { e.preventDefault(); if (val.trim()) onDone(val.trim()); };
  return (
    <CyberBg>
      <div ref={cardRef} style={S.card}>
        <Logo />
        <h1 style={S.bigTitle}>WHO ARE YOU?</h1>
        <p style={S.sub}>Enter your callsign to begin</p>
        <form onSubmit={submit} style={{ width:"100%", display:"flex", flexDirection:"column", gap:12, marginTop:28 }}>
          <TermInput prefix="~/id >" placeholder="your_callsign" value={val} onChange={(e) => setVal(e.target.value)} />
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
  const [joining, setJoining] = useState(false);
  const [invalidToast, setInvalidToast] = useState(false);

  useEnsureGSAP(() => window.gsap.from(cardRef.current, { y: 60, opacity: 0, duration: 0.9, ease: "power3.out" }));

  const showInvalidRoomToast = () => {
    setInvalidToast(true); setJoinMode(false); setCode(""); setErr("");
    setTimeout(() => setInvalidToast(false), 4000);
  };

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (code.trim().length < 4) { setErr("Invalid room code."); return; }
    setJoining(true); setErr("");
    const result = await onJoin(code.trim().toUpperCase());
    setJoining(false);
    if (!result?.ok) showInvalidRoomToast();
  };

  return (
    <CyberBg>
      {invalidToast && (
        <div style={S.invalidToast}>
          <span style={S.invalidToastIcon}>✕</span>
          <div>
            <div style={S.invalidToastTitle}>INVALID ROOM CODE</div>
            <p style={S.invalidToastMsg}>This room does not exist. Check the code and try again.</p>
          </div>
        </div>
      )}
      <div ref={cardRef} style={{ ...S.card, width: 500 }}>
        <Logo />
        <div style={S.greeting}>
          <span style={{ color:"rgba(255,255,255,0.35)" }}>WELCOME,&nbsp;</span>
          <span style={{ color:"#00ffe7", fontFamily:"'Orbitron',sans-serif", letterSpacing:"0.1em" }}>{userName}</span>
        </div>
        <Divider label="SELECT MODE" />
        {!joinMode ? (
          <div style={S.modeGrid}>
            <ModeCard icon="⬡" label="CREATE ROOM" badge="HOST" desc={"Start a new session.\nYou are the owner."} color="#00ffe7" onClick={onCreate} />
            <ModeCard icon="◈" label="JOIN ROOM" badge="CONTESTANT" desc={"Enter an existing\nroom with a code."} color="#ff4ecd" onClick={() => setJoinMode(true)} />
          </div>
        ) : (
          <form onSubmit={handleJoinSubmit} style={{ display:"flex", flexDirection:"column", gap:12, marginTop:6 }}>
            <p style={{ ...S.sub, textAlign:"left", marginBottom:4 }}>Enter the room code shared by the host:</p>
            <TermInput prefix="~/code >" placeholder="XXXXXX" value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(""); }}
              extraStyle={{ textTransform:"uppercase", letterSpacing:"0.3em", fontSize:16 }}
            />
            {err && <span style={{ color:"#ff4ecd", fontSize:10, letterSpacing:"0.1em" }}>{err}</span>}
            <div style={{ display:"flex", gap:10 }}>
              <CyberBtn type="button" accent="rgba(255,255,255,0.25)" onClick={() => setJoinMode(false)} style={{ flex:1 }}>BACK</CyberBtn>
              <CyberBtn type="submit" style={{ flex:2, opacity: joining ? 0.6 : 1 }} disabled={joining}>
                {joining ? "CHECKING…" : "REQUEST TO JOIN →"}
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
   SCREEN: Waiting
══════════════════════════════════════════════════════════════════════ */
const WaitingScreen = ({ userName, roomCode }) => {
  const ringRef = useRef(null);
  useEnsureGSAP(() => window.gsap.to(ringRef.current, { rotation:360, duration:2.5, repeat:-1, ease:"none", transformOrigin:"center center" }));
  return (
    <CyberBg>
      <div style={{ ...S.card, alignItems:"center", textAlign:"center" }}>
        <Logo />
        <div ref={ringRef} style={{ marginTop:10 }}>
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r="32" fill="none" stroke="rgba(0,255,231,0.12)" strokeWidth="2"/>
            <circle cx="38" cy="38" r="32" fill="none" stroke="#00ffe7" strokeWidth="2" strokeDasharray="48 155" strokeLinecap="round"/>
          </svg>
        </div>
        <h2 style={{ ...S.bigTitle, fontSize:17, marginTop:18 }}>AWAITING APPROVAL</h2>
        <p style={{ ...S.sub, lineHeight:1.8 }}>
          Request sent to room&nbsp;
          <span style={{ color:"#00ffe7", fontFamily:"'Orbitron',sans-serif", letterSpacing:"0.2em" }}>{roomCode}</span>
          <br/>The host will approve or deny shortly.
        </p>
        <div style={S.waitTag}><span style={S.waitDot}/>{userName}</div>
        <CornerDots />
      </div>
    </CyberBg>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Denied / Kicked
══════════════════════════════════════════════════════════════════════ */
const DeniedScreen = ({ onBack }) => (
  <CyberBg>
    <div style={{ ...S.card, alignItems:"center", textAlign:"center" }}>
      <div style={{ fontSize:48, color:"#ff4ecd", marginBottom:12, lineHeight:1 }}>✕</div>
      <h2 style={{ ...S.bigTitle, color:"#ff4ecd", fontSize:20 }}>ACCESS DENIED</h2>
      <p style={{ ...S.sub, marginTop:8 }}>The host declined your request or removed you from the room.</p>
      <div style={{ marginTop:28, width:"100%" }}>
        <CyberBtn accent="#ff4ecd" onClick={onBack}>← BACK TO LOBBY</CyberBtn>
      </div>
      <CornerDots color="#ff4ecd"/>
    </div>
  </CyberBg>
);

/* ══════════════════════════════════════════════════════════════════════
   THREE-DOT MENU COMPONENT
══════════════════════════════════════════════════════════════════════ */
const UserMenu = ({ user, permissions, isOwner, isSeniorViewer, onGrantWrite, onRevokeWrite, onGrantSenior, onRevokeSenior, onKick }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const perms = permissions[user.name] || {};

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Only owner or senior can open menu; can't open on owner or self
  const canManage = isOwner || isSeniorViewer;
  if (!canManage || user.role === "owner") return null;

  const menuItems = [];

  if (isOwner) {
    // Write permission
    if (!perms.canWrite) {
      menuItems.push({ label: `Allow ${user.name} to write`, icon: "✏", action: () => { onGrantWrite(user.name); setOpen(false); }, color: "#00ffe7" });
    } else {
      menuItems.push({ label: `Revoke write access`, icon: "", action: () => { onRevokeWrite(user.name); setOpen(false); }, color: "#ffe600" });
    }

    // Senior role
    if (!perms.isSenior) {
      menuItems.push({ label: `Promote to Senior`, icon: "", action: () => { onGrantSenior(user.name); setOpen(false); }, color: "#ffe600" });
    } else {
      menuItems.push({ label: `Demote from Senior`, icon: "↓", action: () => { onRevokeSenior(user.name); setOpen(false); }, color: "#ff9f1c" });
    }

    // Separator + destructive
    menuItems.push({ divider: true });
    menuItems.push({ label: `Remove from room`, icon: "✕", action: () => { onKick(user.name); setOpen(false); }, color: "#ff4ecd", danger: true });
  } else if (isSeniorViewer) {
    // Senior can only kick non-seniors
    if (!perms.isSenior) {
      menuItems.push({ label: `Remove from room`, icon: "✕", action: () => { onKick(user.name); setOpen(false); }, color: "#ff4ecd", danger: true });
    }
  }

  if (menuItems.length === 0) return null;

  return (
    <div ref={menuRef} style={{ position:"relative", flexShrink:0 }}>
      <button
        style={MS.trigger}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Manage user"
      >
        ···
      </button>
      {open && (
        <div style={MS.dropdown}>
          {/* Arrow */}
          <div style={MS.arrow}/>
          {menuItems.map((item, i) =>
            item.divider ? (
              <div key={i} style={MS.divider}/>
            ) : (
              <button
                key={i}
                style={{ ...MS.item, color: item.color, ...(item.danger ? MS.danger : {}) }}
                onClick={item.action}
                onMouseEnter={(e) => e.currentTarget.style.background = item.danger ? "rgba(255,78,205,0.1)" : "rgba(255,255,255,0.05)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={MS.itemIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
};

const MS = {
  trigger: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.35)",
    borderRadius: 2,
    cursor: "pointer",
    fontSize: 13,
    padding: "0px 5px",
    lineHeight: "18px",
    letterSpacing: "0.05em",
    transition: "all 0.14s",
    flexShrink: 0,
  },
  dropdown: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    background: "#0a0d14",
    border: "1px solid rgba(0,255,231,0.18)",
    borderRadius: 3,
    minWidth: 196,
    zIndex: 999,
    boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,255,231,0.05)",
    overflow: "hidden",
  },
  arrow: {
    position: "absolute",
    top: -5,
    right: 8,
    width: 8,
    height: 8,
    background: "#0a0d14",
    border: "1px solid rgba(0,255,231,0.18)",
    borderBottom: "none",
    borderRight: "none",
    transform: "rotate(45deg)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: "transparent",
    border: "none",
    padding: "9px 14px",
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10.5,
    letterSpacing: "0.04em",
    textAlign: "left",
    transition: "background 0.12s",
  },
  itemIcon: { fontSize: 12, flexShrink: 0, width: 16, textAlign: "center" },
  divider: { height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 0" },
  danger: { color: "#ff4ecd" },
};

/* ══════════════════════════════════════════════════════════════════════
   SCREEN: Editor
══════════════════════════════════════════════════════════════════════ */
const EditorScreen = ({
  users, role, roomCode, userName, pendingRequests,
  permissions, onApprove, onDeny,
  onGrantWrite, onRevokeWrite, onGrantSenior, onRevokeSenior, onKick,
  handleMount, compilerOpen, setCompilerOpen, editorRef,
}) => {
  const headerRef = useRef(null);
  const sideRef   = useRef(null);
  const edRef     = useRef(null);
  const [time, setTime]     = useState(new Date());
  const [copied, setCopied] = useState(false);

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  useEnsureGSAP(() => {
    const g = window.gsap;
    g.from(headerRef.current, { y:-50, opacity:0, duration:0.7, ease:"power3.out" });
    g.from(sideRef.current,   { x:-50, opacity:0, duration:0.7, delay:0.1, ease:"power3.out" });
    g.from(edRef.current,     { x:50,  opacity:0, duration:0.7, delay:0.2, ease:"power3.out" });
  });

  useEffect(() => {
    if (window.gsap && users.length > 0)
      window.gsap.from(".u-pill:last-child", { x:-14, opacity:0, duration:0.4, ease:"back.out(1.7)" });
  }, [users.length]);

  useEffect(() => {
    if (window.gsap && pendingRequests.length > 0)
      window.gsap.from(".req-pill:last-child", { y:-10, opacity:0, duration:0.35, ease:"power2.out" });
  }, [pendingRequests.length]);

  const copyCode = () => { navigator.clipboard.writeText(roomCode); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  const isOwner  = role === "owner";

  // My own permissions
  const myPerms     = permissions[userName] || {};
  const isSenior    = myPerms.isSenior === true;
  const canWrite    = isOwner || myPerms.canWrite === true;

  const timeStr = time.toLocaleTimeString("en-GB", { hour12: false });

  // Build my status label
  const myStatusLabel = isOwner ? "HOST" : isSenior ? "SENIOR" : canWrite ? "WRITER" : "VIEWER";
  const myStatusColor = isOwner ? "#00ffe7" : isSenior ? "#ffe600" : canWrite ? "#a8ff3e" : "#ff4ecd";

  const getRoleBadge = (u) => {
    if (u.role === "owner") return { label: "HOST",   color: "#00ffe7" };
    const p = permissions[u.name] || {};
    if (p.isSenior)  return { label: "SENIOR", color: "#ffe600" };
    if (p.canWrite)  return { label: "WRITER", color: "#a8ff3e" };
    return                  { label: "VIEWER", color: "#ff4ecd" };
  };

  return (
    <div style={S.appBg}>
      <div style={S.grid}/>
      <div style={S.scanlines}/>

      {/* ── Header ── */}
      <header ref={headerRef} style={S.header}>
        <div style={S.hLeft}>
          <Logo small/>
          <span style={S.hBrand}>SYNCED<span style={{ color:"#00ffe7" }}>CODE</span></span>
          <span style={{ ...S.hTag, background:`${myStatusColor}14`, borderColor:`${myStatusColor}55`, color:myStatusColor }}>
            {myStatusLabel}
          </span>
        </div>
        <div style={S.hCenter}>
          <span style={S.statusDot}/>
          <span style={S.hStatusTxt}>{users.length} LIVE</span>
          <span style={S.hSep}/>
          {!canWrite && !isOwner && (
            <span style={{ fontSize:8, letterSpacing:"0.15em", color:"rgba(255,78,205,0.7)", marginRight:8 }}>
              👁 READ ONLY
            </span>
          )}
          <span style={S.hClock}>{timeStr}</span>
        </div>
        <div style={S.hRight}>
          <div style={S.codeBox} onClick={copyCode} title="Click to copy">
            <span style={S.codeBoxLabel}>ROOM</span>
            <span style={S.codeBoxVal}>{roomCode}</span>
            <span style={{ fontSize:11, color: copied ? "#00ffe7" : "rgba(255,255,255,0.28)", marginLeft:6, transition:"color 0.2s" }}>
              {copied ? "✓" : "⧉"}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={S.body}>

        {/* ── Sidebar ── */}
        <aside ref={sideRef} style={S.sidebar}>

          {/* Join Requests — owner only */}
          {isOwner && pendingRequests.length > 0 && (
            <div style={S.reqSection}>
              <SideLabel color="#ffe600">JOIN REQUESTS</SideLabel>
              {pendingRequests.map((req, i) => (
                <div key={i} className="req-pill" style={S.reqPill}>
                  <span style={S.reqName}>{req.name}</span>
                  <div style={{ display:"flex", gap:6 }}>
                    <button style={S.approveBtn} onClick={() => onApprove(req.name)}
                      onMouseEnter={(e) => e.currentTarget.style.background="rgba(0,255,100,0.25)"}
                      onMouseLeave={(e) => e.currentTarget.style.background="rgba(0,255,100,0.1)"}>✓</button>
                    <button style={S.denyBtn} onClick={() => onDeny(req.name)}
                      onMouseEnter={(e) => e.currentTarget.style.background="rgba(255,78,205,0.25)"}
                      onMouseLeave={(e) => e.currentTarget.style.background="rgba(255,78,205,0.1)"}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Participants */}
          <div style={S.sideSection}>
            <SideLabel>PARTICIPANTS</SideLabel>
            <ul style={{ listStyle:"none", padding:0, margin:0 }}>
              {users.map((u, i) => {
                const badge = getRoleBadge(u);
                const isMe  = u.name === userName;
                return (
                  <li key={i} className="u-pill" style={S.userPill}
                    onMouseEnter={(e) => { e.currentTarget.style.background=`${u.color}12`; e.currentTarget.style.borderColor=u.color; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background="rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.06)"; }}
                  >
                    <span style={{ ...S.uDot, background:u.color, boxShadow:`0 0 8px ${u.color}` }}/>
                    <span style={S.uName}>
                      {u.name}
                      {isMe && <span style={{ color:"rgba(255,255,255,0.3)", fontSize:9 }}> (you)</span>}
                    </span>
                    <span style={{ ...S.uRoleBadge, borderColor:badge.color, color:badge.color }}>{badge.label}</span>

                    {/* 3-dot menu — shown for non-self, non-owner users when viewer has manage rights */}
                    {!isMe && (
                      <UserMenu
                        user={u}
                        permissions={permissions}
                        isOwner={isOwner}
                        isSeniorViewer={isSenior}
                        onGrantWrite={onGrantWrite}
                        onRevokeWrite={onRevokeWrite}
                        onGrantSenior={onGrantSenior}
                        onRevokeSenior={onRevokeSenior}
                        onKick={onKick}
                      />
                    )}
                  </li>
                );
              })}
              {users.length === 0 && (
                <li style={{ textAlign:"center", padding:"18px 0", color:"rgba(255,255,255,0.2)", fontSize:10, letterSpacing:"0.1em" }}>
                  CONNECTING…
                </li>
              )}
            </ul>
          </div>

          {/* Session Info */}
          <div style={S.statsPanel}>
            <SideLabel>SESSION</SideLabel>
            {[
              ["PROTOCOL","Y.JS/CRDT"],["TRANSPORT","SOCKET.IO"],
              ["LANGUAGE","JS"],["ROOM",roomCode],
            ].map(([k,v]) => (
              <div key={k} style={S.statRow}>
                <span style={S.statK}>{k}</span>
                <span style={{ ...S.statV, ...(k==="ROOM" ? { color:"#00ffe7", fontFamily:"'Orbitron',sans-serif", letterSpacing:"0.12em" } : {}) }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Visualizer bars */}
          <div style={S.vizRow}>
            {[...Array(10)].map((_,i) => (
              <div key={i} style={{ ...S.vizBar, animationDelay:`${i*0.14}s`, height:`${6+Math.random()*24}px` }}/>
            ))}
          </div>
        </aside>

        {/* ── Editor Section ── */}
        <section ref={edRef} style={S.edWrap}>
          <div style={S.edHeader}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ display:"flex", gap:4 }}>
                <div style={S.tab}><span style={S.tabDot}/>main.js</div>
              </div>
              {/* Read-only indicator in tab bar */}
              {!canWrite && (
                <span style={{ fontSize:8, letterSpacing:"0.15em", color:"rgba(255,78,205,0.6)", border:"1px solid rgba(255,78,205,0.2)", padding:"2px 7px", borderRadius:2 }}>
                  READ ONLY
                </span>
              )}
              <button
                type="button"
                onClick={() => setCompilerOpen((o) => !o)}
                style={{
                  fontFamily:"'Orbitron',sans-serif", fontSize:9, fontWeight:700,
                  letterSpacing:"0.2em", padding:"4px 12px", cursor:"pointer",
                  background: compilerOpen ? "#00ffe7" : "transparent",
                  color: compilerOpen ? "#000" : "#00ffe7",
                  border:"1px solid rgba(0,255,231,0.4)", borderRadius:2, transition:"all 0.15s",
                }}
              >▶ RUN</button>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              {["rgba(255,59,48,0.75)","rgba(245,166,35,0.75)","rgba(126,211,33,0.75)"].map((c,i) => (
                <span key={i} style={{ ...S.winDot, background:c }}/>
              ))}
            </div>
          </div>

          {/* Monaco */}
          <div style={{ flex: compilerOpen ? "0 0 55%" : 1, overflow:"hidden", transition:"flex 0.3s ease", minHeight:0 }}>
            <Editor
              height="100%"
              defaultLanguage="javascript"
              defaultValue="// Start coding here…"
              theme="vs-dark"
              onMount={handleMount}
              options={{
                fontSize:14,
                fontFamily:"'JetBrains Mono','Fira Code',monospace",
                fontLigatures:true,
                minimap:{ enabled:true },
                padding:{ top:16 },
                scrollbar:{ verticalScrollbarSize:4 },
                lineHeight:22,
                cursorBlinking:"phase",
                smoothScrolling:true,
                // readOnly is set dynamically via editorRef.updateOptions
              }}
            />
          </div>

          {/* Compiler Panel */}
          <div style={{
            flex: compilerOpen ? "1 1 0" : "0 0 0",
            minHeight:0, overflow:"hidden",
            display: compilerOpen ? "flex" : "none",
            flexDirection:"column",
          }}>
            <JSCompiler
              getCode={() => editorRef.current?.getValue() ?? ""}
              isOpen={compilerOpen}
              onClose={() => setCompilerOpen(false)}
            />
          </div>
        </section>
      </div>

      <GlobalStyles/>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   SHARED COMPONENTS
══════════════════════════════════════════════════════════════════════ */
const CyberBg = ({ children }) => (
  <div style={S.loginBg}>
    <div style={S.grid}/><div style={S.scanlines}/>
    <div style={{ ...S.blob, top:"8%",  left:"12%",  background:"rgba(0,255,231,0.055)" }}/>
    <div style={{ ...S.blob, bottom:"10%", right:"8%", background:"rgba(255,78,205,0.045)", width:360, height:360 }}/>
    {children}
  </div>
);

const Logo = ({ small }) => (
  <div style={{ display:"flex", justifyContent: small?"flex-start":"center", marginBottom: small?0:22, marginRight: small?10:0 }}>
    <svg width={small?22:32} height={small?22:32} viewBox="0 0 36 36" fill="none">
      <polygon points="18,2 34,32 2,32" fill="none" stroke="#00ffe7" strokeWidth="1.8"/>
      <polygon points="18,10 28,28 8,28" fill="#00ffe7" opacity="0.15"/>
    </svg>
  </div>
);

const TermInput = ({ prefix, extraStyle, ...props }) => (
  <div style={S.inputWrap}>
    <span style={S.inputPfx}>{prefix}</span>
    <input {...props} style={{ ...S.input, ...extraStyle }}
      onFocus={(e) => e.target.parentElement.style.boxShadow="0 0 0 1px #00ffe7, 0 0 20px rgba(0,255,231,0.14)"}
      onBlur={(e)  => e.target.parentElement.style.boxShadow="0 0 0 1px rgba(0,255,231,0.22)"}
    />
  </div>
);

const CyberBtn = ({ children, accent, style: extra, disabled, ...props }) => (
  <button {...props} disabled={disabled}
    style={{ ...S.cyberBtn, ...(accent?{borderColor:accent,color:accent}:{}), ...extra, ...(disabled?{opacity:0.55,cursor:"not-allowed"}:{}) }}
    onMouseEnter={(e) => { if(disabled) return; e.currentTarget.style.background=accent||"#00ffe7"; e.currentTarget.style.color="#000"; }}
    onMouseLeave={(e) => { if(disabled) return; e.currentTarget.style.background="transparent"; e.currentTarget.style.color=accent||"#00ffe7"; }}
  >{children}</button>
);

const ModeCard = ({ icon, label, badge, desc, color, onClick }) => (
  <div style={S.modeCard} onClick={onClick}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor=color; e.currentTarget.style.background=`${color}08`; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor="rgba(0,255,231,0.12)"; e.currentTarget.style.background="rgba(0,255,231,0.015)"; }}
  >
    <div style={{ ...S.modeIcon, color }}>{icon}</div>
    <div style={S.modeLabel}>{label}</div>
    <div style={S.modeDesc}>{desc.split("\n").map((l,i)=><span key={i}>{l}<br/></span>)}</div>
    <div style={{ ...S.modeBadge, borderColor:color, color }}>{badge}</div>
  </div>
);

const CornerDots = ({ color="#00ffe7" }) => (
  <>
    {[
      { top:10, left:10,  borderTop:`1.5px solid ${color}`, borderLeft:`1.5px solid ${color}` },
      { top:10, right:10, borderTop:`1.5px solid ${color}`, borderRight:`1.5px solid ${color}` },
      { bottom:10, left:10,  borderBottom:`1.5px solid ${color}`, borderLeft:`1.5px solid ${color}` },
      { bottom:10, right:10, borderBottom:`1.5px solid ${color}`, borderRight:`1.5px solid ${color}` },
    ].map((s,i) => <div key={i} style={{ position:"absolute", width:14, height:14, ...s }}/>)}
  </>
);

const Divider = ({ label }) => (
  <div style={{ display:"flex", alignItems:"center", gap:10, margin:"6px 0 22px" }}>
    <span style={{ flex:1, height:1, background:"rgba(0,255,231,0.15)" }}/>
    <span style={{ fontSize:8, letterSpacing:"0.3em", color:"rgba(0,255,231,0.4)" }}>{label}</span>
    <span style={{ flex:1, height:1, background:"rgba(0,255,231,0.15)" }}/>
  </div>
);

const SideLabel = ({ children, color="rgba(0,255,231,0.45)" }) => (
  <div style={{ fontSize:7.5, letterSpacing:"0.25em", display:"flex", alignItems:"center", gap:8, marginBottom:12, color }}>
    <span style={{ flex:1, height:1, background:"currentColor", opacity:0.3 }}/>
    {children}
    <span style={{ flex:1, height:1, background:"currentColor", opacity:0.3 }}/>
  </div>
);

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Orbitron:wght@400;600;800&display=swap');
    * { box-sizing:border-box; margin:0; padding:0; }
    input::placeholder { color:rgba(255,255,255,0.18); }
    ::-webkit-scrollbar { width:4px; background:transparent; }
    ::-webkit-scrollbar-thumb { background:rgba(0,255,231,0.18); border-radius:2px; }
    @keyframes gridPulse { 0%,100%{opacity:.04} 50%{opacity:.08} }
    @keyframes barAnim   { 0%,100%{opacity:.3;transform:scaleY(1)} 50%{opacity:1;transform:scaleY(1.5)} }
    @keyframes tabBlink  { 0%,100%{opacity:1} 50%{opacity:0} }
    @keyframes glowPulse { 0%,100%{box-shadow:0 0 5px rgba(0,255,231,0.5)} 50%{box-shadow:0 0 18px rgba(0,255,231,1)} }
    @keyframes waitAnim  { 0%,100%{opacity:0.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.03)} }
  `}</style>
);

/* ══════════════════════════════════════════════════════════════════════
   STYLES
══════════════════════════════════════════════════════════════════════ */
const S = {
  loginBg:  { height:"100vh", width:"100vw", background:"#020408", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden", fontFamily:"'JetBrains Mono',monospace" },
  appBg:    { height:"100vh", width:"100vw", background:"#020408", display:"flex", flexDirection:"column", fontFamily:"'JetBrains Mono',monospace", overflow:"hidden", position:"relative" },
  grid:     { position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(0,255,231,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,231,0.05) 1px,transparent 1px)", backgroundSize:"44px 44px", animation:"gridPulse 5s ease-in-out infinite", pointerEvents:"none" },
  scanlines:{ position:"absolute", inset:0, background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.07) 2px,rgba(0,0,0,0.07) 4px)", pointerEvents:"none", zIndex:1 },
  blob:     { position:"absolute", width:420, height:420, borderRadius:"50%", filter:"blur(100px)", pointerEvents:"none" },

  card:     { position:"relative", zIndex:10, background:"rgba(2,4,8,0.93)", border:"1px solid rgba(0,255,231,0.16)", borderRadius:3, padding:"46px 48px", width:440, backdropFilter:"blur(28px)", boxShadow:"0 0 80px rgba(0,255,231,0.04),inset 0 0 40px rgba(0,255,231,0.02)", display:"flex", flexDirection:"column", alignItems:"stretch" },
  bigTitle: { fontFamily:"'Orbitron',sans-serif", fontSize:22, fontWeight:800, color:"#fff", letterSpacing:"0.2em", textAlign:"center", marginBottom:8 },
  sub:      { fontSize:10, letterSpacing:"0.14em", color:"rgba(255,255,255,0.3)", textAlign:"center", lineHeight:1.7 },
  greeting: { fontFamily:"'JetBrains Mono',monospace", fontSize:13, letterSpacing:"0.08em", color:"#fff", textAlign:"center", marginBottom:22 },

  modeGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
  modeCard: { border:"1px solid rgba(0,255,231,0.12)", borderRadius:3, padding:"24px 14px 18px", display:"flex", flexDirection:"column", alignItems:"center", gap:8, cursor:"pointer", transition:"border-color 0.2s,background 0.2s", background:"rgba(0,255,231,0.015)" },
  modeIcon: { fontSize:30, lineHeight:1 },
  modeLabel:{ fontFamily:"'Orbitron',sans-serif", fontSize:10.5, color:"#fff", letterSpacing:"0.15em" },
  modeDesc: { fontSize:9, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", textAlign:"center", lineHeight:1.7 },
  modeBadge:{ fontSize:7, letterSpacing:"0.2em", border:"1px solid", padding:"2px 8px", borderRadius:2, marginTop:2 },

  inputWrap:{ display:"flex", alignItems:"center", background:"rgba(0,255,231,0.025)", border:"1px solid rgba(0,255,231,0.22)", borderRadius:2, padding:"0 14px", transition:"box-shadow 0.2s" },
  inputPfx: { fontSize:10, color:"#00ffe7", fontFamily:"'JetBrains Mono',monospace", whiteSpace:"nowrap", marginRight:8, opacity:0.55 },
  input:    { flex:1, background:"transparent", border:"none", outline:"none", color:"#fff", fontFamily:"'JetBrains Mono',monospace", fontSize:13, padding:"13px 0", letterSpacing:"0.04em" },
  cyberBtn: { background:"transparent", border:"1px solid #00ffe7", color:"#00ffe7", fontFamily:"'Orbitron',sans-serif", fontSize:10, fontWeight:700, letterSpacing:"0.22em", padding:"13px 20px", cursor:"pointer", transition:"all 0.18s", borderRadius:2, width:"100%" },

  invalidToast:     { position:"fixed", top:24, left:"50%", transform:"translateX(-50%)", zIndex:100, display:"flex", alignItems:"flex-start", gap:14, minWidth:320, maxWidth:"90vw", padding:"16px 20px", background:"rgba(40,4,12,0.96)", border:"1px solid rgba(255,78,205,0.55)", borderRadius:3, boxShadow:"0 8px 40px rgba(255,78,205,0.25)" },
  invalidToastIcon: { fontSize:20, color:"#ff4ecd", lineHeight:1, flexShrink:0 },
  invalidToastTitle:{ fontFamily:"'Orbitron',sans-serif", fontSize:11, fontWeight:700, letterSpacing:"0.18em", color:"#ff4ecd", marginBottom:4 },
  invalidToastMsg:  { fontSize:10, letterSpacing:"0.08em", color:"rgba(255,255,255,0.55)", lineHeight:1.6, margin:0 },

  waitTag:  { marginTop:22, display:"flex", alignItems:"center", gap:10, fontSize:11.5, color:"#fff", letterSpacing:"0.1em", animation:"waitAnim 2s ease-in-out infinite" },
  waitDot:  { width:8, height:8, borderRadius:"50%", background:"#00ffe7", display:"inline-block", animation:"glowPulse 1.5s ease-in-out infinite" },

  header:       { height:50, background:"rgba(2,4,8,0.97)", borderBottom:"1px solid rgba(0,255,231,0.09)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 18px", flexShrink:0, position:"relative", zIndex:20 },
  hLeft:        { display:"flex", alignItems:"center", gap:0 },
  hBrand:       { fontFamily:"'Orbitron',sans-serif", fontSize:13, fontWeight:800, color:"#fff", letterSpacing:"0.1em", marginRight:10 },
  hTag:         { fontSize:7.5, letterSpacing:"0.2em", border:"1px solid", padding:"2px 8px", borderRadius:2 },
  hCenter:      { display:"flex", alignItems:"center", gap:8, position:"absolute", left:"50%", transform:"translateX(-50%)" },
  statusDot:    { width:7, height:7, borderRadius:"50%", background:"#00ffe7", display:"inline-block", animation:"glowPulse 2s ease-in-out infinite" },
  hStatusTxt:   { fontSize:9.5, letterSpacing:"0.2em", color:"rgba(0,255,231,0.65)" },
  hSep:         { width:1, height:11, background:"rgba(255,255,255,0.1)", display:"inline-block" },
  hClock:       { fontFamily:"'Orbitron',sans-serif", fontSize:11.5, color:"rgba(255,255,255,0.5)", letterSpacing:"0.08em" },
  hRight:       { display:"flex", alignItems:"center" },
  codeBox:      { display:"flex", alignItems:"center", gap:8, background:"rgba(0,255,231,0.05)", border:"1px solid rgba(0,255,231,0.18)", borderRadius:2, padding:"5px 12px", cursor:"pointer", transition:"background 0.2s" },
  codeBoxLabel: { fontSize:7, letterSpacing:"0.25em", color:"rgba(255,255,255,0.28)" },
  codeBoxVal:   { fontFamily:"'Orbitron',sans-serif", fontSize:13, color:"#00ffe7", letterSpacing:"0.18em" },

  body:       { flex:1, display:"flex", overflow:"hidden", padding:12, gap:12 },
  sidebar:    { width:220, flexShrink:0, background:"rgba(2,4,8,0.85)", border:"1px solid rgba(0,255,231,0.07)", borderRadius:3, display:"flex", flexDirection:"column", overflow:"hidden" },
  sideSection:{ padding:"18px 14px 10px", flex:1 },
  reqSection: { padding:"14px 14px 10px", borderBottom:"1px solid rgba(255,230,0,0.09)", background:"rgba(255,230,0,0.018)" },
  reqPill:    { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", marginBottom:6, borderRadius:2, border:"1px solid rgba(255,230,0,0.2)", background:"rgba(255,230,0,0.03)" },
  reqName:    { fontSize:10.5, color:"rgba(255,255,255,0.8)", letterSpacing:"0.05em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, marginRight:8 },
  approveBtn: { background:"rgba(0,255,100,0.1)", border:"1px solid rgba(0,255,100,0.4)", color:"#00ff64", borderRadius:2, cursor:"pointer", fontSize:13, padding:"2px 8px", transition:"background 0.15s" },
  denyBtn:    { background:"rgba(255,78,205,0.1)", border:"1px solid rgba(255,78,205,0.4)", color:"#ff4ecd", borderRadius:2, cursor:"pointer", fontSize:13, padding:"2px 8px", transition:"background 0.15s" },
  userPill:   { display:"flex", alignItems:"center", gap:6, padding:"7px 8px", marginBottom:5, borderRadius:2, border:"1px solid rgba(255,255,255,0.06)", background:"rgba(255,255,255,0.02)", cursor:"default", transition:"all 0.18s" },
  uDot:       { width:8, height:8, borderRadius:"50%", flexShrink:0 },
  uName:      { flex:1, fontSize:10.5, color:"rgba(255,255,255,0.8)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", letterSpacing:"0.04em" },
  uRoleBadge: { fontSize:7, letterSpacing:"0.18em", border:"1px solid", padding:"2px 5px", borderRadius:2, flexShrink:0 },
  statsPanel: { borderTop:"1px solid rgba(0,255,231,0.06)", padding:"12px 14px" },
  statRow:    { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:7 },
  statK:      { fontSize:7.5, letterSpacing:"0.18em", color:"rgba(255,255,255,0.25)" },
  statV:      { fontSize:8.5, letterSpacing:"0.07em", color:"rgba(255,255,255,0.62)", fontWeight:600 },
  vizRow:     { borderTop:"1px solid rgba(0,255,231,0.06)", padding:"8px 14px", display:"flex", alignItems:"flex-end", gap:3, height:44 },
  vizBar:     { flex:1, background:"rgba(0,255,231,0.32)", borderRadius:1, animation:"barAnim 1.4s ease-in-out infinite" },
  edWrap:     { flex:1, minHeight:0, background:"rgba(2,4,8,0.6)", border:"1px solid rgba(0,255,231,0.07)", borderRadius:3, display:"flex", flexDirection:"column", overflow:"hidden" },
  edHeader:   { height:38, background:"rgba(0,0,0,0.42)", borderBottom:"1px solid rgba(0,255,231,0.07)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 12px", flexShrink:0 },
  tab:        { display:"flex", alignItems:"center", gap:7, fontSize:10.5, color:"rgba(255,255,255,0.72)", letterSpacing:"0.05em", padding:"3px 12px", background:"rgba(0,255,231,0.04)", border:"1px solid rgba(0,255,231,0.12)", borderRadius:2 },
  tabDot:     { width:6, height:6, borderRadius:"50%", background:"#00ffe7", display:"inline-block", animation:"tabBlink 2.5s ease-in-out infinite" },
  winDot:     { width:10, height:10, borderRadius:"50%", display:"inline-block", cursor:"pointer" },
};

export default App;