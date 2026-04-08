import { useState, useRef, useEffect } from "react"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const METHOD_COLORS = {
  GET: { bg: "rgba(97,175,254,0.15)", color: "#61affe", border: "rgba(97,175,254,0.4)" },
  POST: { bg: "rgba(73,204,144,0.15)", color: "#49cc90", border: "rgba(73,204,144,0.4)" },
  PUT: { bg: "rgba(252,161,48,0.15)", color: "#fca130", border: "rgba(252,161,48,0.4)" },
  PATCH: { bg: "rgba(80,227,194,0.15)", color: "#50e3c2", border: "rgba(80,227,194,0.4)" },
  DELETE: { bg: "rgba(249,62,62,0.15)", color: "#f93e3e", border: "rgba(249,62,62,0.4)" },
  HEAD: { bg: "rgba(144,18,254,0.15)", color: "#9012fe", border: "rgba(144,18,254,0.4)" },
  OPTIONS: { bg: "rgba(13,90,167,0.15)", color: "#0d5aa7", border: "rgba(13,90,167,0.4)" },
}

const SIDEBAR_ITEMS = [
  { icon: "⚡", label: "APIs", id: "apis" },
  { icon: "⬡", label: "Debug", id: "debug" },
  { icon: "⬢", label: "Testing", id: "testing" },
  { icon: "◈", label: "Mock", id: "mock" },
  { icon: "◻", label: "Docs", id: "docs" },
]

const SAMPLE_COLLECTION = [
  {
    id: "f1", type: "folder", name: "User Management", open: true,
    children: [
      { id: "r1", type: "request", method: "GET", name: "Get all users", path: "/api/users" },
      { id: "r2", type: "request", method: "POST", name: "Create user", path: "/api/users" },
      { id: "r3", type: "request", method: "PUT", name: "Update user", path: "/api/users/:id" },
      { id: "r4", type: "request", method: "DELETE", name: "Delete user", path: "/api/users/:id" },
    ]
  },
  {
    id: "f2", type: "folder", name: "Authentication", open: false,
    children: [
      { id: "r5", type: "request", method: "POST", name: "Login", path: "/api/auth/login" },
      { id: "r6", type: "request", method: "POST", name: "Refresh token", path: "/api/auth/refresh" },
      { id: "r7", type: "request", method: "POST", name: "Logout", path: "/api/auth/logout" },
    ]
  },
  {
    id: "f3", type: "folder", name: "Products", open: false,
    children: [
      { id: "r8", type: "request", method: "GET", name: "List products", path: "/api/products" },
      { id: "r9", type: "request", method: "GET", name: "Get product", path: "/api/products/:id" },
    ]
  },
]

const MOCK_RESPONSE = {
  status: 200,
  statusText: "OK",
  time: 142,
  size: "1.24 KB",
  body: JSON.stringify({
    status: "success",
    data: [
      { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin", created_at: "2024-01-15" },
      { id: 2, name: "Bob Smith", email: "bob@example.com", role: "user", created_at: "2024-02-20" },
      { id: 3, name: "Carol White", email: "carol@example.com", role: "user", created_at: "2024-03-10" },
    ],
    meta: { total: 3, page: 1, per_page: 20 }
  }, null, 2),
  headers: {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": "req_a4f3b2c1",
    "x-response-time": "142ms",
    "cache-control": "no-cache",
    "access-control-allow-origin": "*",
  }
}

function MethodBadge({ method, small }) {
  const c = METHOD_COLORS[method] || METHOD_COLORS.GET
  return (
    <span style={{
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      borderRadius: 4, padding: small ? "1px 5px" : "2px 8px",
      fontSize: small ? 10 : 11, fontWeight: 700, fontFamily: "monospace",
      letterSpacing: "0.03em", whiteSpace: "nowrap", flexShrink: 0
    }}>{method}</span>
  )
}

function StatusBadge({ status }) {
  const color = status >= 200 && status < 300 ? "#49cc90"
    : status >= 300 && status < 400 ? "#61affe"
    : status >= 400 && status < 500 ? "#fca130"
    : "#f93e3e"
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      {status} OK
    </span>
  )
}

