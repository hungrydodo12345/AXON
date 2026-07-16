/**
 * app/page.jsx — Inbox (Home)
 *
 * Loads the signed-in user's profile + message history from the local
 * bridge, then listens for live updates over SSE. Redirects to
 * /onboarding if no local session exists yet.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import PileView from "../components/PileView";
import GargoyleButton from "../components/GargoyleButton";
import SensoryPanel from "../components/SensoryPanel";
import ImportPanel from "../components/ImportPanel";

const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:3000";

export default function InboxPage() {
  const [userId, setUserId] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [constitution, setConstitution] = useState({});
  const [messages, setMessages] = useState([]);
  const [nudges, setNudges] = useState([]);
  const [showSensory, setShowSensory] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [status, setStatus] = useState("loading"); // loading | ready | error | signed_out

  useEffect(() => {
    const storedUserId = localStorage.getItem("nl_user_id");
    const storedToken = localStorage.getItem("nl_auth_token");

    if (!storedUserId || !storedToken) {
      window.location.href = "/onboarding";
      return;
    }

    setUserId(storedUserId);
    setAuthToken(storedToken);
  }, []);

  const loadState = useCallback(async (id, token) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/state/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load inbox");
      const data = await res.json();
      setConstitution(data.constitution || {});
      setMessages(data.messages || []);
      setStatus("ready");
    } catch (err) {
      console.error("[AXON] Failed to load state:", err);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!userId || !authToken) return;
    loadState(userId, authToken);

    const source = new EventSource(
      `${BRIDGE_URL}/events/${userId}?token=${encodeURIComponent(authToken)}`
    );

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "new_message") {
          setMessages((prev) => [payload.message, ...prev]);
        } else if (payload.type === "nudge") {
          setNudges((prev) => [payload, ...prev].slice(0, 5));
        }
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    return () => source.close();
  }, [userId, authToken, loadState]);

  if (status === "loading") {
    return <CenteredMessage text="Loading your inbox…" />;
  }

  if (status === "error") {
    return <CenteredMessage text="Couldn't reach the AXON bridge. Is it running?" />;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>AXON</h1>
        <div style={styles.headerActions}>
          <button style={styles.iconBtn} onClick={() => setShowImport(true)}>
            Import
          </button>
          <button style={styles.iconBtn} onClick={() => setShowSensory(true)}>
            Sensory
          </button>
          <GargoyleButton userId={userId} authToken={authToken} />
        </div>
      </header>

      <main style={styles.main}>
        <PileView
          messages={messages}
          constitution={constitution}
          userId={userId}
          authToken={authToken}
          nudges={nudges}
        />
      </main>

      {showSensory && <SensoryPanel onClose={() => setShowSensory(false)} />}
      {showImport && (
        <ImportPanel
          userId={userId}
          authToken={authToken}
          onClose={() => setShowImport(false)}
          onImported={() => loadState(userId, authToken)}
        />
      )}
    </div>
  );
}

function CenteredMessage({ text }) {
  return (
    <div style={styles.centered}>
      <p>{text}</p>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
  },
  title: {
    fontSize: "1.25rem",
    margin: 0,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  iconBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    color: "inherit",
  },
  main: {
    flex: 1,
    padding: "20px",
    maxWidth: "820px",
    width: "100%",
    margin: "0 auto",
  },
  centered: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted, #888)",
  },
};
