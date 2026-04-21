/**
 * components/ConstitutionToggle.jsx
 *
 * "See Original" and "Learn Why" toggles.
 * Core of SCAFFOLDING_GROWTH — always available per constitution.
 *
 * Constitutional compliance:
 *   - Both toggles always rendered (even if off by default)
 *   - PTSD profile: See Original defaults off but remains accessible
 *   - Never removed from UI by any profile
 */

"use client";

import { useState } from "react";

export default function ConstitutionToggle({
  original,
  translated,
  learnWhy,
  sarcasmExplanation,
  toneLabel,
  defaultShowOriginal = false,
}) {
  const [showOriginal, setShowOriginal] = useState(defaultShowOriginal);
  const [showLearnWhy, setShowLearnWhy] = useState(false);

  const hasLearnWhy = learnWhy || sarcasmExplanation;

  return (
    <div style={styles.wrapper}>
      {/* Tone label — always shown */}
      {toneLabel && (
        <div style={styles.toneLabel}>
          {toneLabel}
        </div>
      )}

      {/* Main message content */}
      <div style={styles.messageContent}>
        {showOriginal ? (
          <p style={styles.originalText}>{original}</p>
        ) : (
          <p style={styles.translatedText}>{translated}</p>
        )}
      </div>

      {/* Learn Why expansion */}
      {showLearnWhy && hasLearnWhy && (
        <div style={styles.learnWhyPanel}>
          <p style={styles.learnWhyText}>
            {learnWhy || sarcasmExplanation}
          </p>
        </div>
      )}

      {/* Toggle controls */}
      <div style={styles.controls}>
        <button
          style={styles.toggleBtn}
          onClick={() => setShowOriginal((v) => !v)}
          aria-pressed={showOriginal}
        >
          {showOriginal ? "Show simplified" : "See original"}
        </button>

        {hasLearnWhy && (
          <button
            style={{
              ...styles.toggleBtn,
              ...(showLearnWhy ? styles.toggleActive : {}),
            }}
            onClick={() => setShowLearnWhy((v) => !v)}
            aria-pressed={showLearnWhy}
          >
            {showLearnWhy ? "Hide explanation" : "Learn why"}
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  toneLabel: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  messageContent: {
    padding: "2px 0",
  },
  translatedText: {
    color: "var(--text-primary)",
    lineHeight: "1.7",
    fontSize: "0.95rem",
  },
  originalText: {
    color: "var(--text-secondary)",
    lineHeight: "1.7",
    fontSize: "0.9rem",
    fontStyle: "italic",
    borderLeft: "2px solid var(--border)",
    paddingLeft: "12px",
  },
  learnWhyPanel: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "12px 16px",
  },
  learnWhyText: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
    lineHeight: "1.65",
  },
  controls: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  toggleBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "6px 14px",
    borderRadius: "6px",
    fontSize: "0.8rem",
    minHeight: "36px",
    cursor: "pointer",
  },
  toggleActive: {
    borderColor: "var(--text-secondary)",
    color: "var(--text-secondary)",
  },
};
