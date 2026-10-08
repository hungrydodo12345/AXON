/**
 * guide.js — the in-app guide. Plain data, rendered by ui/help.js.
 * Block types: p (paragraph), h (sub-heading), ul / ol (lists), note, warn.
 * Items may be strings or [boldLead, rest].
 */

export const GUIDE = [
  {
    id: "start",
    title: "Start here",
    blocks: [
      { p: "AXON helps you make sense of messages. Paste one in and it tells you what it probably means, how it probably sounds, and gives you three calm reply options. It also remembers the people in your life, so you can ask things like “What's the story with Sam?”" },
      { p: "It's built for people who find messages tiring — neurodivergent people, people with social anxiety, or anyone who just overthinks a reply. It gives best guesses, never verdicts." },
      { h: "The whole thing in four steps" },
      { ol: [
        ["Create a vault. ", "Pick a passphrase. Your vault is one encrypted file, and you are the only one who holds it."],
        ["Connect an AI (optional). ", "Use the free trial, or bring your own provider. Without one you can still keep notes and people, and search."],
        ["Add a message. ", "Paste it, or import a WhatsApp chat export. Tap “Make sense of this”."],
        ["Save your vault. ", "Press Save to download your updated vault file. Next time, open that file to carry on."],
      ] },
    ],
  },
  {
    id: "vault",
    title: "Your vault",
    blocks: [
      { p: "AXON doesn't keep anything on a server — no account, no database. Everything you add lives in your browser's memory while the page is open, and the only lasting copy is the file you download." },
      { h: "Saving" },
      { ul: [
        "Press Save (top right) whenever you finish. You get a file named like axon-vault_r12_2026-10-07_1430.axon.",
        ["r12 is the revision. ", "It goes up by one every time you save, so a higher number is always newer."],
        "The date and time are when you saved it.",
        "The top bar says “Unsaved changes” when you've added something that isn't in a saved file yet. If you try to leave, your browser will warn you.",
      ] },
      { h: "Opening" },
      { p: "On the start page choose “Open my vault”, pick your .axon file and type your passphrase. Always open your highest revision number." },
      { h: "Your passphrase" },
      { ul: [
        "Your vault is encrypted on your device with your passphrase before it's saved. Without the passphrase, the file is unreadable to everyone — including us.",
        ["Nobody can recover a lost passphrase. ", "Choose something you'll remember: a few random words together works well (for example “maple orbit quiet bicycle”)."],
        "Store your vault somewhere safe: your cloud drive, a USB stick, or your computer. Keep an older copy as a backup.",
      ] },
      { h: "Keeping a copy on this device (optional)" },
      { p: "In Settings → Offline and this device you can switch on an encrypted copy that AXON keeps in this browser and updates as you work. Then “Continue on this device” appears on the start page and works even with no internet. It's off by default, it's locked with your passphrase, and you can delete it any time. Browsers can clear stored data, so keep saving vault files too. Don't turn it on for a shared or public computer." },
      { h: "Using a different device" },
      { p: "Copy the .axon file to the other device (email it to yourself, use a cloud drive or a USB stick) and open it there. Just remember that two devices don't merge — whichever you save last has the newest revision, so carry one file forward at a time." },
    ],
  },
  {
    id: "messages",
    title: "Adding messages",
    blocks: [
      { h: "Paste a message" },
      { p: "In the Inbox choose “Add message”. Type or pick who it's from, paste the text, and choose “Add and make sense of it”." },
      { h: "Import a WhatsApp chat" },
      { p: "WhatsApp doesn't let apps read your chats directly, so you export one yourself:" },
      { ul: [
        ["iPhone: ", "open the chat → tap the contact name → Export Chat → Without Media → save to Files."],
        ["Android: ", "open the chat → ⋮ menu → More → Export chat → Without media → save."],
      ] },
      { p: "Then in AXON choose Add message → Import WhatsApp chat, and pick the .txt file. Tell AXON which name is you, so it knows which messages you wrote. It's safe to import the same chat again later: messages already in your vault are skipped." },
      { note: "Imported messages aren't sent to any AI. They're added to your vault so you can search them and ask about them. Only the messages you choose to “Make sense of” are sent." },
    ],
  },
  {
    id: "results",
    title: "Reading the results",
    blocks: [
      { ul: [
        ["At a glance. ", "A short summary, and how soon a reply is needed."],
        ["What they probably mean. ", "The message restated in plain words."],
        ["How it sounds. ", "A tone label with a confidence level and the exact words that led there. Confidence is honest: “low” means it's a coin flip."],
        ["Asks and dates. ", "Anything they want from you and any times they mention."],
        ["Reply ideas. ", "Three drafts written as you: warm, short, and a kind “not right now”. You can edit one, then tap Copy."],
      ] },
      { warn: "Tone is always a best guess. If a message really matters, ask the person. AXON is not a therapist, and it never tells you how you should feel." },
      { p: "When you've dealt with a message, choose “I replied” or “No reply needed”. It moves from To do to Done." },
      { h: "Your needs" },
      { p: "In Settings → How AXON talks to you, choose a starting point (these are starting points, not diagnoses) or flip individual switches: say it literally, explain tone, name the feelings, keep it short, gentle wording." },
    ],
  },
  {
    id: "people",
    title: "People",
    blocks: [
      { p: "Everyone you add a message from appears under People, grouped as Work or Personal. Add how you know them (sister, manager, college friend) and notes, and AXON uses that to read their messages better." },
      { h: "What helps with them" },
      { p: "On each person you can record what helps you with them: “needs time to reply”, “prefers text to calls”, “give me a heads-up before calls”, or anything in your own words. AXON shapes its reply ideas around these (for example a kind reply that buys time), and they appear on your map. It's your own record of your accommodations, stored only in your vault." },
      { p: "Open someone and choose “Write the story so far” to get a short, kind summary of your history with them, what's still open, and small details worth remembering. It's saved in your vault." },
    ],
  },
  {
    id: "ask",
    title: "Ask and search",
    blocks: [
      { p: "Ask understands questions like “What did Morgan say about the repository?”, “Who am I waiting to reply to?” or “What's the story with Sam?”. It looks things up in your vault step by step and shows how it found the answer. If it can't find it, it says so rather than guessing." },
      { p: "Search is plain keyword search that runs only on your device and needs no AI at all." },
      { p: "Your questions and answers aren't saved in the vault. They disappear when you close the page." },
    ],
  },
  {
    id: "map",
    title: "The map",
    blocks: [
      { p: "The Map shows how everything in your vault connects, a bit like a graph of notes: people, the topics you keep coming back to, things waiting on you, and what helps with each person. It's built on your device from your own messages." },
      { ul: [
        ["Shapes, not just colours. ", "Circles are people (work and personal in different colours), diamonds are topics, rounded squares are things waiting on you, and hexagons are what helps."],
        ["3D, Flat or List. ", "Drag to rotate, scroll or pinch to zoom, and tap a shape to see what it connects to. Flat is a calmer 2D view. List is a plain text version that works well with screen readers."],
        ["Keyboard. ", "Focus the map, then use the arrow keys to rotate, + and − to zoom, N and P to move between items, and Enter to open one."],
        ["Calm by default. ", "Nothing spins unless you turn on “Gentle spin”, and it stays still if your device asks for reduced motion."],
      ] },
      { p: "Topics come from words that recur in your messages. Select one and choose Rename to give it your own name, or use “Tidy topic names with AI”, which sends only the keywords (never your messages)." },
    ],
  },
  {
    id: "offline",
    title: "Install and offline",
    blocks: [
      { p: "AXON can be installed like an app and works without internet." },
      { ul: [
        ["Install. ", "Use the Install app button (top bar, start page, or Settings). On iPhone and iPad choose Share → Add to Home Screen."],
        ["Offline. ", "Once AXON has loaded once, it opens without a connection. Choose your vault file (or your on-device copy) and read your messages, search, and explore your people and map."],
        ["What needs a connection. ", "Making sense of a message, tidying topic names and asking questions use an AI, so they pause when you're offline. A model running on your own computer (Ollama, LM Studio) still works."],
        ["Updates. ", "AXON refreshes itself quietly when you're online and tells you when a new version is ready."],
      ] },
      { note: "Installing only adds the app. Your messages still live in your vault file (and your on-device copy, if you choose one), never on a server." },
    ],
  },
  {
    id: "ai",
    title: "Connecting an AI",
    blocks: [
      { p: "AXON works with any AI provider. Pick one in Settings → AI connection." },
      { h: "Try it free" },
      { p: "Uses a shared Groq connection hosted with this site, so you can try everything straight away. It's rate-limited and meant for trying things out. Your message text passes through this site's relay on its way to Groq. It isn't stored or logged." },
      { h: "Use my own AI" },
      { p: "Your message goes directly from your browser to the provider you choose. It doesn't pass through our server at all." },
      { ul: [
        ["Groq, OpenAI, OpenRouter, Anthropic (Claude), Google Gemini: ", "create an API key in the provider's console (Settings has a link for each), paste it in, choose a model."],
        ["Ollama or LM Studio (runs on your own computer): ", "no key, and nothing leaves your machine. For Ollama, start it with OLLAMA_ORIGINS set to this site's address so the browser is allowed to talk to it."],
        ["Anything OpenAI-compatible: ", "choose “Other”, then enter its base URL (ending in /v1), model name and key."],
      ] },
      { note: "Your key stays in memory for this visit only. Tick “Remember my key inside my encrypted vault” if you'd rather not paste it each time — it's then stored in the encrypted file, never anywhere else." },
    ],
  },
  {
    id: "privacy",
    title: "Privacy and security",
    blocks: [
      { ul: [
        ["No account, no database, no cookies, no trackers. ", "This site stores nothing about you, and loads nothing from third parties. The only thing kept in your browser is the app's own code (so it works offline), plus an encrypted copy of your vault if you choose to switch that on."],
        ["Encrypted on your device. ", "AES-256-GCM, with a key derived from your passphrase (PBKDF2, 600,000 rounds). The saved file also detects tampering."],
        ["The AI only sees what you send it. ", "Just the message you ask about, a little context about that person, and the last few messages with them. Never your whole vault. Imported chats stay put until you ask about one."],
        ["Your provider's rules apply. ", "If you use your own provider, their privacy policy covers what they do with the text you send them. Local models (Ollama, LM Studio) send nothing out."],
        ["Be careful on shared computers. ", "Use “Close vault” when you're done; it clears everything from memory. Downloaded files stay in the Downloads folder until you move or delete them."],
      ] },
      { p: "AXON stores no private data on any server, so there's nothing for us to leak, sell, or hand over. The trade-off is that you're the keeper of your file and passphrase." },
    ],
  },
  {
    id: "help",
    title: "Troubleshooting",
    blocks: [
      { h: "“That passphrase doesn't open this vault”" },
      { p: "Check caps lock and spaces. If it still fails, the file may have been edited or damaged — try an older copy. Without the right passphrase there's no way in." },
      { h: "“Couldn't reach …” when making sense of a message" },
      { ul: [
        "Check your internet connection.",
        "Local models: make sure the app is running and allows requests from this site (for Ollama set OLLAMA_ORIGINS).",
        "Some company or school networks block AI services.",
      ] },
      { h: "“The provider rejected the key”" },
      { p: "Re-copy the key with no spaces, and check it has access to the model you chose. Use Settings → Test connection." },
      { h: "The free trial is missing or busy" },
      { p: "The site owner may not have switched it on, or it's busy. Wait a moment, or connect your own AI." },
      { h: "The tone looks wrong" },
      { p: "It can be. Add notes about the person (how you know them, how they usually write), which gives AXON better context. For anything important, ask the person." },
      { h: "My vault is getting big" },
      { p: "Importing very long chats makes the file bigger and the passphrase check slower. That's normal. Delete people you no longer need from the People page." },
    ],
  },
];
