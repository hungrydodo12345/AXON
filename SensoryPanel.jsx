/**
 * components/SensoryPanel.jsx
 *
 * Full sensory control panel for SPD/ASD profiles.
 * Adjusts CSS variables in real time.
 * Settings persisted to localStorage + Firestore.
 *
 * Constitutional compliance: SENSORY_NEUTRALITY
 *   - Grayscale cannot be turned off (immutable rule)
 *   - Brightness minimum floor: 0.3
 */

"use client";

import { useState, useEffect } from "react";

const DEFAULTS = {
  brightness: 0.7,
  grayscale: true,       // Immutable — always true
  fontSize: 16,
  lineHeight: 1.7,
  letterSpacing: 0.01,
  font: "system",        // system | dyslexic | readable
};

export default function SensoryPanel({ onClose }) {
  const [settings, setSettings] = useState(DEFAULTS);

  // Load saved settings
  useEffect(() => {
    try {
      const saved = localStorage.getItem("nl_sensory");
      if (saved) setSettings({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {
      // Use defaults
    }
  }, []);

  // Apply changes in real-time via CSS variables
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nl-brightness", settings.brightness);
    root.style.setProperty("--nl-grayscale", settings.grayscale ? "100%" : "100%"); // Always 100%
    root.style.setProperty("--font-size-base", `${settings.fontSize}px`);
    root.style.setProperty("--line-height", settings.lineHeight);
    root.style.setProperty("--letter-spacing", `${settings.letterSpacing}em`);

    document.body.classList.remove("font-dyslexic", "font-readable");
    if (settings.font === "dyslexic") document.body.classList.add("font-dyslexic");
    if (settings.font === "readable") document.body.classList.add("font-readable");

    // Persist
    localStorage.setItem("nl_sensory", JSON.stringify(settings));
  }, [settings]);

  const update = (key, value) => setSettings((s) => ({ ...s, [key]: value }));

  return (
    <div style={styles.overlay} role="dialog" aria-label="Sensory settings">
      <div style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.title}>Display settings</h2>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        {/* Brightness */}
        <div style={styles.control}>
          <label style={styles.label}>
            Brightness: {Math.round(settings.brightness * 100)}%
          </label>
          <input
            type="range"
            min="0.3"
            max="1"
            step="0.05"
            value={settings.brightness}
            onChange={(e) => update("brightness", parseFloat(e.target.value))}
            style={styles.slider}
            aria-label="Screen brightness"
          />
        </div>

        {/* Font size */}
        <div style={styles.control}>
          <label style={styles.label}>
            Text size: {settings.fontSize}px
          </label>
          <input
            type="range"
            min="12"
            max="28"
            step="2"
            value={settings.fontSize}
            onChange={(e) => update("fontSize", parseInt(e.target.value))}
            style={styles.slider}
            aria-label="Text size"
          />
        </div>

        {/* Line height */}
        <div style={styles.control}>
          <label style={styles.label}>
            Line spacing: {settings.lineHeight}x
          </label>
          <input
            type="range"
            min="1.4"
            max="2.4"
            step="0.1"
            value={settings.lineHeight}
            onChange={(e) => update("lineHeight", parseFloat(e.target.value))}
            style={styles.slider}
            aria-label="Line spacing"
          />
        </div>

        {/* Letter spacing */}
        <div style={styles.control}>
          <label style={styles.label}>Letter spacing</label>
          <div style={styles.btnGroup}>
            {[
              { label: "Normal", value: 0.01 },
              { label: "Wide", value: 0.05 },
              { label: "Very wide", value: 0.1 },
            ].map((opt) => (
              <button
                key={opt.value}
                style={{
                  ...styles.optBtn,
                  ...(settings.letterSpacing === opt.value ? styles.optBtnActive : {}),
                }}
                onClick={() => update("letterSpacing", opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Font */}
        <div style={styles.control}>
          <label style={styles.label}>Font style</label>
          <div style={styles.btnGroup}>
            {[
              { label: "System", value: "system" },
              { label: "Readable (Lexend)", value: "readable" },
              { label: "Dyslexia-friendly", value: "dyslexic" },
            ].map((opt) => (
              <button
                key={opt.value}
                style={{
                  ...styles.optBtn,
                  ...(settings.font === opt.value ? styles.optBtnActive : {}),
                }}
                onClick={() => update("font", opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grayscale note — immutable */}
        <p style={styles.immutableNote}>
          Grayscale is always on. This protects your sensory comfort.
        </p>

        {/* Reset */}
        <button
          style={styles.resetBtn}
          onClick={() => setSettings(DEFAULTS)}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    zIndex: 10000,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  panel: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "16px 16px 0 0",
    padding: "24px 20px 40px",
    width: "100%",
    maxWidth: "480px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    maxHeight: "80vh",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: "1.1rem",
    color: "var(--text-primary)",
  },
  closeBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "8px 16px",
    borderRadius: "6px",
    fontSize: "0.875rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
  },
  control: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  label: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
  },
  slider: {
    width: "100%",
    accentColor: "var(--text-muted)",
    height: "var(--min-touch)",
    cursor: "pointer",
  },
  btnGroup: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  optBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "0.8rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
  },
  optBtnActive: {
    borderColor: "var(--text-secondary)",
    color: "var(--text-primary)",
    background: "var(--bg-secondary)",
  },
  immutableNote: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    fontStyle: "italic",
  },
  resetBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "0.875rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
    alignSelf: "flex-start",
  },
};
