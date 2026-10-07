/**
 * sample.js — a pre-analysed example used by the guided tour, so people can see
 * exactly what AXON produces before they connect any AI. Marked `sample: true`
 * so it can be removed in one click.
 */

import { uid } from "./utils.js";

export const SAMPLE_PERSON_NAME = "Sam (sample)";

export function addSample(vault) {
  let person = vault.people.find((p) => p.sample);
  if (!person) {
    person = { id: uid(), name: SAMPLE_PERSON_NAME, category: "personal", relationship: "Friend", notes: "This is example data from the tour. You can delete it any time.", createdAt: new Date().toISOString(), sample: true };
    vault.people.push(person);
  }
  let msg = vault.messages.find((m) => m.sample && m.personId === person.id);
  if (!msg) {
    const ts = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    msg = {
      id: uid(),
      personId: person.id,
      direction: "in",
      source: "paste",
      ts,
      text: "Hey! No pressure at all, but are you free Saturday around 6? We're doing a small dinner at Priya's. Totally fine if you're wiped, just let me know either way by Thursday :)",
      status: "new",
      needsReply: true,
      sample: true,
      analysis: {
        summary: "Sam is inviting you to a small dinner at Priya's on Saturday around 6pm and wants a yes or no by Thursday.",
        plain_meaning: "Sam would like you to come to dinner on Saturday at about 6. Saying no is genuinely okay. They only need to know your answer by Thursday.",
        tone: { label: "friendly", confidence: "high", evidence: "“No pressure at all”, “Totally fine if you're wiped” and the smiley all signal a relaxed, low-stakes invitation." },
        pile: "social",
        needs_reply: true,
        reply_by: "this_week",
        asks: ["Say whether you can come on Saturday at about 6pm"],
        dates: ["Saturday around 6", "Thursday (answer by)"],
        reassurance: "Sam says directly that it's fine if you can't come, so a “no” is unlikely to upset them.",
        replies: [
          { style: "warm", text: "Thanks for inviting me, Sam! I'd love to come on Saturday. See you at Priya's around 6." },
          { style: "brief", text: "Yes, I'll be there Saturday at 6. Thanks!" },
          { style: "boundary", text: "Thank you for thinking of me! I'm going to sit this one out and rest. Have a lovely evening, and let's catch up soon." },
        ],
        at: new Date().toISOString(),
        sample: true,
      },
    };
    vault.messages.push(msg);
  }
  return { person, message: msg };
}

export function hasSample(vault) {
  return vault.people.some((p) => p.sample) || vault.messages.some((m) => m.sample);
}

export function removeSample(vault) {
  const ids = new Set(vault.people.filter((p) => p.sample).map((p) => p.id));
  vault.people = vault.people.filter((p) => !p.sample);
  vault.messages = vault.messages.filter((m) => !m.sample && !ids.has(m.personId));
  for (const id of ids) delete vault.summaries[id];
}
