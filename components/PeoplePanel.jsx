/**
 * components/PeoplePanel.jsx
 *
 * The "Person" side of AXON's core concept: every sender AXON has
 * seen a message from is auto-added here (no setup needed) with just
 * their raw id as a name. Naming them, adding how you know them, and
 * jotting notes is a single inline edit — effortless by design, and
 * it never gets overwritten by future auto-updates once you've set it.
 */

"use client";

import { useState, useMemo } from "react";

const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:3000";

const CATEGORIES = ["personal", "work"];
const BUCKETS = ["vip", "casual", "mute"];

export default function PeoplePanel({ userId, authToken, contacts, onClose, onChanged }) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [addingNew, setAddingNew] = useState(null); // null | "work" | "personal"

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      (c.display_name || c.contact_id || "").toLowerCase().includes(q) ||
      (c.relationship_context || "").toLowerCase().includes(q)
    );
  }, [contacts, query]);

  const workContacts = filtered.filter((c) => c.category === "work");
  const personalContacts = filtered.filter((c) => c.category !== "work");

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>People</h2>
          <button style={styles.closeBtn} onClick={onClose}>Close</button>
        </div>

        <input
          style={styles.search}
          placeholder="Search people or relationships..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <PeopleSection
          label="Work"
          contacts={workContacts}
          userId={userId}
          authToken={authToken}
          editingId={editingId}
          setEditingId={setEditingId}
          addingNew={addingNew === "work"}
          onAddClick={() => setAddingNew("work")}
          defaultCategory="work"
          onDone={() => { setAddingNew(null); setEditingId(null); onChanged?.(); }}
          onCancel={() => { setAddingNew(null); setEditingId(null); }}
        />

        <PeopleSection
          label="Personal"
          contacts={personalContacts}
          userId={userId}
          authToken={authToken}
          editingId={editingId}
          setEditingId={setEditingId}
          addingNew={addingNew === "personal"}
          onAddClick={() => setAddingNew("personal")}
          defaultCategory="personal"
          onDone={() => { setAddingNew(null); setEditingId(null); onChanged?.(); }}
          onCancel={() => { setAddingNew(null); setEditingId(null); }}
        />
      </div>
    </div>
  );
}

