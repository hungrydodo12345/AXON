/**
 * app/onboarding/page.jsx — One-Time Setup
 *
 * Steps:
 *   1. Phone number entry
 *   2. Preference questionnaire (auto-detection)
 *   3. Vocabulary + reading level setup
 *   4. Safety word + emergency contacts
 *   5. BYOK keys (optional)
 *   6. Profile creation → redirect to inbox
 *
 * Constitutional compliance:
 *   - NON-DIAGNOSTIC: questions are preference-based only
 *   - PRIVACY_ABSOLUTE: all data goes to user's Firestore
 *   - BYOK: user can provide own keys or use host defaults
 */

"use client";

import { useState } from "react";

const TOTAL_STEPS = 5;

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState({
    phone: "",
    answers: {},
    restricted_vocab: "",
    reading_level: 3,
    safety_word: "",
    safety_contacts: [{ name: "", phone: "", email: "" }],
    groq_key: "",
    firebase_config: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const update = (key, value) => setData((d) => ({ ...d, [key]: value }));

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const back = () => setStep((s) => Math.max(s - 1, 1));

  // ── STEP 5: Submit and create profile ──
  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const { initFirebaseClient, getDb } = await import("../../lib/firebase");
      const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");

      // Save optional BYOK config to localStorage
      if (data.firebase_config) {
        try {
          const parsed = JSON.parse(data.firebase_config);
          localStorage.setItem("nl_firebase_config", JSON.stringify(parsed));
        } catch {
          throw new Error("Firebase config JSON is not valid.");
        }
      }

      initFirebaseClient();
      const db = getDb();

      // Build restricted vocab array
      const vocab = data.restricted_vocab
        .split(",")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);

      // Auto-detect constitution blend from answers
      const { autoDetectBlend } = await import("../../lib/constitutionEngine");
      const blend = autoDetectBlend(data.answers);

      const profile = {
        phone_number: data.phone,
        constitution_blend: blend,
        restricted_vocab: vocab,
        reading_level: data.reading_level,
        safety_word: data.safety_word,
        safety_contacts: data.safety_contacts.filter((c) => c.name || c.phone || c.email),
        contact_buckets: { vip: [], work: [], casual: [], mute: [] },
        user_keys: {
          GROQ_API_KEY: data.groq_key || null,
        },
        sensory_settings: {
          grayscale: true,
          brightness: 0.7,
          animations: false,
          sound: false,
          haptic: false,
        },
        growth: {
          see_original_enabled: true,
          learn_why_enabled: true,
          vocab_expansion_rate: "slow",
          words_learned: [],
        },
        nudge_settings: {
          vip_inactivity_hours: 24,
          work_inactivity_hours: 48,
        },
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      };

      await setDoc(doc(db, "users", data.phone), profile);

      // Get auth token from Bridge
      const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "http://localhost:3000";
      const tokenRes = await fetch(`${BRIDGE_URL}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: data.phone }),
      });
      const { token } = await tokenRes.json();

      localStorage.setItem("nl_user_id", data.phone);
      localStorage.setItem("nl_auth_token", token);

      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Setup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Progress */}
        <div style={styles.progress}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${(step / TOTAL_STEPS) * 100}%` }} />
          </div>
          <span style={styles.progressText}>Step {step} of {TOTAL_STEPS}</span>
        </div>

        {/* ── STEP 1: Phone number ── */}
        {step === 1 && (
          <StepWrapper title="Your phone number" subtitle="This is your account ID. Include country code.">
            <input
              type="tel"
              style={styles.input}
              placeholder="+447911123456"
              value={data.phone}
              onChange={(e) => update("phone", e.target.value.trim())}
              autoComplete="tel"
            />
            {error && <p style={styles.error}>{error}</p>}
          </StepWrapper>
        )}

        {/* ── STEP 2: Preferences questionnaire ── */}
        {step === 2 && (
          <StepWrapper title="Your preferences" subtitle="No diagnosis needed. These are just your preferences.">
            <QuestionnaireStep answers={data.answers} onChange={(a) => update("answers", a)} />
          </StepWrapper>
        )}

        {/* ── STEP 3: Vocabulary + reading level ── */}
        {step === 3 && (
          <StepWrapper title="Your word settings" subtitle="We will simplify messages to match these.">
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Words you understand well (comma-separated)
                <span style={styles.hint}>Leave empty to use all words.</span>
              </label>
              <textarea
                style={styles.textarea}
                value={data.restricted_vocab}
                onChange={(e) => update("restricted_vocab", e.target.value)}
                placeholder="okay, yes, no, help, later, sorry, busy, soon..."
                rows={3}
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Reading level: Grade {data.reading_level}
                <span style={styles.hint}>{LEVEL_DESCRIPTIONS[data.reading_level]}</span>
              </label>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={data.reading_level}
                onChange={(e) => update("reading_level", parseInt(e.target.value))}
                style={styles.slider}
              />
              <div style={styles.levelLabels}>
                <span>Very simple</span>
                <span>Normal</span>
              </div>
            </div>
          </StepWrapper>
        )}

        {/* ── STEP 4: Safety ── */}
        {step === 4 && (
          <StepWrapper title="Safety settings" subtitle="These are used if you activate a safety alert.">
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Safety word
                <span style={styles.hint}>One word that triggers an immediate alert to your contacts.</span>
              </label>
              <input
                style={styles.input}
                type="text"
                value={data.safety_word}
                onChange={(e) => update("safety_word", e.target.value.trim())}
                placeholder="e.g. Gargoyle"
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>Safety contacts</label>
              {data.safety_contacts.map((contact, i) => (
                <div key={i} style={styles.contactRow}>
                  <input
                    style={styles.inputSmall}
                    placeholder="Name"
                    value={contact.name}
                    onChange={(e) => {
                      const updated = [...data.safety_contacts];
                      updated[i] = { ...updated[i], name: e.target.value };
                      update("safety_contacts", updated);
                    }}
                  />
                  <input
                    style={styles.inputSmall}
                    placeholder="Phone (+44...)"
                    value={contact.phone}
                    onChange={(e) => {
                      const updated = [...data.safety_contacts];
                      updated[i] = { ...updated[i], phone: e.target.value };
                      update("safety_contacts", updated);
                    }}
                  />
                  <input
                    style={styles.inputSmall}
                    placeholder="Email"
                    value={contact.email}
                    onChange={(e) => {
                      const updated = [...data.safety_contacts];
                      updated[i] = { ...updated[i], email: e.target.value };
                      update("safety_contacts", updated);
                    }}
                  />
                </div>
              ))}
              <button
                style={styles.addBtn}
                onClick={() => update("safety_contacts", [...data.safety_contacts, { name: "", phone: "", email: "" }])}
              >
                Add another contact
              </button>
            </div>
          </StepWrapper>
        )}

        {/* ── STEP 5: BYOK keys ── */}
        {step === 5 && (
          <StepWrapper title="Your API keys (optional)" subtitle="Leave empty to use the app's default keys.">
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Groq API key
                <span style={styles.hint}>Get yours free at console.groq.com</span>
              </label>
              <input
                style={styles.input}
                type="password"
                value={data.groq_key}
                onChange={(e) => update("groq_key", e.target.value.trim())}
                placeholder="gsk_..."
                autoComplete="off"
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Firebase config (JSON)
                <span style={styles.hint}>Paste your Firebase project config to use your own database.</span>
              </label>
              <textarea
                style={styles.textarea}
                value={data.firebase_config}
                onChange={(e) => update("firebase_config", e.target.value)}
                placeholder={'{"apiKey": "...", "projectId": "..."}'}
                rows={4}
              />
            </div>

            {error && <p style={styles.error}>{error}</p>}
          </StepWrapper>
        )}

        {/* Navigation */}
        <div style={styles.nav}>
          {step > 1 && (
            <button style={styles.backBtn} onClick={back}>
              Back
            </button>
          )}
          {step < TOTAL_STEPS ? (
            <button
              style={{
                ...styles.nextBtn,
                ...(step === 1 && !data.phone ? styles.btnDisabled : {}),
              }}
              onClick={next}
              disabled={step === 1 && !data.phone}
            >
              Next
            </button>
          ) : (
            <button
              style={{ ...styles.nextBtn, ...(loading ? styles.btnDisabled : {}) }}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? "Setting up..." : "Start using Neuro-Librarian"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Questionnaire step ──
const QUESTIONS = [
  {
    id: "comm_style",
    question: "How do you prefer people to talk to you?",
    options: [
      { value: "literal", label: "Say exactly what you mean. No hints." },
      { value: "brief", label: "Keep it short. I lose focus on long messages." },
      { value: "careful", label: "Be gentle. I worry about what people mean." },
      { value: "visual", label: "Pictures and simple words work best." },
    ],
  },
  {
    id: "social_cues",
    question: "How easy is it to understand what people really mean in messages?",
    options: [
      { value: "hard_to_read", label: "Very hard. I often misread tone." },
      { value: "sometimes_miss", label: "I miss things sometimes." },
      { value: "mostly_fine", label: "Usually fine." },
      { value: "easy", label: "Easy." },
    ],
  },
  {
    id: "sensory_needs",
    question: "How sensitive are you to bright screens or loud notifications?",
    options: [
      { value: "very_sensitive", label: "Very. I need things calm." },
      { value: "somewhat", label: "Somewhat bothered." },
      { value: "not_really", label: "Not really." },
      { value: "enjoy_stimulation", label: "I like lively interfaces." },
    ],
  },
  {
    id: "anxiety_level",
    question: "How often do you worry about how your messages come across?",
    options: [
      { value: "constant", label: "All the time." },
      { value: "social_mainly", label: "Mainly in social situations." },
      { value: "occasional", label: "Sometimes." },
      { value: "rare", label: "Rarely." },
    ],
  },
  {
    id: "organization",
    question: "How hard is it to track messages you need to reply to?",
    options: [
      { value: "very_hard", label: "I forget constantly." },
      { value: "need_reminders", label: "I need reminders." },
      { value: "mostly_ok", label: "I manage." },
      { value: "very_organized", label: "Very organized." },
    ],
  },
];

function QuestionnaireStep({ answers, onChange }) {
  const handleAnswer = (questionId, value) => {
    onChange({ ...answers, [questionId]: value });
  };

  return (
    <div style={styles.questions}>
      {QUESTIONS.map((q) => (
        <div key={q.id} style={styles.question}>
          <p style={styles.questionText}>{q.question}</p>
          <div style={styles.options}>
            {q.options.map((opt) => (
              <button
                key={opt.value}
                style={{
                  ...styles.optionBtn,
                  ...(answers[q.id] === opt.value ? styles.optionBtnSelected : {}),
                }}
                onClick={() => handleAnswer(q.id, opt.value)}
                aria-pressed={answers[q.id] === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepWrapper({ title, subtitle, children }) {
  return (
    <div style={styles.stepWrapper}>
      <h2 style={styles.stepTitle}>{title}</h2>
      {subtitle && <p style={styles.stepSubtitle}>{subtitle}</p>}
      {children}
    </div>
  );
}

const LEVEL_DESCRIPTIONS = {
  1: "Very simple — like a 6-year-old",
  2: "Simple — like an 8-year-old",
  3: "Medium — like a 10-year-old",
  4: "Clear adult language",
  5: "Normal adult language",
};

const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--bg-primary)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "32px 20px 80px",
  },
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "16px",
    padding: "28px 24px",
    width: "100%",
    maxWidth: "520px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  progress: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  progressBar: {
    height: "4px",
    background: "var(--border)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--text-muted)",
    borderRadius: "2px",
  },
  progressText: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
  },
  stepWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  stepTitle: {
    fontSize: "1.2rem",
    color: "var(--text-primary)",
  },
  stepSubtitle: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
    lineHeight: "1.6",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  label: {
    color: "var(--text-secondary)",
    fontSize: "0.875rem",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  hint: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
    fontWeight: "400",
  },
  input: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    fontSize: "1rem",
    padding: "12px 14px",
    fontFamily: "inherit",
    minHeight: "var(--min-touch)",
    width: "100%",
  },
  inputSmall: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    fontSize: "0.875rem",
    padding: "10px 12px",
    fontFamily: "inherit",
    minHeight: "var(--min-touch)",
    flex: 1,
    minWidth: "80px",
  },
  textarea: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    fontSize: "0.95rem",
    padding: "12px 14px",
    fontFamily: "inherit",
    resize: "vertical",
    width: "100%",
  },
  slider: {
    width: "100%",
    accentColor: "var(--text-muted)",
    minHeight: "var(--min-touch)",
  },
  levelLabels: {
    display: "flex",
    justifyContent: "space-between",
    color: "var(--text-muted)",
    fontSize: "0.75rem",
  },
  contactRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  addBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "8px 14px",
    borderRadius: "6px",
    fontSize: "0.8rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
    alignSelf: "flex-start",
  },
  questions: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  question: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  questionText: {
    color: "var(--text-primary)",
    fontSize: "0.95rem",
    lineHeight: "1.5",
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  optionBtn: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    padding: "12px 16px",
    borderRadius: "8px",
    fontSize: "0.875rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
    textAlign: "left",
  },
  optionBtnSelected: {
    borderColor: "var(--text-secondary)",
    color: "var(--text-primary)",
    background: "var(--bg-card)",
  },
  nav: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
  },
  backBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "0.9rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
  },
  nextBtn: {
    background: "var(--bg-card)",
    border: "1px solid var(--text-muted)",
    color: "var(--text-primary)",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "0.9rem",
    minHeight: "var(--min-touch)",
    cursor: "pointer",
    flex: 1,
    maxWidth: "280px",
    marginLeft: "auto",
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  error: {
    color: "var(--safety-text)",
    fontSize: "0.875rem",
    background: "var(--safety-bg)",
    border: "1px solid var(--safety-border)",
    borderRadius: "6px",
    padding: "10px 14px",
  },
};
