import { useState, useRef, useEffect, useCallback } from "react"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const M = {
  GET:     { bg: "#e8f4ff", color: "#0066cc", border: "#b3d4f5" },
  POST:    { bg: "#e8f9f1", color: "#1a7a4a", border: "#b3e5cc" },
  PUT:     { bg: "#fff4e0", color: "#b35a00", border: "#f5d4a0" },
  PATCH:   { bg: "#f0faf5", color: "#0a7a5a", border: "#a0e0c8" },
  DELETE:  { bg: "#fff0f0", color: "#cc2200", border: "#f5b3b3" },
  HEAD:    { bg: "#f5f0ff", color: "#6600cc", border: "#d4b3f5" },
  OPTIONS: { bg: "#f0f5ff", color: "#0044aa", border: "#b3c4f5" },
}

const IMPORT_FORMATS = [
  { name: "OpenAPI/Swagger", icon: "🌿", bg: "#e8f9f1", color: "#1a7a4a" },
  { name: "Postman",         icon: "🟠", bg: "#fff0ec", color: "#f25c00" },
  { name: "Insomnia",        icon: "🟣", bg: "#faf0ff", color: "#7c4dff" },
  { name: "cURL",            icon: "cURL", bg: "#e8f4ff", color: "#1565c0", mono: true },
  { name: "Apidog",          icon: "◈",  bg: "#f0f0ff", color: "#7c73e6" },
  { name: ".har File",       icon: "har", bg: "#fff3e0", color: "#e65100", mono: true, badge: true },
  { name: "JMeter",          icon: "📄", bg: "#fce4ec", color: "#c62828" },
  { name: "apiDoc",          icon: "A",  bg: "#e8f5e9", color: "#2e7d32", serif: true },
  { name: "RAML",            icon: "RAML", bg: "#e3f2fd", color: "#1976d2", mono: true },
  { name: "I/O Doc",         icon: "⚡", bg: "#fce4ec", color: "#e91e63" },
  { name: "WSDL",            icon: "WSDL", bg: "#e3f2fd", color: "#1565c0", mono: true },
  { name: "WADL",            icon: "WADL", bg: "#e8f5e9", color: "#388e3c", mono: true },
  { name: "Google Discovery",icon: "✦",  bg: "#fafafa", color: "#4285f4" },
  { name: ".proto file",     icon: "⬡",  bg: "#e8f5e9", color: "#00897b" },
  { name: "SoapUI",          icon: "☀",  bg: "#fff8e1", color: "#f9a825" },
  { name: "Hoppscotch",      icon: "🦗", bg: "#e8f5e9", color: "#00b96b" },
]

const TREE = [
  {
    id: "default-module", label: "Default module", icon: "module", open: true,
    children: [
      {
        id: "endpoints", label: "Endpoints", icon: "endpoints", open: true,
        children: [
          { id: "start", label: "Start your Apidog journey", italic: true },
          {
            id: "sample", label: "Sample APIs", icon: "folder", count: 5, open: true,
            children: [
              { id: "r1", label: "Get all users",  method: "GET",    path: "/api/users" },
              { id: "r2", label: "Create user",    method: "POST",   path: "/api/users" },
              { id: "r3", label: "Update user",    method: "PUT",    path: "/api/users/:id" },
              { id: "r4", label: "Delete user",    method: "DELETE", path: "/api/users/:id" },
            ]
          },
          { id: "sorgula", label: "Sorgula", method: "POST", path: "/api/sorgula", count: 1, countColor: "#cc4444", countBg: "#fff0f0" },
        ]
      },
      { id: "schemas",    label: "Schemas",    icon: "schemas",    open: false, children: [{ id: "s1", label: "UserSchema" }, { id: "s2", label: "ProductSchema" }] },
      { id: "components", label: "Components", icon: "components", open: false, children: [{ id: "c1", label: "AuthHeader" }] },
    ]
  },
  { id: "calculator",     label: "Calculator",     icon: "calc",     open: false, children: [] },
  { id: "quick-requests", label: "Quick Requests", icon: "quick",    open: false, children: [] },
]

function MethodBadge({ method, small }) {
  const c = M[method] || M.GET
  return (
    <span style={{
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      borderRadius: 4, padding: small ? "1px 5px" : "2px 8px",
      fontSize: small ? 9 : 11, fontWeight: 700, fontFamily: "monospace",
      letterSpacing: "0.02em", whiteSpace: "nowrap", flexShrink: 0,
    }}>{method}</span>
  )
}