function PeopleSection({
  label, contacts, userId, authToken, editingId, setEditingId,
  addingNew, onAddClick, defaultCategory, onDone, onCancel,
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader}>
        <h3 style={styles.sectionTitle}>{label} <span style={styles.sectionCount}>({contacts.length})</span></h3>
        <button style={styles.addBtn} onClick={onAddClick}>+ Add</button>
      </div>

      {addingNew && (
        <PersonForm
          userId={userId}
          authToken={authToken}
          defaultCategory={defaultCategory}
          onDone={onDone}
          onCancel={onCancel}
        />
      )}

      <div style={styles.list}>
        {contacts.length === 0 && !addingNew && (
          <p style={styles.empty}>
            {label === "Work"
              ? "No work people yet — they'll show up automatically, or add one above."
              : "No personal people yet — they'll show up automatically, or add one above."}
          </p>
        )}

        {contacts.map((c) => (
          <div key={c.contact_id} style={styles.row}>
            {editingId === c.contact_id ? (
              <PersonForm
                userId={userId}
                authToken={authToken}
                contactId={c.contact_id}
                initial={c}
                defaultCategory={defaultCategory}
                onDone={onDone}
                onCancel={onCancel}
              />
            ) : (
              <button style={styles.rowBtn} onClick={() => setEditingId(c.contact_id)}>
                <div style={styles.rowMain}>
                  <span style={styles.name}>{c.display_name || c.contact_id}</span>
                  {c.relationship_context && (
                    <span style={styles.relationship}>{c.relationship_context}</span>
                  )}
                </div>
                <div style={styles.rowMeta}>
                  <span className={`pile-badge ${c.bucket || "casual"}`}>{c.bucket || "casual"}</span>
                  <span style={styles.count}>{c.message_count || 0} msg{(c.message_count || 0) === 1 ? "" : "s"}</span>
                </div>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonForm({ userId, authToken, contactId, initial, defaultCategory, onDone, onCancel }) {
  const [name, setName] = useState(initial?.display_name || "");
  const [relationship, setRelationship] = useState(initial?.relationship_context || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [category, setCategory] = useState(initial?.category || defaultCategory || "personal");
  const [bucket, setBucket] = useState(initial?.bucket || "casual");
  const [newId, setNewId] = useState("");
  const [saving, setSaving] = useState(false);

  const isNew = !contactId;

  const save = async () => {
    const id = contactId || newId.trim();
    if (!id) return;
    setSaving(true);
    try {
      await fetch(`${BRIDGE_URL}/api/contacts/${userId}/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          display_name: name,
          relationship_context: relationship,
          notes,
          category,
          bucket,
        }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.form}>
      {isNew && (
        <input
          style={styles.input}
          placeholder="Email, phone, or name to identify them by"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
      )}
      <input
        style={styles.input}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        style={styles.input}
        placeholder="Relationship (e.g. sister, coworker, college friend)"
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
      />
      <textarea
        style={styles.textarea}
        placeholder="Notes (anything worth remembering about them)"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div style={styles.categoryToggle}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            style={{ ...styles.categoryBtn, ...(category === cat ? styles.categoryBtnActive : {}) }}
            onClick={() => setCategory(cat)}
          >
            {cat === "work" ? "Work" : "Personal"}
          </button>
        ))}
      </div>
      <select style={styles.select} value={bucket} onChange={(e) => setBucket(e.target.value)}>
        {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <div style={styles.formActions}>
        <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <button style={styles.saveBtn} onClick={save} disabled={saving || (isNew && !newId.trim())}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
  },
  panel: {
    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "16px",
    padding: "24px", width: "100%", maxWidth: "560px", maxHeight: "85vh", overflowY: "auto",
    display: "flex", flexDirection: "column", gap: "14px",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: "1.1rem", color: "var(--text-primary)" },
  closeBtn: {
    background: "transparent", border: "1px solid var(--border)", borderRadius: "8px",
    padding: "6px 12px", cursor: "pointer", color: "var(--text-secondary)",
  },
  searchRow: { display: "flex", gap: "8px" },
  search: {
    flex: 1, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px",
    color: "var(--text-primary)", padding: "10px 12px", fontFamily: "inherit",
  },
  addBtn: {
    background: "var(--bg-card-hover)", border: "1px solid var(--text-muted)", borderRadius: "8px",
    padding: "6px 12px", color: "var(--text-primary)", cursor: "pointer", whiteSpace: "nowrap", fontSize: "0.85rem",
  },
  section: { display: "flex", flexDirection: "column", gap: "8px" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" },
  sectionCount: { color: "var(--text-muted)", fontWeight: "400" },
  categoryToggle: { display: "flex", gap: "6px" },
  categoryBtn: {
    flex: 1, background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "8px",
    padding: "8px", color: "var(--text-secondary)", cursor: "pointer",
  },
  categoryBtnActive: { background: "var(--bg-card-hover)", color: "var(--text-primary)", borderColor: "var(--text-muted)" },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  empty: { color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" },
  row: {
    border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden",
  },
  rowBtn: {
    width: "100%", background: "var(--bg-secondary)", border: "none", padding: "12px 14px",
    display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", textAlign: "left",
  },
  rowMain: { display: "flex", flexDirection: "column", gap: "2px" },
  name: { color: "var(--text-primary)", fontSize: "0.95rem" },
  relationship: { color: "var(--text-muted)", fontSize: "0.8rem" },
  rowMeta: { display: "flex", alignItems: "center", gap: "8px" },
  count: { color: "var(--text-muted)", fontSize: "0.75rem" },
  form: {
    display: "flex", flexDirection: "column", gap: "8px", padding: "14px",
    background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "10px",
  },
  input: {
    background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "8px",
    color: "var(--text-primary)", padding: "9px 12px", fontFamily: "inherit",
  },
  textarea: {
    background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "8px",
    color: "var(--text-primary)", padding: "9px 12px", fontFamily: "inherit", resize: "vertical",
  },
  select: {
    background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: "8px",
    color: "var(--text-primary)", padding: "9px 12px", fontFamily: "inherit",
  },
  formActions: { display: "flex", justifyContent: "flex-end", gap: "8px" },
  cancelBtn: {
    background: "transparent", border: "1px solid var(--border)", borderRadius: "8px",
    padding: "8px 14px", color: "var(--text-secondary)", cursor: "pointer",
  },
  saveBtn: {
    background: "var(--bg-card-hover)", border: "1px solid var(--text-muted)", borderRadius: "8px",
    padding: "8px 14px", color: "var(--text-primary)", cursor: "pointer",
  },
};
