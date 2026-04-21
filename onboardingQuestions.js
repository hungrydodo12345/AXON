/**
 * onboardingQuestions.js — Auto-Detection Questionnaire
 *
 * NON-DIAGNOSTIC. Preference-based only.
 * Maps to profile weights in constitutionEngine.autoDetectBlend()
 *
 * Each question targets one or more profile signals.
 * Answers are stored in Firestore under user profile.
 * User can always manually override detected profiles.
 */

const ONBOARDING_QUESTIONS = [
  // ============================================================
  // SECTION 1: COMMUNICATION
  // ============================================================
  {
    id: "comm_style",
    section: "communication",
    question: "How do you prefer people to talk to you?",
    options: [
      { value: "literal", label: "Say exactly what you mean. No hints." },
      { value: "brief", label: "Keep it short. I lose focus on long messages." },
      { value: "careful", label: "Be gentle. I worry about what people mean." },
      { value: "visual", label: "Pictures and simple words work best." },
    ],
    targets: ["asd", "adhd", "anxiety", "dyslexia", "nvld"],
  },

  {
    id: "social_cues",
    section: "communication",
    question: "When someone texts you, how easy is it to understand what they really mean?",
    options: [
      { value: "hard_to_read", label: "Very hard. I often misread tone or intent." },
      { value: "sometimes_miss", label: "I miss things sometimes, especially sarcasm." },
      { value: "mostly_fine", label: "Usually fine, but some people confuse me." },
      { value: "easy", label: "I can read between the lines easily." },
    ],
    targets: ["asd", "nvld"],
  },

  // ============================================================
  // SECTION 2: READING & PROCESSING
  // ============================================================
  {
    id: "reading_comfort",
    section: "reading",
    question: "What helps you read messages most easily?",
    options: [
      { value: "short_simple", label: "Short sentences with simple words." },
      { value: "audio_preferred", label: "I'd rather listen than read." },
      { value: "normal", label: "Normal text is fine for me." },
      { value: "detailed_ok", label: "I like detailed, thorough messages." },
    ],
    targets: ["dyslexia", "adhd"],
  },

  {
    id: "numbers_comfort",
    section: "reading",
    question: "How do you feel about numbers in messages (dates, times, amounts)?",
    options: [
      { value: "very_hard", label: "Numbers confuse me a lot." },
      { value: "need_help", label: "I need extra time to process numbers." },
      { value: "ok", label: "Numbers are fine." },
      { value: "easy", label: "I'm very comfortable with numbers." },
    ],
    targets: ["dyscalculia"],
  },

  // ============================================================
  // SECTION 3: SENSORY & PHYSICAL
  // ============================================================
  {
    id: "sensory_needs",
    section: "sensory",
    question: "How sensitive are you to bright screens, sounds, or buzzing notifications?",
    options: [
      { value: "very_sensitive", label: "Very. I need things calm and quiet." },
      { value: "somewhat", label: "Somewhat. Loud or flashy things bother me." },
      { value: "not_really", label: "Not really an issue for me." },
      { value: "enjoy_stimulation", label: "I actually like lively, colorful interfaces." },
    ],
    targets: ["spd", "asd"],
  },

  {
    id: "motor_skills",
    section: "sensory",
    question: "How easy is it for you to tap small buttons or type on a phone?",
    options: [
      { value: "clumsy_often", label: "Hard. I often hit the wrong thing." },
      { value: "sometimes", label: "Sometimes tricky, but manageable." },
      { value: "fine", label: "No problems at all." },
    ],
    targets: ["dyspraxia"],
  },

  // ============================================================
  // SECTION 4: ORGANIZATION & FOCUS
  // ============================================================
  {
    id: "organization",
    section: "organization",
    question: "How hard is it to keep track of messages you need to reply to?",
    options: [
      { value: "very_hard", label: "I forget constantly. Messages pile up." },
      { value: "need_reminders", label: "I need reminders or I'll forget." },
      { value: "mostly_ok", label: "I manage, but it takes effort." },
      { value: "very_organized", label: "I'm very on top of it (maybe too much)." },
    ],
    targets: ["adhd", "ocd"],
  },

  // ============================================================
  // SECTION 5: EMOTIONAL PATTERNS
  // ============================================================
  {
    id: "anxiety_level",
    section: "emotional",
    question: "How often do you worry about how your messages come across?",
    options: [
      { value: "constant", label: "All the time. I reread and rewrite a lot." },
      { value: "social_mainly", label: "Mainly in social situations or with certain people." },
      { value: "occasional", label: "Sometimes, but it doesn't stop me." },
      { value: "rare", label: "Rarely. I just send it." },
    ],
    targets: ["anxiety", "ptsd"],
  },

  {
    id: "repetitive_thoughts",
    section: "emotional",
    question: "After sending a message, how often do you go back and re-check it?",
    options: [
      { value: "constant", label: "I can't stop checking. It's a loop." },
      { value: "often", label: "Often. I need to make sure it's right." },
      { value: "sometimes", label: "Sometimes, if it was important." },
      { value: "rarely", label: "Once it's sent, I move on." },
    ],
    targets: ["ocd"],
  },

  {
    id: "mood_swings",
    section: "emotional",
    question: "Do you notice big shifts in your energy or mood that affect how you communicate?",
    options: [
      { value: "extreme_cycles", label: "Yes, I go through intense high and low periods." },
      { value: "noticeable", label: "Noticeable shifts, but I can usually manage." },
      { value: "mild", label: "Mild ups and downs, nothing major." },
      { value: "stable", label: "Pretty stable overall." },
    ],
    targets: ["bipolar"],
  },

  {
    id: "trauma_history",
    section: "emotional",
    question: "Do certain topics or message tones make you feel unsafe or triggered?",
    options: [
      { value: "significant", label: "Yes, and I need warnings before seeing difficult content." },
      { value: "some", label: "Some topics are hard, but I can handle most things." },
      { value: "mild", label: "Occasionally, but it passes quickly." },
      { value: "none", label: "Not really an issue for me." },
    ],
    targets: ["ptsd"],
  },

  {
    id: "tic_experience",
    section: "physical",
    question: "Do you experience involuntary movements or sounds that affect your typing?",
    options: [
      { value: "frequent", label: "Yes, frequently. It makes typing difficult." },
      { value: "occasional", label: "Occasionally, especially when stressed." },
      { value: "rare", label: "Rarely." },
      { value: "none", label: "No." },
    ],
    targets: ["tourettes"],
  },
];

/**
 * Get all questions.
 * @returns {Array}
 */
function getQuestions() {
  return ONBOARDING_QUESTIONS;
}

/**
 * Get questions by section.
 * @param {string} section
 * @returns {Array}
 */
function getQuestionsBySection(section) {
  return ONBOARDING_QUESTIONS.filter((q) => q.section === section);
}

/**
 * Get all section names in order.
 * @returns {string[]}
 */
function getSections() {
  const seen = new Set();
  const sections = [];
  for (const q of ONBOARDING_QUESTIONS) {
    if (!seen.has(q.section)) {
      seen.add(q.section);
      sections.push(q.section);
    }
  }
  return sections;
}

/**
 * Validate that all required questions are answered.
 * @param {object} answers — { questionId: answerValue }
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateAnswers(answers) {
  const missing = [];
  for (const q of ONBOARDING_QUESTIONS) {
    if (!answers[q.id]) {
      missing.push(q.id);
    }
  }
  return {
    valid: missing.length === 0,
    missing,
  };
}

module.exports = {
  ONBOARDING_QUESTIONS,
  getQuestions,
  getQuestionsBySection,
  getSections,
  validateAnswers,
};