function ImportIcon({ fmt }) {
  if (fmt.mono) return (
    <div style={{ width: 36, height: 36, borderRadius: 8, background: fmt.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontWeight: 800, fontSize: fmt.badge ? 10 : 12, color: fmt.badge ? "white" : fmt.color, fontFamily: "monospace", background: fmt.badge ? fmt.color : "transparent", padding: fmt.badge ? "2px 4px" : 0, borderRadius: fmt.badge ? 3 : 0 }}>{fmt.icon}</span>
    </div>
  )
  if (fmt.serif) return (
    <div style={{ width: 36, height: 36, borderRadius: 8, background: fmt.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontWeight: 900, fontSize: 22, color: fmt.color, fontFamily: "Georgia, serif" }}>{fmt.icon}</span>
    </div>
  )
  return (
    <div style={{ width: 36, height: 36, borderRadius: 8, background: fmt.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 20 }}>
      {fmt.icon}
    </div>
  )
}

function TreeNode({ node, depth = 0, activeId, onSelect, onToggle, openIds }) {
  const isOpen = openIds.has(node.id)
  const hasChildren = node.children && node.children.length > 0
  const isRequest = !!node.method
  const isActive = activeId === node.id
  const indent = depth * 14

  const iconMap = {
    module: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>,
    endpoints: <div style={{ width: 16, height: 16, borderRadius: 4, background: "#7c73e6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" fill="white"/><polyline points="13 2 13 9 20 9" fill="none" stroke="white" strokeWidth="2"/></svg></div>,
    schemas: <div style={{ width: 16, height: 16, borderRadius: 4, background: "#4caf82", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="white" strokeWidth="2" fill="none"/></svg></div>,
    components: <div style={{ width: 16, height: 16, borderRadius: 4, background: "#e88c3a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="2" y="7" width="20" height="14" rx="2" stroke="white" strokeWidth="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" stroke="white" strokeWidth="2"/></svg></div>,
    folder: <svg width="13" height="13" viewBox="0 0 24 24" fill="#888" stroke="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    calc: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>,
    quick: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  }

  return (
    <div>
      <div
        onClick={() => {
          if (hasChildren) onToggle(node.id)
          if (isRequest) onSelect(node)
        }}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: `4px 10px 4px ${10 + indent}px`,
          cursor: "pointer", borderRadius: 6,
          background: isActive ? "#eeecfe" : "transparent",
          color: isActive ? "#5b52d4" : node.italic ? "#aaa" : "#444",
          fontStyle: node.italic ? "italic" : "normal",
          fontSize: 12.5, userSelect: "none",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "#f5f5f7" }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent" }}
      >
        {hasChildren && (
          <span style={{ fontSize: 8, color: "#bbb", transition: "transform 0.15s", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>▶</span>
        )}
        {!hasChildren && !isRequest && <span style={{ width: 10, flexShrink: 0 }} />}
        {node.icon && iconMap[node.icon]}
        {isRequest && <MethodBadge method={node.method} small />}
        {node.icon === "folder" && iconMap.folder}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
        {node.count != null && (
          <span style={{ background: node.countBg || "#f0f0f5", color: node.countColor || "#888", borderRadius: 10, fontSize: 10, padding: "0 5px", marginLeft: 3, flexShrink: 0 }}>
            {node.count}
          </span>
        )}
      </div>
      {hasChildren && isOpen && node.children.map(child => (
        <TreeNode key={child.id} node={child} depth={depth + 1} activeId={activeId} onSelect={onSelect} onToggle={onToggle} openIds={openIds} />
      ))}
    </div>
  )
}

export default function ApinizerApiTesterLight() {
  const [method, setMethod] = useState("GET")
  const [urlPath, setUrlPath] = useState("/api/users")
  const [reqTab, setReqTab] = useState("Params")
  const [resTab, setResTab] = useState("Response")
  const [resView, setResView] = useState("Pretty")
  const [sending, setSending] = useState(false)
  const [showNewDrop, setShowNewDrop] = useState(false)
  const [showMethodDrop, setShowMethodDrop] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [selectedImport, setSelectedImport] = useState(0)
  const [activeRequest, setActiveRequest] = useState("r1")
  const [openIds, setOpenIds] = useState(new Set(["default-module", "endpoints", "sample"]))
  const [split, setSplit] = useState(50)
  const dragging = useRef(false)
  const containerRef = useRef(null)

  const handleToggle = useCallback((id) => {
    setOpenIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const handleSelect = useCallback((node) => {
    setActiveRequest(node.id)
    setMethod(node.method)
    setUrlPath(node.path)
  }, [])

  const handleSend = () => {
    setSending(true)
    setTimeout(() => setSending(false), 900)
  }

  useEffect(() => {
    const onMove = e => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      setSplit(Math.min(78, Math.max(22, (e.clientX - rect.left) / rect.width * 100)))
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [])

  useEffect(() => {
    const handler = () => { setShowNewDrop(false); setShowMethodDrop(false) }
    window.addEventListener("click", handler)
    return () => window.removeEventListener("click", handler)
  }, [])

  const C = {
    bg: "#f5f5f7", white: "#fff", border: "#e8e8ed",
    border2: "#d0d0da", text: "#1a1a2e", muted: "#888", hint: "#bbb",
    accent: "#7c73e6", accentLight: "#eeecfe", accentText: "#5b52d4",
    surface: "#fafafa", green: "#1a7a4a", greenBg: "#e8f9f1", greenBorder: "#b3e5cc",
  }

  const btn = (onClick, children, primary, extra = {}) => (
    <button
      onClick={onClick}
      style={{
        padding: primary ? "7px 18px" : "6px 12px",
        background: primary ? C.accent : C.white,
        border: primary ? "none" : `1.5px solid ${C.border2}`,
        borderRadius: 7, color: primary ? "#fff" : "#555",
        fontWeight: primary ? 600 : 400, fontSize: 13,
        cursor: "pointer", transition: "all 0.15s", ...extra
      }}
    >{children}</button>
  )

  const reqTabs = ["Params", "Auth", "Headers", "Body", "Pre-request", "Tests"]
  const resTabs = ["Response", "Cookie", "Console", "Actual Request"]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 720, background: C.bg, color: C.text, fontFamily: "-apple-system,'Segoe UI',system-ui,sans-serif", fontSize: 13, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, position: "relative" }}>

      {/* ─── HEADER ─── */}
      <div style={{ height: 44, background: C.white, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", flexShrink: 0 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px", height: "100%", borderRight: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg,#7c73e6,#5040c8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h10M4 18h13" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
              <circle cx="19" cy="12" r="3" fill="white"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text, lineHeight: 1.2, letterSpacing: "-0.3px" }}>Apinizer</div>
            <div style={{ fontSize: 10, color: C.hint, lineHeight: 1 }}>API Tester</div>
          </div>
        </div>

        {/* Project tabs */}
        <div style={{ display: "flex", alignItems: "center", flex: 1, overflow: "hidden" }}>
          {["My API Project", "Payment Service"].map((t, i) => (
            <div key={t} style={{
              height: 44, display: "flex", alignItems: "center", gap: 6, padding: "0 16px",
              fontSize: 13, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
              borderBottom: i === 0 ? `2px solid ${C.accent}` : "2px solid transparent",
              color: i === 0 ? C.text : C.muted, fontWeight: i === 0 ? 500 : 400,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
              {t}
            </div>
          ))}
          <div style={{ padding: "0 10px", color: C.hint, fontSize: 18, cursor: "pointer" }}>+</div>
        </div>

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 20, fontSize: 12, color: "#555", cursor: "pointer" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            main
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>A</div>
        </div>
      </div>

      {/* ─── BODY ─── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT PANEL */}
        <div style={{ width: 260, background: C.white, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
          {/* Panel header */}
          <div style={{ height: 44, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 10px", gap: 8, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>APIs</span>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 14, fontSize: 11, color: "#555", cursor: "pointer" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              main ▾
            </div>
            {/* New button + dropdown */}
            <div style={{ position: "relative" }}>
              <button
                onClick={e => { e.stopPropagation(); setShowNewDrop(v => !v); setShowMethodDrop(false) }}
                style={{ width: 28, height: 28, background: C.accent, border: "none", borderRadius: 7, color: "white", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 300, lineHeight: 1 }}
              >+</button>
              {showNewDrop && (
                <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 300, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, width: 320, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", animation: "fadeIn 0.15s ease" }}>
                  <div style={{ fontSize: 11, color: C.hint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500, margin: "0 0 8px 4px" }}>New</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
                    {[
                      { icon: "🌐", label: "HTTP Endpoint", bg: "#e8f4ff" },
                      { icon: "⚡", label: "Quick Request", bg: "#fff4e0" },
                      { icon: "🔌", label: "WebSocket", bg: "#fff0ec" },
                      { icon: "⚙", label: "Socket.IO", bg: "#f5f0ff" },
                      { icon: "🖥", label: "MCP", bg: "#f5f5f5" },
                      { icon: "···", label: "More...", bg: "#f5f5f5", muted: true },
                    ].map(item => (
                      <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, color: item.muted ? C.hint : C.text }}
                        onMouseEnter={e => e.currentTarget.style.background = C.bg}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{item.icon}</div>
                        {item.label}
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: `1px solid ${C.border}`, margin: "6px 0 8px" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
                    {[
                      { icon: "📦", label: "Schema", bg: "#e8f5e9" },
                      { icon: "📝", label: "Markdown", bg: "#e8f4ff" },
                      { icon: "📁", label: "Folder", bg: "#fff8e1" },
                      { icon: "🗂", label: "Module", bg: "#fce4ec" },
                    ].map(item => (
                      <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, color: C.text }}
                        onMouseEnter={e => e.currentTarget.style.background = C.bg}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ width: 28, height: 28, borderRadius: 7, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{item.icon}</div>
                        {item.label}
                      </div>
                    ))}
                  </div>
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                    <div style={{ fontSize: 10.5, color: C.hint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Other</div>
                    {[
                      { icon: "⬇", label: "Import", shortcut: "⌘O", action: () => { setShowNewDrop(false); setShowImport(true) } },
                      { icon: "{}",label: "Import cURL", shortcut: "⌘I" },
                    ].map(item => (
                      <div key={item.label} onClick={item.action}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, color: C.text }}
                        onMouseEnter={e => e.currentTarget.style.background = C.bg}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span style={{ fontSize: 14, width: 20 }}>{item.icon}</span>
                        <span style={{ flex: 1 }}>{item.label}</span>
                        <span style={{ color: C.hint, fontSize: 11 }}>{item.shortcut}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "4px 8px", fontSize: 14, cursor: "pointer" }}>···</button>
          </div>

          {/* Search */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", background: C.bg, borderRadius: 7, border: `1px solid ${C.border}`, padding: "5px 9px", gap: 6, flex: 1 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.hint} strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input placeholder="Search..." style={{ background: "transparent", border: "none", outline: "none", color: C.text, fontSize: 12, width: "100%" }} />
            </div>
            <button style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "5px 8px", cursor: "pointer" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
            </button>
          </div>

          {/* Tree */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
            {TREE.map(node => (
              <TreeNode key={node.id} node={node} depth={0} activeId={activeRequest} onSelect={handleSelect} onToggle={handleToggle} openIds={openIds} />
            ))}
          </div>
        </div>

        {/* WORKBENCH */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* URL Bar */}
          <div style={{ height: 56, background: C.white, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", flexShrink: 0 }}>
            {/* Method dropdown */}
            <div style={{ position: "relative" }}>
              <div onClick={e => { e.stopPropagation(); setShowMethodDrop(v => !v); setShowNewDrop(false) }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: C.bg, border: `1.5px solid ${C.border2}`, borderRadius: 7, cursor: "pointer", minWidth: 102, userSelect: "none" }}>
                <MethodBadge method={method} />
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              {showMethodDrop && (
                <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, minWidth: 120, boxShadow: "0 6px 20px rgba(0,0,0,0.1)" }}>
                  {METHODS.map(m => (
                    <div key={m} onClick={() => { setMethod(m); setShowMethodDrop(false) }}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 5, cursor: "pointer" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.bg}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <MethodBadge method={m} small />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* URL */}
            <div style={{ flex: 1, background: C.bg, border: `1.5px solid ${C.border2}`, borderRadius: 7, padding: "7px 12px", fontFamily: "monospace", fontSize: 13, display: "flex", cursor: "text" }}>
              <span style={{ color: C.hint }}>https://</span>
              <span style={{ color: "#0066cc" }}>api.example.com</span>
              <span style={{ color: C.text }}>{urlPath}</span>
            </div>

            {btn(handleSend, sending ? "Sending..." : "Send", true, { opacity: sending ? 0.7 : 1 })}
            {btn(null, "Save")}
            {btn(() => setShowImport(true), "Import")}
          </div>

          {/* Split area */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }} ref={containerRef}>
            {/* REQUEST PANE */}
            <div style={{ width: `${split}%`, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: `1px solid ${C.border}`, background: C.white }}>
              {/* Req tabs */}
              <div style={{ display: "flex", background: C.white, borderBottom: `1px solid ${C.border}`, flexShrink: 0, overflowX: "auto" }}>
                {reqTabs.map(t => (
                  <div key={t} onClick={() => setReqTab(t)} style={{
                    padding: "8px 14px", cursor: "pointer", fontSize: 12.5,
                    borderBottom: reqTab === t ? `2px solid ${C.accent}` : "2px solid transparent",
                    color: reqTab === t ? C.accentText : C.muted,
                    fontWeight: reqTab === t ? 500 : 400, whiteSpace: "nowrap",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    {t}
                    {t === "Params" && <span style={{ background: C.accentLight, color: C.accentText, borderRadius: 10, fontSize: 10, padding: "0 5px" }}>2</span>}
                    {t === "Headers" && <span style={{ background: C.greenBg, color: C.green, borderRadius: 10, fontSize: 10, padding: "0 5px" }}>2</span>}
                  </div>
                ))}
              </div>

              {/* Req content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                {reqTab === "Params" && (
                  <div>
                    <div style={{ fontSize: 11, color: C.hint, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>Query Parameters</div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 28px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                        {["", "Key", "Value", ""].map((h, i) => <div key={i} style={{ padding: "6px 8px", fontSize: 11, color: C.muted, fontWeight: 500 }}>{h}</div>)}
                      </div>
                      {[
                        { key: "page", value: "1", enabled: true },
                        { key: "limit", value: "20", enabled: true },
                        { key: "sort", value: "created_at", enabled: false },
                      ].map((row, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 28px", borderBottom: i < 2 ? `1px solid ${C.border}` : "none", opacity: row.enabled ? 1 : 0.4 }}>
                          <div style={{ padding: "3px 8px", display: "flex", alignItems: "center" }}>
                            <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${row.enabled ? C.accent : C.hint}`, background: row.enabled ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                              {row.enabled && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                            </div>
                          </div>
                          <input defaultValue={row.key} style={{ background: "transparent", border: "none", outline: "none", padding: "5px 8px", fontSize: 12, fontFamily: "monospace", color: C.text }} />
                          <input defaultValue={row.value} style={{ background: "transparent", border: "none", outline: "none", padding: "5px 8px", fontSize: 12, fontFamily: "monospace", color: "#0066cc" }} />
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: C.hint, cursor: "pointer" }}>×</div>
                        </div>
                      ))}
                    </div>
                    <button style={{ marginTop: 8, background: "transparent", border: `1px dashed ${C.border2}`, borderRadius: 7, color: C.hint, fontSize: 12, padding: "5px 14px", cursor: "pointer", width: "100%" }}>+ Add Parameter</button>
                  </div>
                )}

                {reqTab === "Auth" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                      <span style={{ color: C.muted, fontSize: 12 }}>Auth Type</span>
                      <select style={{ background: C.bg, border: `1.5px solid ${C.border2}`, color: C.text, borderRadius: 7, padding: "5px 10px", fontSize: 12, outline: "none" }}>
                        <option>Bearer Token</option><option>Basic Auth</option><option>API Key</option><option>OAuth 2.0</option><option>No Auth</option>
                      </select>
                    </div>
                    <div style={{ background: C.surface, borderRadius: 8, padding: 14, border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 11, color: C.hint, marginBottom: 6, fontWeight: 500 }}>Token</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input defaultValue="{{token}}" style={{ flex: 1, background: C.white, border: `1.5px solid ${C.border2}`, borderRadius: 7, padding: "6px 10px", color: "#b35a00", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
                        <button style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: "6px 10px", cursor: "pointer" }}>🔒</button>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 11, color: C.hint }}>Sent as: <code style={{ color: C.text, background: "#f0f0f5", padding: "1px 5px", borderRadius: 3 }}>Authorization: Bearer &lt;token&gt;</code></div>
                    </div>
                  </div>
                )}

                {reqTab === "Headers" && (
                  <div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 28px", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                        {["", "Key", "Value", ""].map((h, i) => <div key={i} style={{ padding: "6px 8px", fontSize: 11, color: C.muted, fontWeight: 500 }}>{h}</div>)}
                      </div>
                      {[
                        { key: "Authorization", value: "Bearer {{token}}", color: "#b35a00", enabled: true },
                        { key: "Content-Type", value: "application/json", color: C.green, enabled: true },
                        { key: "X-API-Version", value: "2024-01", color: C.text, enabled: false },
                      ].map((row, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 28px", borderBottom: i < 2 ? `1px solid ${C.border}` : "none", opacity: row.enabled ? 1 : 0.4 }}>
                          <div style={{ padding: "3px 8px", display: "flex", alignItems: "center" }}>
                            <div style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${row.enabled ? C.accent : C.hint}`, background: row.enabled ? C.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                              {row.enabled && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                            </div>
                          </div>
                          <input defaultValue={row.key} style={{ background: "transparent", border: "none", outline: "none", padding: "5px 8px", fontSize: 12, fontFamily: "monospace", color: C.text }} />
                          <input defaultValue={row.value} style={{ background: "transparent", border: "none", outline: "none", padding: "5px 8px", fontSize: 12, fontFamily: "monospace", color: row.color }} />
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: C.hint, cursor: "pointer" }}>×</div>
                        </div>
                      ))}
                    </div>
                    <button style={{ marginTop: 8, background: "transparent", border: `1px dashed ${C.border2}`, borderRadius: 7, color: C.hint, fontSize: 12, padding: "5px 14px", cursor: "pointer", width: "100%" }}>+ Add Header</button>
                  </div>
                )}

                {reqTab === "Body" && (
                  <div>
                    <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                      {["none", "JSON", "XML", "form-data", "urlencoded"].map(t => (
                        <label key={t} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: t === "JSON" ? C.accentText : C.muted, fontSize: 12 }}>
                          <input type="radio" name="body-type" defaultChecked={t === "JSON"} style={{ accentColor: C.accent }} />{t}
                        </label>
                      ))}
                    </div>
                    <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, minHeight: 140, fontFamily: "monospace", fontSize: 12, lineHeight: 1.85, color: C.text }}>
                      <pre style={{ margin: 0 }}>
                        {"{\n  "}<span style={{ color: "#0066cc" }}>"name"</span>{": "}<span style={{ color: C.green }}>"<span style={{ color: "#b35a00" }}>{"{{$randomName}}"}</span>"</span>{",\n  "}<span style={{ color: "#0066cc" }}>"email"</span>{": "}<span style={{ color: C.green }}>"<span style={{ color: "#b35a00" }}>{"{{$randomEmail}}"}</span>"</span>{",\n  "}<span style={{ color: "#0066cc" }}>"role"</span>{": "}<span style={{ color: C.green }}>"user"</span>{"\n}"}
                      </pre>
                    </div>
                  </div>
                )}

                {reqTab === "Pre-request" && (
                  <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12, minHeight: 130, fontFamily: "monospace", fontSize: 12, lineHeight: 1.85, color: C.text }}>
                    <pre style={{ margin: 0 }}>
                      <span style={{ color: C.hint }}>{"// Pre-request script"}</span>{"\n"}<span style={{ color: "#0066cc" }}>pm</span>{".environment.set("}<span style={{ color: C.green }}>"token"</span>{", "}<span style={{ color: C.green }}>"jwt-token"</span>{");\n"}<span style={{ color: "#0066cc" }}>pm</span>{".globals.set("}<span style={{ color: C.green }}>"ts"</span>{", Date.now());"}
                    </pre>
                  </div>
                )}

                {reqTab === "Tests" && (
                  <div>
                    <div style={{ fontSize: 11, color: C.hint, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>Visual Assertions</div>
                    {[
                      { label: "Status code equals", value: "200", color: C.green, bg: C.greenBg },
                      { label: "Response time less than", value: "2000 ms", color: "#0066cc", bg: "#e8f4ff" },
                      { label: "Body JSON path $.data", value: "is array", color: "#b35a00", bg: "#fff4e0" },
                    ].map((a, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: C.surface, borderRadius: 7, border: `1px solid ${C.border}`, marginBottom: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: a.color }} />
                        <span style={{ color: C.muted, fontSize: 12, flex: 1 }}>{a.label}</span>
                        <span style={{ color: a.color, fontSize: 12, fontFamily: "monospace", background: a.bg, padding: "1px 7px", borderRadius: 4 }}>{a.value}</span>
                        <span style={{ color: C.hint, cursor: "pointer" }}>×</span>
                      </div>
                    ))}
                    <button style={{ background: "transparent", border: `1px dashed ${C.border2}`, borderRadius: 7, color: C.hint, fontSize: 12, padding: "5px 14px", cursor: "pointer", width: "100%", marginTop: 4, marginBottom: 12 }}>+ Add Assertion</button>
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 12, lineHeight: 1.85 }}>
                      <pre style={{ margin: 0 }}>
                        <span style={{ color: "#0066cc" }}>pm</span>{".test("}<span style={{ color: C.green }}>"Status is 200"</span>{", () => {\n  "}<span style={{ color: "#0066cc" }}>pm</span>{".expect("}<span style={{ color: "#0066cc" }}>pm</span>{".response.code).to.equal(200);\n});"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* DIVIDER */}
            <div onMouseDown={e => { dragging.current = true; e.preventDefault() }}
              style={{ width: 4, background: C.border, cursor: "col-resize", flexShrink: 0, transition: "background 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.background = C.accent}
              onMouseLeave={e => e.currentTarget.style.background = C.border} />

            {/* RESPONSE PANE */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: C.white }}>
              {/* Meta */}
              <div style={{ padding: "8px 16px", background: C.white, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13, color: C.green }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, display: "inline-block" }} />
                  200 OK
                </span>
                <span style={{ fontSize: 12, color: C.muted }}><span style={{ color: C.green, fontWeight: 600 }}>142</span> ms</span>
                <span style={{ fontSize: 12, color: C.muted }}><span style={{ color: C.text, fontWeight: 600 }}>1.24</span> KB</span>
                <span style={{ fontSize: 11, background: C.greenBg, color: C.green, border: `1px solid ${C.greenBorder}`, padding: "2px 9px", borderRadius: 10, fontWeight: 500 }}>3/3 Tests ✓</span>
                <div style={{ flex: 1 }} />
                <button style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>↓ Save</button>
                <button style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>Copy</button>
              </div>

              {/* Res tabs */}
              <div style={{ display: "flex", background: C.white, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                {resTabs.map(t => (
                  <div key={t} onClick={() => setResTab(t)} style={{
                    padding: "8px 14px", cursor: "pointer", fontSize: 12.5,
                    borderBottom: resTab === t ? `2px solid ${C.accent}` : "2px solid transparent",
                    color: resTab === t ? C.accentText : C.muted,
                    fontWeight: resTab === t ? 500 : 400, whiteSpace: "nowrap",
                  }}>{t}</div>
                ))}
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "0 10px" }}>
                  {["Pretty", "Raw", "Preview"].map(v => (
                    <div key={v} onClick={() => setResView(v)} style={{ padding: "3px 8px", borderRadius: 5, background: resView === v ? C.accentLight : "transparent", color: resView === v ? C.accentText : C.muted, fontSize: 11, cursor: "pointer", fontWeight: resView === v ? 500 : 400 }}>{v}</div>
                  ))}
                  <select style={{ marginLeft: 6, background: C.bg, border: `1px solid ${C.border2}`, color: C.muted, borderRadius: 5, padding: "2px 6px", fontSize: 11, outline: "none" }}>
                    <option>JSON</option><option>XML</option>
                  </select>
                </div>
              </div>

              {/* Res body */}
              <div style={{ flex: 1, overflowY: "auto", padding: 14, background: C.surface }}>
                {resTab === "Response" && (
                  <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 12, lineHeight: 1.85, color: C.text, whiteSpace: "pre-wrap" }}>
                    {"{\n  "}<span style={{ color: "#0066cc" }}>"status"</span>{": "}<span style={{ color: C.green }}>"success"</span>{",\n  "}<span style={{ color: "#0066cc" }}>"data"</span>{": [\n"}
                    {[
                      { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin" },
                      { id: 2, name: "Bob Smith", email: "bob@example.com", role: "user" },
                      { id: 3, name: "Carol White", email: "carol@example.com", role: "user" },
                    ].map((u, i) => (
                      <span key={u.id}>
                        {"    {\n      "}<span style={{ color: "#0066cc" }}>"id"</span>{": "}<span style={{ color: "#b35a00" }}>{u.id}</span>{", "}<span style={{ color: "#0066cc" }}>"name"</span>{": "}<span style={{ color: C.green }}>"{u.name}"</span>{",\n      "}<span style={{ color: "#0066cc" }}>"email"</span>{": "}<span style={{ color: C.green }}>"{u.email}"</span>{", "}<span style={{ color: "#0066cc" }}>"role"</span>{": "}<span style={{ color: C.green }}>"{u.role}"</span>{"\n    }"}{i < 2 ? "," : ""}{"\n"}
                      </span>
                    ))}
                    {"  ],\n  "}<span style={{ color: "#0066cc" }}>"meta"</span>{": { "}<span style={{ color: "#0066cc" }}>"total"</span>{": "}<span style={{ color: "#b35a00" }}>3</span>{", "}<span style={{ color: "#0066cc" }}>"page"</span>{": "}<span style={{ color: "#b35a00" }}>1</span>{", "}<span style={{ color: "#0066cc" }}>"per_page"</span>{": "}<span style={{ color: "#b35a00" }}>20</span>{" }\n}"}
                  </pre>
                )}
                {resTab === "Cookie" && (
                  <div style={{ fontFamily: "monospace", fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 16, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ color: C.accentText }}>session_id</span>
                      <span>abc123xyz</span>
                      <span style={{ color: C.muted }}>api.example.com</span>
                      <span style={{ color: "#b35a00", fontSize: 11 }}>HttpOnly</span>
                    </div>
                  </div>
                )}
                {resTab === "Console" && (
                  <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.8 }}>
                    <div style={{ color: C.green }}>✓ Token set: "my-jwt-token"</div>
                    <div style={{ color: C.green }}>✓ Status is 200</div>
                    <div style={{ color: C.green }}>✓ Response time &lt; 2000ms</div>
                    <div style={{ color: C.green }}>✓ Body has data array</div>
                  </div>
                )}
                {resTab === "Actual Request" && (
                  <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 12, lineHeight: 1.85 }}>
                    <span style={{ color: "#0066cc" }}>GET</span>{" https://api.example.com/api/users?page=1&limit=20 "}<span style={{ color: C.muted }}>HTTP/1.1</span>{"\n"}
                    <span style={{ color: "#b35a00" }}>Authorization</span>{": "}<span style={{ color: C.text }}>Bearer eyJhbGciOiJSUzI1NiJ9...</span>{"\n"}
                    <span style={{ color: "#b35a00" }}>Content-Type</span>{": "}<span style={{ color: C.text }}>application/json</span>
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ height: 28, background: C.white, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, padding: "0 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.green }} />
          <span style={{ color: C.muted, fontSize: 11 }}>Ready</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: C.muted, fontSize: 11 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Production
        </div>
        <div style={{ flex: 1 }} />
        {["▶ Runner", "Console", "Cookies", "?"].map(l => (
          <span key={l} style={{ color: C.muted, fontSize: 11, cursor: "pointer" }}>{l}</span>
        ))}
      </div>

      {/* IMPORT MODAL */}
      {showImport && (
        <div onClick={() => setShowImport(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.28)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.white, borderRadius: 14, padding: "28px 32px", width: 860, maxWidth: "95%", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 4 }}>Import API Data</div>
                <div style={{ fontSize: 13, color: C.muted }}>Please select the corresponding data source format</div>
              </div>
              <button onClick={() => setShowImport(false)} style={{ background: "transparent", border: "none", fontSize: 22, color: C.hint, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
              {IMPORT_FORMATS.map((fmt, i) => (
                <div key={fmt.name} onClick={() => setSelectedImport(i)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                    padding: "14px 8px 12px", border: `1.5px solid ${selectedImport === i ? C.accent : C.border}`,
                    borderRadius: 10, cursor: "pointer", transition: "all 0.15s",
                    background: selectedImport === i ? C.accentLight : C.white,
                    fontSize: 11.5, color: selectedImport === i ? C.accentText : "#444", textAlign: "center",
                  }}>
                  <ImportIcon fmt={fmt} />
                  <span>{fmt.name}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              {btn(() => setShowImport(false), "Cancel")}
              {btn(() => setShowImport(false), "Next →", true)}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
        input:focus { outline: none !important; }
        select { outline: none; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }
      `}</style>
    </div>
  )
}
