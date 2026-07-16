/**
 * components/PileView.jsx
 *
 * Four-pile inbox display.
 * Piles: Important → Social → Casual → Archive
 * Constitution-aware: shows/hides urgency timers, read receipts etc.
 */

"use client";

import { useState } from "react";
import MessageCard from "./MessageCard";

const PILE_ORDER = ["important", "social", "casual", "archive"];

const PILE_CONFIG = {
  important: {
    label: "Important",
    emptyText: "Nothing urgent right now.",
  },
  social: {
    label: "Social",
    emptyText: "No social messages.",
  },
  casual: {
    label: "Casual",
    emptyText: "Nothing casual.",
  },
  archive: {
    label: "Groups",
    emptyText: "No group messages.",
  },
};

export default function PileView({
  messages = [],
  constitution = {},
  userId,
  authToken,
  nudges = [],
}) {
  const [activePile, setActivePile] = useState("important");

  // Group messages by pile
  const grouped = PILE_ORDER.reduce((acc, pile) => {
    acc[pile] = messages.filter((m) => m.triage_pile === pile);
    return acc;
  }, {});

  const counts = PILE_ORDER.reduce((acc, pile) => {
    acc[pile] = grouped[pile].length;
    return acc;
  }, {});

  // Constitution: suppress urgency timers if required
  const showUrgency = constitution?.triage?.urgency_timers !== false;

  return (
    <div style={styles.wrapper}>
      {/* Nudge notifications */}
      {nudges.length > 0 && (
        <div style={styles.nudges}>
          {nudges.map((nudge, i) => (
            <div key={i} style={styles.nudge}>
              {nudge.text}
            </div>
          ))}
        </div>
      )}

      {/* Pile selector tabs */}
      <div style={styles.pileTabs} role="tablist">
        {PILE_ORDER.map((pile) => (
          <button
            key={pile}
            role="tab"
            aria-selected={activePile === pile}
            style={{
              ...styles.pileTab,
              ...(activePile === pile ? styles.pileTabActive : {}),
            }}
            onClick={() => setActivePile(pile)}
          >
            <span className={`pile-badge ${pile}`}>
              {PILE_CONFIG[pile].label}
            </span>
            {counts[pile] > 0 && (
              <span style={styles.count}>{counts[pile]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Active pile messages */}
      <div style={styles.messageList} role="tabpanel">
        {grouped[activePile].length === 0 ? (
          <p style={styles.emptyText}>
            {PILE_CONFIG[activePile].emptyText}
          </p>
        ) : (
          grouped[activePile].map((msg) => (
            <div key={msg.id} style={styles.cardWrapper}>
              {/* Urgency timer (ADHD constitution, suppressed for anxiety) */}
              {showUrgency && msg.triage_pile === "important" && (
                <UrgencyIndicator message={msg} constitution={constitution} />
              )}
              <MessageCard
                message={msg}
                constitution={constitution}
                userId={userId}
                authToken={authToken}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Urgency indicator (only shown if constitution allows) ──
function UrgencyIndicator({ message, constitution }) {
  if (!message.created_at) return null;

  const created = new Date(
    message.created_at?.toDate ? message.created_at.toDate() : message.created_at
  );
  const hoursAgo = Math.round((Date.now() - created.getTime()) / (1000 * 60 * 60));

  return (
    <div style={styles.urgency}>
      {hoursAgo < 1
        ? "Just now"
        : `${hoursAgo}h ago`}
    </div>
  );
}

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  nudges: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  nudge: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
  },
  pileTabs: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  pileTab: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "8px 12px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    minHeight: "var(--min-touch)",
  },
  pileTabActive: {
    background: "var(--bg-card)",
    borderColor: "var(--text-muted)",
  },
  count: {
    background: "var(--bg-secondary)",
    color: "var(--text-muted)",
    borderRadius: "10px",
    padding: "2px 8px",
    fontSize: "0.75rem",
    minWidth: "22px",
    textAlign: "center",
  },
  messageList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  cardWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  emptyText: {
    color: "var(--text-muted)",
    fontSize: "0.875rem",
    padding: "24px 0",
    textAlign: "center",
  },
  urgency: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    paddingLeft: "4px",
  },
};
