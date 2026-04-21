/**
 * components/ResponseTrinity.jsx
 *
 * The Trinity — all three response options, always present.
 *
 * 1. MCQ Chips — tap to send
 * 2. AI Generate Wand — AI-drafted reply
 * 3. Manual Write / Something Else — free input with Tone Mirror
 *
 * Constitutional compliance: TRINITY_REPLY
 *   - All three options ALWAYS rendered
 *   - "Something Else" is NEVER removed
 *   - Tone Mirror: teaches, never judges
 */

"use client";

import { useState, useCallback, useRef } from "react";

const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:3000";

export default function ResponseTrinity({
  messageId,
  mcq = [],
  aiDraft = "",
  replyExpected = true,
  socialContext = null,
  constitution = {},
  userId,
  authToken,
  onReplySent,
}) {
  const [activeTab, setActiveTab] = useState("mcq"); // mcq | ai | manual
  const [manualText, setManualText] = useState("");
  const [toneMirror, setToneMirror] = useState(null);
  const [toneLoading, setToneLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showAiDraft, setShowAiDraft] = useState(false);
  const toneDebounce = useRef(null);

  // ── SEND HANDLER ──
  const sendReply = useCallback(async (text) => {
    if (!text.trim() || sending) return;

    // Apply send delay if constitution requires
    const sendDelay = constitution?.response?.send_delay || 0;
    if (sendDelay > 0) {
      setSending("countdown");
      await new Promise((r) => setTimeout(r, sendDelay * 1000));
    }

    setSending(true);

    try {
      // In Phase 4, this calls the Bridge to send via WhatsApp
      const res = await fetch(`${BRIDGE_URL}/send/${userId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ messageId, text }),
      });

      if (res.ok) {
        setSent(true);
        onReplySent?.(text);
      }
    } catch (err) {
      console.error("[TRINITY] Send failed:", err);
    } finally {
      setSending(false);
    }
  }, [sending, userId, authToken, messageId, constitution, onReplySent]);

  // ── TONE MIRROR (debounced) ──
  const handleManualInput = useCallback(async (text) => {
    setManualText(text);

    if (toneDebounce.current) clearTimeout(toneDebounce.current);

    if (text.trim().length < 3) {
      setToneMirror(null);
      return;
    }

    toneDebounce.current = setTimeout(async () => {
      setToneLoading(true);
      try {
        const res = await fetch(`${BRIDGE_URL}/tone-mirror/${userId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ draft: text, messageId }),
        });
        const data = await res.json();
        setToneMirror(data);
      } catch {
        setToneMirror(null);
      } finally {
        setToneLoading(false);
      }
    }, 800);
  }, [userId, authToken, messageId]);

  if (sent) {
    return (
      <div style={styles.sentConfirm}>
        Reply sent.
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      {/* Social context (NVLD profile) */}
      {socialContext && (
        <div style={styles.socialContext}>
          {socialContext}
        </div>
      )}

      {/* Reply expectation indicator */}
      {!replyExpected && (
        <div style={styles.noReplyNeeded}>
          No reply needed for this message.
        </div>
      )}

      {/* Tab selector */}
      <div style={styles.tabs} role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === "mcq"}
          style={{ ...styles.tab, ...(activeTab === "mcq" ? styles.tabActive : {}) }}
          onClick={() => setActiveTab("mcq")}
        >
          Quick reply
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "ai"}
          style={{ ...styles.tab, ...(activeTab === "ai" ? styles.tabActive : {}) }}
          onClick={() => setActiveTab("ai")}
        >
          AI draft
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "manual"}
          style={{ ...styles.tab, ...(activeTab === "manual" ? styles.tabActive : {}) }}
          onClick={() => setActiveTab("manual")}
        >
          Something else
        </button>
      </div>

      {/* ── MCQ CHIPS ── */}
      {activeTab === "mcq" && (
        <div style={styles.chipGrid}>
          {mcq.map((chip, i) => (
            <button
              key={i}
              className="mcq-chip"
              style={styles.chip}
              onClick={() => sendReply(chip.full_text)}
              disabled={!!sending}
              title={chip.full_text}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* ── AI DRAFT ── */}
      {activeTab === "ai" && (
        <div style={styles.aiPanel}>
          <p style={styles.aiDraftText}>{aiDraft || "No draft available."}</p>
          {aiDraft && (
            <div style={styles.aiActions}>
              <button
                style={styles.sendBtn}
                onClick={() => sendReply(aiDraft)}
                disabled={!!sending}
              >
                {sending ? "Sending..." : "Send this"}
              </button>
              <button
                style={styles.editBtn}
                onClick={() => {
                  setManualText(aiDraft);
                  setActiveTab("manual");
                }}
              >
                Edit first
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── MANUAL / SOMETHING ELSE ── */}
      {activeTab === "manual" && (
        <div style={styles.manualPanel}>
          <textarea
            style={styles.textarea}
            value={manualText}
            onChange={(e) => handleManualInput(e.target.value)}
            placeholder="Write your reply here..."
            rows={3}
            aria-label="Write your own reply"
          />

          {/* Tone Mirror feedback */}
          {(toneMirror || toneLoading) && (
            <div style={styles.toneMirrorPanel}>
              {toneLoading ? (
                <span style={styles.toneLoading}>Checking tone...</span>
              ) : (
                <>
                  <span style={{
                    ...styles.toneLabel,
                    color: toneMirror?.is_safe_to_send ? "#7ac87a" : "var(--text-secondary)",
                  }}>
                    {toneMirror?.label}
                  </span>
                  {toneMirror?.feedback && (
                    <span style={styles.toneFeedback}>{toneMirror.feedback}</span>
                  )}
                  {toneMirror?.suggestion && (
                    <span style={styles.toneSuggestion}>
                      Try: "{toneMirror.suggestion}"
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* OCD good-enough nudge */}
          {constitution?.response?.good_enough_nudge && toneMirror?.is_safe_to_send && (
            <div style={styles.goodEnoughNudge}>
              Your reply is clear. Ready to send?
            </div>
          )}

          <button
            style={{
              ...styles.sendBtn,
              ...(!manualText.trim() ? styles.sendBtnDisabled : {}),
            }}
            onClick={() => sendReply(manualText)}
            disabled={!manualText.trim() || !!sending}
          >
            {sending === "countdown" ? "Sending in a moment..." : sending ? "Sending..." : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "12px",
    borderTop: "1px solid var(--border)",
  },
  socialContext: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "6px 10px",
    background: "var(--bg-secondary)",
    borderRadius: "6px",
  },
  noReplyNeeded: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
  },
  tabs: {
    display: "flex",
    gap: "6px",
  },
  tab: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "0.8rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
    flex: 1,
  },
  tabActive: {
    borderColor: "var(--text-secondary)",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
  },
  chipGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  chip: {
    flex: "1 1 calc(33% - 8px)",
    minWidth: "100px",
  },
  aiPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  aiDraftText: {
    color: "var(--text-primary)",
    fontSize: "0.95rem",
    lineHeight: "1.7",
    padding: "12px 14px",
    background: "var(--bg-secondary)",
    borderRadius: "8px",
    border: "1px solid var(--border)",
  },
  aiActions: {
    display: "flex",
    gap: "8px",
  },
  manualPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  textarea: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    fontSize: "0.95rem",
    lineHeight: "1.7",
    padding: "12px 14px",
    resize: "vertical",
    fontFamily: "inherit",
    minHeight: "80px",
    width: "100%",
  },
  toneMirrorPanel: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 12px",
    background: "var(--bg-secondary)",
    borderRadius: "6px",
    border: "1px solid var(--border)",
  },
  toneLoading: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
  },
  toneLabel: {
    fontSize: "0.85rem",
    fontWeight: "500",
  },
  toneFeedback: {
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
  },
  toneSuggestion: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
    fontStyle: "italic",
  },
  goodEnoughNudge: {
    fontSize: "0.8rem",
    color: "#7ac87a",
    padding: "6px 10px",
    background: "#1a3a1a",
    borderRadius: "6px",
    border: "1px solid #2a5a2a",
  },
  sendBtn: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "0.9rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  sendBtnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  editBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "0.9rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
  },
  sentConfirm: {
    color: "var(--text-muted)",
    fontSize: "0.875rem",
    padding: "8px 0",
  },
};
