/**
 * components/MessageCard.jsx
 *
 * Single message display card.
 * Handles: content warning gate, translation display,
 * See Original/Learn Why, Response Trinity.
 */

"use client";

import { useState } from "react";
import ConstitutionToggle from "./ConstitutionToggle";
import ResponseTrinity from "./ResponseTrinity";

export default function MessageCard({
  message,
  constitution,
  userId,
  authToken,
}) {
  const {
    from,
    original_text,
    translated_text,
    triage_pile,
    tone_analysis,
    response_options,
    content_warning,
    action_items,
    events_detected,
    summary,
  } = message;

  const [warningAcknowledged, setWarningAcknowledged] = useState(!content_warning);
  const [showActions, setShowActions] = useState(false);
  const [replied, setReplied] = useState(false);

  const displayText = translated_text || original_text;
  const showOriginalDefault = constitution?.growth?.see_original === false ? false : false;

  return (
    <div style={styles.card}>
      {/* Pile badge */}
      <div style={styles.header}>
        <span className={`pile-badge ${triage_pile}`}>
          {triage_pile}
        </span>
        <span style={styles.sender}>{formatSender(from)}</span>
      </div>

      {/* Content warning gate */}
      {!warningAcknowledged ? (
        <div
          className="content-warning"
          onClick={() => setWarningAcknowledged(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setWarningAcknowledged(true)}
          aria-label="Content warning. Tap to reveal message."
        >
          <p style={styles.warningText}>{content_warning}</p>
          <p style={styles.warningTap}>Tap to reveal</p>
        </div>
      ) : (
        <>
          {/* Summary (ADHD: shown first) */}
          {summary && (
            <p style={styles.summary}>{summary}</p>
          )}

          {/* Message content with toggles */}
          <ConstitutionToggle
            original={original_text}
            translated={displayText}
            learnWhy={tone_analysis?.learn_why}
            sarcasmExplanation={tone_analysis?.sarcasm_explanation}
            toneLabel={tone_analysis?.tone_label}
            defaultShowOriginal={showOriginalDefault}
          />

          {/* Action items (ADHD constitution) */}
          {action_items?.length > 0 && (
            <div style={styles.actionItems}>
              <p style={styles.actionLabel}>Action needed:</p>
              <ul style={styles.actionList}>
                {action_items.map((item, i) => (
                  <li key={i} style={styles.actionItem}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Calendar events */}
          {events_detected?.length > 0 && (
            <div style={styles.events}>
              {events_detected.map((event, i) => (
                <div key={i} style={styles.eventRow}>
                  <span style={styles.eventDesc}>{event.description}</span>
                  {event.calendar_link && (
                    <a
                      href={event.calendar_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.calendarLink}
                    >
                      Add to calendar
                    </a>
                  )}
                  {event.date_parsed && (
                    <span style={styles.eventDate}>
                      {formatRelativeDate(event.date_parsed)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Response Trinity */}
          {!replied && (
            <ResponseTrinity
              messageId={message.id}
              mcq={response_options?.mcq || []}
              aiDraft={response_options?.ai_draft || ""}
              replyExpected={response_options?.reply_expected ?? true}
              socialContext={response_options?.social_context}
              constitution={constitution}
              userId={userId}
              authToken={authToken}
              onReplySent={() => setReplied(true)}
            />
          )}

          {replied && (
            <p style={styles.replied}>Replied.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers ──

function formatSender(phone) {
  if (!phone) return "Unknown";
  // Strip @c.us suffix from WhatsApp IDs
  return phone.replace("@c.us", "").replace("@g.us", " (group)");
}

function formatRelativeDate(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = date - now;
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1 && diffDays < 7) return `in ${diffDays} days`;
  return date.toLocaleDateString();
}

const styles = {
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  sender: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
  },
  summary: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
    fontStyle: "italic",
    borderLeft: "2px solid var(--border)",
    paddingLeft: "10px",
  },
  warningText: {
    color: "var(--safety-text)",
    fontSize: "0.875rem",
    marginBottom: "6px",
  },
  warningTap: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
  },
  actionItems: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 14px",
  },
  actionLabel: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  actionList: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  actionItem: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
    paddingLeft: "12px",
    position: "relative",
  },
  events: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  eventRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "8px 12px",
  },
  eventDesc: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
    flex: 1,
  },
  eventDate: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
  },
  calendarLink: {
    color: "var(--pile-social-text)",
    fontSize: "0.8rem",
    textDecoration: "underline",
  },
  replied: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
    paddingTop: "4px",
  },
};