export default function ApinizerApiTester() {
  const [sidebarMode, setSidebarMode] = useState("apis")
  const [activeTab, setActiveTab] = useState("r1")
  const [method, setMethod] = useState("GET")
  const [url, setUrl] = useState("https://api.example.com/api/users")
  const [reqTab, setReqTab] = useState("Params")
  const [resTab, setResTab] = useState("Response")
  const [resView, setResView] = useState("Pretty")
  const [sent, setSent] = useState(true)
  const [loading, setLoading] = useState(false)
  const [activeEnv, setActiveEnv] = useState("Production")
  const [showMethodDrop, setShowMethodDrop] = useState(false)
  const [folders, setFolders] = useState(SAMPLE_COLLECTION)
  const [activeRequest, setActiveRequest] = useState(SAMPLE_COLLECTION[0].children[0])
  const [tabs, setTabs] = useState([
    { id: "r1", label: "Get all users", method: "GET", dirty: false },
    { id: "r2", label: "Create user", method: "POST", dirty: true },
  ])
  const [params, setParams] = useState([
    { id: 1, key: "page", value: "1", enabled: true },
    { id: 2, key: "limit", value: "20", enabled: true },
    { id: 3, key: "sort", value: "created_at", enabled: false },
  ])
  const [headers, setHeaders] = useState([
    { id: 1, key: "Authorization", value: "Bearer {{token}}", enabled: true },
    { id: 2, key: "Content-Type", value: "application/json", enabled: true },
    { id: 3, key: "X-API-Version", value: "2024-01", enabled: false },
  ])
  const [bodyContent, setBodyContent] = useState('{\n  "name": "{{$randomName}}",\n  "email": "{{$randomEmail}}",\n  "role": "user"\n}')
  const [splitPos, setSplitPos] = useState(50)
  const dragging = useRef(false)
  const containerRef = useRef(null)

  const handleSend = () => {
    setLoading(true)
    setSent(false)
    setTimeout(() => { setLoading(false); setSent(true) }, 900)
  }

  const toggleFolder = (id) => {
    setFolders(prev => prev.map(f => f.id === id ? { ...f, open: !f.open } : f))
  }

  const startDrag = (e) => {
    dragging.current = true
    e.preventDefault()
  }
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100))
      setSplitPos(pct)
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [])

  const C = {
    app: "#13131f",
    sidebar: "#0f0f1a",
    panel: "#1a1a2e",
    surface: "#20203a",
    surface2: "#252545",
    input: "#1e1e38",
    border: "rgba(255,255,255,0.07)",
    borderMid: "rgba(255,255,255,0.12)",
    text: "#e2e2f0",
    muted: "#8888aa",
    accent: "#7c73e6",
    accentHover: "rgba(124,115,230,0.15)",
  }

  const sidebarIcons = {
    apis: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
      </svg>
    ),
    debug: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
    testing: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
      </svg>
    ),
    mock: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    ),
    docs: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  }

  const s = {
    root: { display: "flex", flexDirection: "column", height: 700, background: C.app, color: C.text, fontFamily: "'Segoe UI', system-ui, sans-serif", fontSize: 13, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` },
    header: { height: 40, background: C.sidebar, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", flexShrink: 0 },
    body: { display: "flex", flex: 1, overflow: "hidden" },
    iconBar: { width: 48, background: C.sidebar, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 2, flexShrink: 0 },
    dirPanel: { width: 230, background: C.panel, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 },
    workbench: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.app },
    tabBar: { height: 36, background: C.panel, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", flexShrink: 0, paddingLeft: 0, overflow: "hidden" },
    urlBar: { height: 52, background: C.panel, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flexShrink: 0 },
    splitArea: { flex: 1, display: "flex", overflow: "hidden" },
    footer: { height: 28, background: C.sidebar, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, padding: "0 12px", flexShrink: 0 },
  }

  return (
    <div style={s.root}>
      {/* HEADER */}
      <div style={s.header}>
        <div style={{ width: 48, display: "flex", justifyContent: "center" }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9" fill="none" stroke="white" strokeWidth="2"/></svg>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flex: 1 }}>
          {tabs.map(t => (
            <div key={t.id} onClick={() => setActiveTab(t.id)} style={{
              height: 40, display: "flex", alignItems: "center", gap: 6, padding: "0 12px",
              borderRight: `1px solid ${C.border}`,
              background: activeTab === t.id ? C.app : "transparent",
              cursor: "pointer", color: activeTab === t.id ? C.text : C.muted,
              borderBottom: activeTab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
              fontSize: 12, userSelect: "none",
            }}>
              <MethodBadge method={t.method} small />
              <span>{t.label}</span>
              {t.dirty && <span style={{ color: C.accent, fontSize: 16, lineHeight: 1, marginLeft: -2 }}>•</span>}
              <span style={{ color: C.muted, fontSize: 14, marginLeft: 2, cursor: "pointer" }}>×</span>
            </div>
          ))}
          <div style={{ padding: "0 12px", color: C.muted, cursor: "pointer", fontSize: 18, lineHeight: "40px" }}>+</div>
        </div>
        <div style={{ marginRight: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <select style={{ background: C.surface2, border: `1px solid ${C.borderMid}`, color: C.text, borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer", outline: "none" }}>
            <option>Production</option>
            <option>Staging</option>
            <option>Development</option>
          </select>
        </div>
      </div>

      <div style={s.body}>
        {/* ICON SIDEBAR */}
        <div style={s.iconBar}>
          {SIDEBAR_ITEMS.map(item => (
            <div key={item.id} onClick={() => setSidebarMode(item.id)} title={item.label} style={{
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 8, cursor: "pointer",
              background: sidebarMode === item.id ? C.accentHover : "transparent",
              color: sidebarMode === item.id ? C.accent : C.muted,
              borderLeft: sidebarMode === item.id ? `2px solid ${C.accent}` : "2px solid transparent",
              transition: "all 0.15s",
            }}>
              {sidebarIcons[item.id]}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          {[
            <svg key="env" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
            <svg key="set" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          ].map((icon, i) => (
            <div key={i} style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.muted, borderRadius: 8, marginBottom: i === 1 ? 8 : 4 }}>
              {icon}
            </div>
          ))}
        </div>

        {/* DIRECTORY PANEL */}
        <div style={s.dirPanel}>
          <div style={{ padding: "10px 10px 6px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ color: C.text, fontWeight: 600, fontSize: 12, flex: 1 }}>Collections</span>
              <span style={{ color: C.muted, cursor: "pointer", fontSize: 14 }} title="New">+</span>
              <span style={{ color: C.muted, cursor: "pointer", fontSize: 12 }} title="Import">↑</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", background: C.input, borderRadius: 6, border: `1px solid ${C.border}`, padding: "4px 8px", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span style={{ color: C.muted, fontSize: 12 }}>Search endpoints...</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "6px 4px" }}>
            {folders.map(folder => (
              <div key={folder.id}>
                <div onClick={() => toggleFolder(folder.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", cursor: "pointer", borderRadius: 6, color: C.muted, fontSize: 12, fontWeight: 500 }}
                  onMouseEnter={e => e.currentTarget.style.background = C.surface2}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: 10, transition: "transform 0.15s", display: "inline-block", transform: folder.open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={C.accent} stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  <span style={{ color: C.text }}>{folder.name}</span>
                </div>
                {folder.open && folder.children.map(req => (
                  <div key={req.id} onClick={() => { setActiveRequest(req); setMethod(req.method); setUrl(`https://api.example.com${req.path}`) }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 26px", cursor: "pointer", borderRadius: 6, background: activeRequest?.id === req.id ? C.accentHover : "transparent", borderLeft: activeRequest?.id === req.id ? `2px solid ${C.accent}` : "2px solid transparent" }}
                    onMouseEnter={e => { if (activeRequest?.id !== req.id) e.currentTarget.style.background = C.surface }}
                    onMouseLeave={e => { if (activeRequest?.id !== req.id) e.currentTarget.style.background = "transparent" }}>
                    <MethodBadge method={req.method} small />
                    <span style={{ color: C.text, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{req.name}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* WORKBENCH */}
        <div style={s.workbench}>
          {/* URL BAR */}
          <div style={s.urlBar}>
            <div style={{ position: "relative" }}>
              <div onClick={() => setShowMethodDrop(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: C.surface2, border: `1px solid ${C.borderMid}`, borderRadius: 6, cursor: "pointer", userSelect: "none", minWidth: 90 }}>
                <MethodBadge method={method} />
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              {showMethodDrop && (
                <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 100, background: C.surface2, border: `1px solid ${C.borderMid}`, borderRadius: 8, padding: 4, marginTop: 4, minWidth: 110, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                  {METHODS.map(m => (
                    <div key={m} onClick={() => { setMethod(m); setShowMethodDrop(false) }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 5, cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surface}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <MethodBadge method={m} small />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ flex: 1, background: C.input, border: `1px solid ${C.borderMid}`, borderRadius: 6, padding: "6px 10px", fontFamily: "monospace", fontSize: 13, color: C.text, cursor: "text" }}>
              <span style={{ color: C.muted }}>https://</span>
              <span style={{ color: "#61affe" }}>api.example.com</span>
              <span style={{ color: C.text }}>/api/users</span>
            </div>

            <button onClick={handleSend} style={{ padding: "7px 20px", background: loading ? C.surface2 : C.accent, border: "none", borderRadius: 6, color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", transition: "background 0.15s" }}>
              {loading ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ animation: "spin 0.8s linear infinite" }}><circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/></svg>
                  Sending...
                </>
              ) : "Send"}
            </button>
            <button style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.borderMid}`, borderRadius: 6, color: C.muted, fontSize: 13, cursor: "pointer" }}>Save</button>
          </div>

          {/* SPLIT AREA */}
          <div style={s.splitArea} ref={containerRef}>
            {/* REQUEST PANE */}
            <div style={{ width: `${splitPos}%`, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: `1px solid ${C.border}` }}>
              {/* Request Tabs */}
              <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.panel, flexShrink: 0, overflowX: "auto" }}>
                {["Params", "Auth", "Headers", "Body", "Pre-request", "Tests"].map(t => (
                  <div key={t} onClick={() => setReqTab(t)} style={{
                    padding: "8px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap",
                    color: reqTab === t ? C.accent : C.muted,
                    borderBottom: reqTab === t ? `2px solid ${C.accent}` : "2px solid transparent",
                    fontWeight: reqTab === t ? 500 : 400,
                    display: "flex", alignItems: "center", gap: 4,
                  }}>
                    {t}
                    {t === "Params" && <span style={{ background: C.accent, color: "white", borderRadius: 10, fontSize: 10, padding: "0 4px", minWidth: 16, textAlign: "center" }}>2</span>}
                    {t === "Headers" && <span style={{ background: "#49cc9033", color: "#49cc90", borderRadius: 10, fontSize: 10, padding: "0 4px", minWidth: 16, textAlign: "center" }}>2</span>}
                  </div>
                ))}
              </div>

              {/* Request Content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                {reqTab === "Params" && (
                  <div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Query Parameters</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          {["", "Key", "Value", ""].map((h, i) => (
                            <th key={i} style={{ padding: "4px 8px", textAlign: "left", color: C.muted, fontSize: 11, fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {params.map(p => (
                          <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: p.enabled ? 1 : 0.4 }}>
                            <td style={{ padding: "4px 8px", width: 20 }}>
                              <div style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${p.enabled ? C.accent : C.muted}`, background: p.enabled ? C.accent : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setParams(prev => prev.map(pp => pp.id === p.id ? { ...pp, enabled: !pp.enabled } : pp))}>
                                {p.enabled && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                              </div>
                            </td>
                            <td style={{ padding: "4px 8px" }}><input defaultValue={p.key} style={{ background: "transparent", border: "none", color: C.text, fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" }} /></td>
                            <td style={{ padding: "4px 8px" }}><input defaultValue={p.value} style={{ background: "transparent", border: "none", color: "#61affe", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" }} /></td>
                            <td style={{ padding: "4px 8px", color: C.muted, cursor: "pointer" }}>×</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button style={{ marginTop: 8, background: "transparent", border: `1px dashed ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 12, padding: "5px 12px", cursor: "pointer", width: "100%" }}>+ Add Parameter</button>
                  </div>
                )}

                {reqTab === "Auth" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                      <span style={{ color: C.muted, fontSize: 12 }}>Auth Type</span>
                      <select style={{ background: C.surface2, border: `1px solid ${C.borderMid}`, color: C.text, borderRadius: 6, padding: "4px 10px", fontSize: 12 }}>
                        <option>Bearer Token</option>
                        <option>Basic Auth</option>
                        <option>API Key</option>
                        <option>OAuth 2.0</option>
                        <option>No Auth</option>
                      </select>
                    </div>
                    <div style={{ background: C.surface, borderRadius: 8, padding: 14, border: `1px solid ${C.border}` }}>
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>Token</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input defaultValue="{{token}}" style={{ flex: 1, background: C.input, border: `1px solid ${C.borderMid}`, borderRadius: 6, padding: "6px 10px", color: "#fca130", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
                          <button style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>🔒</button>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted }}>Token will be sent as: <span style={{ color: C.text, fontFamily: "monospace" }}>Authorization: Bearer &lt;token&gt;</span></div>
                    </div>
                  </div>
                )}

                {reqTab === "Headers" && (
                  <div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                          <th style={{ padding: "4px 8px", textAlign: "left", color: C.muted, fontSize: 11, fontWeight: 500, width: 20 }}></th>
                          <th style={{ padding: "4px 8px", textAlign: "left", color: C.muted, fontSize: 11, fontWeight: 500 }}>Key</th>
                          <th style={{ padding: "4px 8px", textAlign: "left", color: C.muted, fontSize: 11, fontWeight: 500 }}>Value</th>
                          <th style={{ width: 20 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {headers.map(h => (
                          <tr key={h.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: h.enabled ? 1 : 0.4 }}>
                            <td style={{ padding: "4px 8px" }}>
                              <div style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${h.enabled ? C.accent : C.muted}`, background: h.enabled ? C.accent : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setHeaders(prev => prev.map(hh => hh.id === h.id ? { ...hh, enabled: !hh.enabled } : hh))}>
                                {h.enabled && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                              </div>
                            </td>
                            <td style={{ padding: "4px 8px" }}><input defaultValue={h.key} style={{ background: "transparent", border: "none", color: C.text, fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" }} /></td>
                            <td style={{ padding: "4px 8px" }}><input defaultValue={h.value} style={{ background: "transparent", border: "none", color: h.value.includes("{{") ? "#fca130" : "#49cc90", fontSize: 12, fontFamily: "monospace", outline: "none", width: "100%" }} /></td>
                            <td style={{ color: C.muted, cursor: "pointer", textAlign: "center" }}>×</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button style={{ marginTop: 8, background: "transparent", border: `1px dashed ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 12, padding: "5px 12px", cursor: "pointer", width: "100%" }}>+ Add Header</button>
                  </div>
                )}

                {reqTab === "Body" && (
                  <div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                      {["none", "json", "xml", "form-data", "urlencoded", "binary"].map(t => (
                        <label key={t} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: t === "json" ? C.accent : C.muted, fontSize: 12 }}>
                          <input type="radio" name="bodytype" defaultChecked={t === "json"} style={{ accentColor: C.accent }} />
                          {t}
                        </label>
                      ))}
                    </div>
                    <div style={{ background: C.input, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, minHeight: 140, color: C.text, overflowY: "auto" }}>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {`{\n  "name": `}<span style={{ color: "#49cc90" }}>"<span style={{ color: "#fca130" }}>{"{{$randomName}}"}</span>"</span>{`,\n  "email": `}<span style={{ color: "#49cc90" }}>"<span style={{ color: "#fca130" }}>{"{{$randomEmail}}"}</span>"</span>{`,\n  "role": `}<span style={{ color: "#49cc90" }}>"user"</span>{`\n}`}
                      </pre>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>Prettify</button>
                      <button style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, padding: "3px 10px", cursor: "pointer" }}>Copy</button>
                    </div>
                  </div>
                )}

                {reqTab === "Pre-request" && (
                  <div>
                    <div style={{ background: C.input, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, minHeight: 120, color: C.text }}>
                      <pre style={{ margin: 0 }}>
                        <span style={{ color: C.muted }}>{"//"} Set auth token before request</span>{"\n"}
                        <span style={{ color: "#61affe" }}>pm</span>{".environment.set("}<span style={{ color: "#49cc90" }}>"token"</span>{", "}<span style={{ color: "#49cc90" }}>"my-jwt-token"</span>{");"}{"\n"}
                        <span style={{ color: "#61affe" }}>pm</span>{".globals.set("}<span style={{ color: "#49cc90" }}>"timestamp"</span>{", Date.now());"}{"\n"}
                      </pre>
                    </div>
                  </div>
                )}

                {reqTab === "Tests" && (
                  <div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Visual Assertions</div>
                      {[
                        { type: "Status code equals", value: "200", color: "#49cc90" },
                        { type: "Response time less than", value: "2000 ms", color: "#61affe" },
                        { type: "Body JSON path $.data", value: "is array", color: "#fca130" },
                      ].map((a, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: C.surface, borderRadius: 6, marginBottom: 4, border: `1px solid ${C.border}` }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
                          <span style={{ color: C.muted, fontSize: 12, flex: 1 }}>{a.type}</span>
                          <span style={{ color: a.color, fontSize: 12, fontFamily: "monospace" }}>{a.value}</span>
                          <span style={{ color: C.muted, cursor: "pointer" }}>×</span>
                        </div>
                      ))}
                      <button style={{ background: "transparent", border: `1px dashed ${C.border}`, borderRadius: 6, color: C.muted, fontSize: 12, padding: "5px 12px", cursor: "pointer", width: "100%", marginTop: 6 }}>+ Add Assertion</button>
                    </div>
                    <div style={{ background: C.input, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, fontFamily: "monospace", fontSize: 12, lineHeight: 1.7, minHeight: 80, color: C.text }}>
                      <pre style={{ margin: 0 }}>
                        <span style={{ color: "#61affe" }}>pm</span>{".test("}<span style={{ color: "#49cc90" }}>"Status is 200"</span>{", () => \{\n  "}<span style={{ color: "#61affe" }}>pm</span>{".expect("}<span style={{ color: "#61affe" }}>pm</span>{".response.code).to.equal(200);\n\});"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* DIVIDER */}
            <div onMouseDown={startDrag} style={{ width: 4, background: C.border, cursor: "col-resize", flexShrink: 0, transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = C.accent}
              onMouseLeave={e => e.currentTarget.style.background = C.border} />

            {/* RESPONSE PANE */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {sent ? (
                <>
                  {/* Response Meta */}
                  <div style={{ padding: "8px 14px", background: C.panel, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
                    <StatusBadge status={200} />
                    <span style={{ color: C.muted, fontSize: 12 }}>
                      <span style={{ color: "#49cc90", fontWeight: 600 }}>142</span> ms
                    </span>
                    <span style={{ color: C.muted, fontSize: 12 }}>
                      <span style={{ color: C.text, fontWeight: 600 }}>1.24</span> KB
                    </span>
                    <div style={{ flex: 1 }} />
                    <button style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>↓ Save</button>
                    <button style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>Copy</button>
                  </div>

                  {/* Response Tabs */}
                  <div style={{ display: "flex", background: C.panel, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                    {["Response", "Cookie", "Console", "Actual Request"].map(t => (
                      <div key={t} onClick={() => setResTab(t)} style={{
                        padding: "7px 14px", cursor: "pointer", fontSize: 12,
                        color: resTab === t ? C.accent : C.muted,
                        borderBottom: resTab === t ? `2px solid ${C.accent}` : "2px solid transparent",
                        fontWeight: resTab === t ? 500 : 400, whiteSpace: "nowrap",
                      }}>{t}</div>
                    ))}
                    <div style={{ flex: 1 }} />
                    {resTab === "Response" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 10px" }}>
                        {["Pretty", "Raw", "Preview"].map(v => (
                          <div key={v} onClick={() => setResView(v)} style={{
                            padding: "3px 8px", cursor: "pointer", fontSize: 11, borderRadius: 4,
                            background: resView === v ? C.surface2 : "transparent",
                            color: resView === v ? C.text : C.muted,
                          }}>{v}</div>
                        ))}
                        <select style={{ marginLeft: 8, background: C.surface2, border: `1px solid ${C.borderMid}`, color: C.muted, borderRadius: 4, padding: "2px 6px", fontSize: 11 }}>
                          <option>JSON</option><option>XML</option><option>Text</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Response Body */}
                  <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
                    {resTab === "Response" && (
                      <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 12, lineHeight: 1.8, color: C.text, whiteSpace: "pre-wrap" }}>
                        <span style={{ color: C.muted }}>{"{"}</span>{"\n"}
                        <span>{"  "}</span><span style={{ color: "#61affe" }}>"status"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#49cc90" }}>"success"</span><span style={{ color: C.muted }}>,</span>{"\n"}
                        <span>{"  "}</span><span style={{ color: "#61affe" }}>"data"</span><span style={{ color: C.muted }}>: [</span>{"\n"}
                        {[
                          { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin" },
                          { id: 2, name: "Bob Smith", email: "bob@example.com", role: "user" },
                          { id: 3, name: "Carol White", email: "carol@example.com", role: "user" },
                        ].map((u, i) => (
                          <span key={u.id}>
                            {"    {"}{"\n"}
                            {"      "}<span style={{ color: "#61affe" }}>"id"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#fca130" }}>{u.id}</span><span style={{ color: C.muted }}>,</span>{"\n"}
                            {"      "}<span style={{ color: "#61affe" }}>"name"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#49cc90" }}>"{u.name}"</span><span style={{ color: C.muted }}>,</span>{"\n"}
                            {"      "}<span style={{ color: "#61affe" }}>"email"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#49cc90" }}>"{u.email}"</span><span style={{ color: C.muted }}>,</span>{"\n"}
                            {"      "}<span style={{ color: "#61affe" }}>"role"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#49cc90" }}>"{u.role}"</span>{"\n"}
                            {"    }"}{i < 2 ? <span style={{ color: C.muted }}>,</span> : ""}{"\n"}
                          </span>
                        ))}
                        {"  "}<span style={{ color: C.muted }}>],</span>{"\n"}
                        {"  "}<span style={{ color: "#61affe" }}>"meta"</span><span style={{ color: C.muted }}>: {"{"}</span>{"\n"}
                        {"    "}<span style={{ color: "#61affe" }}>"total"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#fca130" }}>3</span><span style={{ color: C.muted }}>,</span>{"  "}<span style={{ color: "#61affe" }}>"page"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#fca130" }}>1</span><span style={{ color: C.muted }}>,</span>{"  "}<span style={{ color: "#61affe" }}>"per_page"</span><span style={{ color: C.muted }}>: </span><span style={{ color: "#fca130" }}>20</span>{"\n"}
                        {"  "}<span style={{ color: C.muted }}>{"}"}</span>{"\n"}
                        <span style={{ color: C.muted }}>{"}"}</span>
                      </pre>
                    )}
                    {resTab === "Cookie" && (
                      <div style={{ color: C.muted, fontSize: 12 }}>
                        <div style={{ marginBottom: 8, color: C.text, fontWeight: 500 }}>Response Cookies</div>
                        {[{ name: "session_id", value: "abc123xyz", domain: "api.example.com", httpOnly: true }].map((c, i) => (
                          <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: `1px solid ${C.border}`, fontFamily: "monospace" }}>
                            <span style={{ color: C.accent }}>{c.name}</span>
                            <span style={{ color: C.text }}>{c.value}</span>
                            <span style={{ color: C.muted }}>{c.domain}</span>
                            {c.httpOnly && <span style={{ color: "#fca130", fontSize: 11 }}>HttpOnly</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {resTab === "Console" && (
                      <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.8 }}>
                        <div style={{ color: C.muted, marginBottom: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pre-request Log</div>
                        <div style={{ color: "#49cc90" }}>▶ Token set: "my-jwt-token"</div>
                        <div style={{ color: "#49cc90" }}>▶ Timestamp set: 1732000000000</div>
                        <div style={{ color: C.muted, marginTop: 10, marginBottom: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>Tests</div>
                        <div style={{ color: "#49cc90" }}>✓ Status is 200</div>
                        <div style={{ color: "#49cc90" }}>✓ Response time less than 2000ms</div>
                        <div style={{ color: "#49cc90" }}>✓ Body has data array</div>
                      </div>
                    )}
                    {resTab === "Actual Request" && (
                      <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 12, lineHeight: 1.8, color: C.text }}>
                        <span style={{ color: "#61affe" }}>GET</span> <span style={{ color: C.text }}>https://api.example.com/api/users?page=1&limit=20</span> <span style={{ color: C.muted }}>HTTP/1.1</span>{"\n"}
                        <span style={{ color: "#fca130" }}>Authorization</span><span style={{ color: C.muted }}>: </span><span style={{ color: C.text }}>Bearer eyJhbGciOiJSUzI1NiJ9...</span>{"\n"}
                        <span style={{ color: "#fca130" }}>Content-Type</span><span style={{ color: C.muted }}>: </span><span style={{ color: C.text }}>application/json</span>{"\n"}
                        <span style={{ color: "#fca130" }}>X-API-Version</span><span style={{ color: C.muted }}>: </span><span style={{ color: C.text }}>2024-01</span>
                      </pre>
                    )}
                  </div>
                </>
              ) : loading ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2" style={{ animation: "spin 0.8s linear infinite" }}><circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/></svg>
                  <span style={{ color: C.muted, fontSize: 13 }}>Sending request...</span>
                </div>
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="1.2" opacity="0.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8l4 4-4 4"/></svg>
                  <span style={{ color: C.muted, fontSize: 13 }}>Send a request to see the response</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={s.footer}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#49cc90" }} />
          <span style={{ color: C.muted, fontSize: 11 }}>Ready</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.muted, fontSize: 11 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Production
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 12 }}>
          {["Runner", "Console", "Cookies"].map(l => (
            <span key={l} style={{ color: C.muted, fontSize: 11, cursor: "pointer" }}>{l}</span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
        input:focus { outline: none; }
        select { outline: none; }
      `}</style>
    </div>
  )
}
