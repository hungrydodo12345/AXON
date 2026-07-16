/**
 * components/ImportPanel.jsx
 *
 * Manual import: paste an email, or paste/upload an exported WhatsApp
 * chat (.txt). No OAuth, no setup — works the moment you have text
 * to paste in.
 */

"use client";

import { useState } from "react";

const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:3000";

export default function ImportPanel({ userId, authToken, onClose, onImported }) {
  const [tab, setTab] = useState("email"); // "email" | "whatsapp"

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Import messages</h2>
          <button style={styles.closeBtn} onClick={onClose}>Close</button>
        </div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(tab === "email" ? styles.tabActive : {}) }}
            onClick={() => setTab("email")}
          >
            Email
          </button>
          <button
            style={{ ...styles.tab, ...(tab === "whatsapp" ? styles.tabActive : {}) }}
            onClick={() => setTab("whatsapp")}
          >
            WhatsApp export
          </button>
        </div>

        {tab === "email" ? (
          <EmailImportForm userId={userId} authToken={authToken} onImported={onImported} />
        ) : (
          <WhatsAppImportForm userId={userId} authToken={authToken} onImported={onImported} />
        )}
      </div>
    </div>
  );
}

function EmailImportForm({ userId, authToken, onImported }) {
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState(null); // null | "sending" | "done" | "error"

  const submit = async () => {
    if (!body.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch(`${BRIDGE_URL}/api/import/email/${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ from, subject, body }),
      });
      if (!res.ok) throw new Error("Import failed");
      setStatus("done");
      setFrom("");
      setSubject("");
      setBody("");
      onImported?.();
    } catch {
      setStatus("error");
    }
  };

  return (
    <div style={styles.form}>
      <p style={styles.hint}>Paste an email in — no account connection needed.</p>
      <input
        style={styles.input}
        placeholder="From (name or email)"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      />
      <input
        style={styles.input}
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        style={styles.textarea}
        placeholder="Paste the email body here"
        rows={8}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button style={styles.submitBtn} onClick={submit} disabled={!body.trim() || status === "sending"}>
        {status === "sending" ? "Importing..." : "Import email"}
      </button>
      {status === "done" && <p style={styles.success}>Imported.</p>}
      {status === "error" && <p style={styles.error}>Import failed — is the bridge running?</p>}
    </div>
  );
}

function WhatsAppImportForm({ userId, authToken, onImported }) {
  const [chatText, setChatText] = useState("");
  const [status, setStatus] = useState(null);
  const [importedCount, setImportedCount] = useState(0);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setChatText(text);
  };

  const submit = async () => {
    if (!chatText.trim()) return;
    setStatus("sending");
    try {
      const res = await fetch(`${BRIDGE_URL}/api/import/whatsapp/${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ chatText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Import failed");
      }
      const data = await res.json();
      setImportedCount(data.imported || 0);
      setStatus("done");
      setChatText("");
      onImported?.();
    } catch {
      setStatus("error");
    }
  };

  return (
    <div style={styles.form}>
      <p style={styles.hint}>
        In WhatsApp: open a chat → ⋮ → More → Export chat → Without Media.
        Upload the .txt file, or paste its contents below.
      </p>
      <input type="file" accept=".txt" onChange={handleFile} style={styles.fileInput} />
      <textarea
        style={styles.textarea}
        placeholder="...or paste the exported chat text here"
        rows={8}
        value={chatText}
        onChange={(e) => setChatText(e.target.value)}
      />
      <button style={styles.submitBtn} onClick={submit} disabled={!chatText.trim() || status === "sending"}>
        {status === "sending" ? "Importing..." : "Import chat"}
      </button>
      {status === "done" && <p style={styles.success}>Imported {importedCount} message(s).</p>}
      {status === "error" && <p style={styles.error}>Import failed — check the file is a standard WhatsApp export.</p>}
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  panel: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "16px",
    padding: "24px",
    width: "100%",
    maxWidth: "520px",
    maxHeight: "85vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { margin: 0, fontSize: "1.1rem", color: "var(--text-primary)" },
  closeBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "6px 12px",
    cursor: "pointer",
    color: "var(--text-secondary)",
  },
  tabs: { display: "flex", gap: "6px" },
  tab: {
    flex: 1,
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "8px",
    cursor: "pointer",
    color: "var(--text-secondary)",
  },
  tabActive: { background: "var(--bg-card-hover)", color: "var(--text-primary)", borderColor: "var(--text-muted)" },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  hint: { color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 },
  input: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    padding: "10px 12px",
    fontFamily: "inherit",
  },
  fileInput: { color: "var(--text-secondary)", fontSize: "0.85rem" },
  textarea: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    padding: "10px 12px",
    fontFamily: "inherit",
    resize: "vertical",
  },
  submitBtn: {
    background: "var(--bg-card-hover)",
    border: "1px solid var(--text-muted)",
    borderRadius: "8px",
    padding: "10px",
    color: "var(--text-primary)",
    cursor: "pointer",
  },
  success: { color: "var(--pile-casual-text)", fontSize: "0.85rem", margin: 0 },
  error: { color: "var(--safety-text)", fontSize: "0.85rem", margin: 0 },
};
