/**
 * components/GargoyleButton.jsx
 *
 * Persistent panic button — always visible per SAFETY_BYPASS mandate.
 * Sends multi-channel safety alert via the Bridge API.
 *
 * Constitutional compliance:
 *   - Always rendered, never hidden by any other UI
 *   - Sends location if available
 *   - Shows grounding prompt after activation
 *   - Respects cooldown — shows remaining time
 */

"use client";

import { useState, useCallback } from "react";

export default function GargoyleButton({ userId, authToken }) {
  const [state, setState] = useState("idle"); // idle | sending | sent | cooldown | error
  const [grounding, setGrounding] = useState(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const handlePress = useCallback(async () => {
    if (state === "sending" || state === "cooldown") return;

    setState("sending");
    setGrounding(null);

    // Attempt to get location
    let location = null;
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 })
      );
      location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      // Location unavailable — continue without it
    }

    try {
      const bridgeUrl = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:3000";
      const res = await fetch(`${bridgeUrl}/gargoyle/${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ location }),
      });

      const data = await res.json();

      if (data.cooldown) {
        setState("cooldown");
        setCooldownRemaining(data.cooldown_remaining || 0);
      } else {
        setState("sent");
        setGrounding(data.grounding || "You are safe. You are here.");
      }
    } catch {
      setState("error");
    }
  }, [state, userId, authToken]);

  return (
    <div style={styles.wrapper}>
      {/* Grounding prompt shown after activation */}
      {grounding && (
        <div style={styles.grounding} role="alert">
          <p style={styles.groundingText}>{grounding}</p>
          <button
            style={styles.groundingDismiss}
            onClick={() => { setGrounding(null); setState("idle"); }}
          >
            I am okay
          </button>
        </div>
      )}

      {/* Cooldown notice */}
      {state === "cooldown" && (
        <div style={styles.cooldownNotice}>
          Alert sent. Next alert available in {cooldownRemaining}s.
        </div>
      )}

      {/* The button itself */}
      <button
        style={{
          ...styles.button,
          ...(state === "sending" ? styles.sending : {}),
          ...(state === "sent" ? styles.sent : {}),
          ...(state === "cooldown" ? styles.cooldown : {}),
          ...(state === "error" ? styles.error : {}),
        }}
        onClick={handlePress}
        disabled={state === "sending" || state === "cooldown"}
        aria-label="Safety alert button — press if you need help"
        aria-live="polite"
      >
        {state === "sending" && "Sending alert..."}
        {state === "sent" && "Alert sent ✓"}
        {state === "cooldown" && `Alert sent (${cooldownRemaining}s)`}
        {state === "error" && "Retry alert"}
        {state === "idle" && "Safety Alert"}
      </button>
    </div>
  );
}

const styles = {
  wrapper: {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "12px",
  },
  button: {
    minWidth: "140px",
    minHeight: "56px",
    padding: "14px 24px",
    background: "var(--safety-bg)",
    border: "2px solid var(--safety-border)",
    borderRadius: "12px",
    color: "var(--safety-text)",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    letterSpacing: "0.02em",
  },
  sending: {
    opacity: 0.7,
    cursor: "not-allowed",
  },
  sent: {
    borderColor: "#3a5a3a",
    background: "#1a3a1a",
    color: "#7ac87a",
  },
  cooldown: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  error: {
    borderColor: "#8a2a2a",
    background: "#4a1a1a",
  },
  grounding: {
    background: "#1a2a1a",
    border: "1px solid #2a4a2a",
    borderRadius: "12px",
    padding: "16px 20px",
    maxWidth: "280px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  groundingText: {
    color: "#90c890",
    fontSize: "0.95rem",
    lineHeight: "1.6",
  },
  groundingDismiss: {
    background: "#2a4a2a",
    border: "1px solid #3a6a3a",
    color: "#7ac87a",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "0.875rem",
    minHeight: "44px",
    cursor: "pointer",
  },
  cooldownNotice: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "8px 14px",
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
    maxWidth: "220px",
    textAlign: "right",
  },
};
