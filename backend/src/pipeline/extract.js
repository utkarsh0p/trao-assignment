/**
 * Step 1 — the job description becomes requirements.
 *
 * The model reads the posting; this module decides what is kept. Ids are assigned here, in code,
 * because every later step depends on them being stable and unique — coverage is only checkable
 * because `r3` means the same thing in the question bank as it does in the role.
 *
 * "Never invent" is enforced twice: the prompt says so, and a thin posting that yields few
 * requirements is recorded as thin rather than topped up.
 */
import { z } from 'zod';
import { requestJson } from '../llm/index.js';
import { EXTRACT_SYSTEM, extractUser } from '../llm/prompts.js';
import { looseString, stringArray } from '../llm/shapes.js';
import { REQUIREMENT_KINDS, REQUIREMENT_PRIORITIES } from '../schema/kit.js';

/** What the model is asked for. Its ids, if it invents any, are discarded. */
const ExtractReplySchema = z.object({
  title: looseString.default(''),
  seniority: looseString.default(''),
  location: looseString.default(''),
  // A model asked for an array will sometimes send one string, or "" for none. Both are
  // unambiguous, and neither is worth losing a kit over.
  responsibilities: stringArray.default([]),
  requirements: z
    .array(
      z.object({
        text: z.string().min(1),
        kind: z.enum(REQUIREMENT_KINDS).catch('technical'),
        priority: z.enum(REQUIREMENT_PRIORITIES).catch('must'),
      }),
    )
    .default([]),
});

/** A posting shorter than this is a stub, and the kit says so rather than padding it out. */
export const THIN_JD_CHARS = 400;

/** Beyond this the posting is being listed, not described; the tail adds noise, not signal. */
export const MAX_REQUIREMENTS = 40;

const normalise = (text) => text.trim().replace(/\s+/g, ' ');

export async function extractRequirements({ jd, client }) {
  const reply = await requestJson(client, {
    purpose: 'extract-requirements',
    system: EXTRACT_SYSTEM,
    user: extractUser(jd),
    schema: ExtractReplySchema,
    maxTokens: 1500,
  });

  const seen = new Set();
  const requirements = [];
  for (const requirement of reply.requirements) {
    const text = normalise(requirement.text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      id: `r${requirements.length + 1}`,
      text,
      kind: requirement.kind,
      priority: requirement.priority,
    });
    if (requirements.length === MAX_REQUIREMENTS) break;
  }

  const notes = [];
  if (requirements.length === 0) {
    notes.push(
      'No requirements could be taken from the job description. The questions below come from the role title alone.',
    );
  } else if (jd.length < THIN_JD_CHARS) {
    notes.push(
      `The job description is short (${jd.length} characters), so this kit is thin: ${requirements.length} requirement${requirements.length === 1 ? '' : 's'} could be taken from it, and nothing has been added beyond what it states.`,
    );
  }

  return {
    role: {
      title: normalise(reply.title),
      seniority: normalise(reply.seniority),
      responsibilities: reply.responsibilities.map(normalise).filter(Boolean),
      requirements,
    },
    location: normalise(reply.location),
    notes,
  };
}

export default extractRequirements;
