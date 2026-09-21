import { QUESTION_CATEGORIES } from './progress.js';

export { QUESTION_CATEGORIES };

/** Requirements keyed by id, for resolving the ids questions carry. */
export function requirementIndex(kit) {
  return new Map(kit.role.requirements.map((requirement) => [requirement.id, requirement]));
}

export function questionIndex(kit) {
  return new Map(kit.questions.map((question) => [question.id, question]));
}

/** Questions grouped into the four categories, in kit order. */
export function questionsByCategory(kit) {
  const groups = new Map(QUESTION_CATEGORIES.map((category) => [category, []]));
  for (const question of kit.questions) {
    if (!groups.has(question.category)) groups.set(question.category, []);
    groups.get(question.category).push(question);
  }
  return groups;
}

/**
 * The uncovered requirements, split by priority. An uncovered must-have is the
 * one failure the kit is not allowed to hide; an uncovered nice-to-have is
 * worth stating and nothing more.
 */
export function coverageGaps(kit) {
  const byId = requirementIndex(kit);
  const uncovered = kit.coverage.uncovered_requirement_ids
    .map((id) => byId.get(id))
    .filter(Boolean);

  return {
    must: uncovered.filter((requirement) => requirement.priority === 'must'),
    nice: uncovered.filter((requirement) => requirement.priority === 'nice'),
  };
}

export function isCovered(kit, requirementId) {
  return !kit.coverage.uncovered_requirement_ids.includes(requirementId);
}

/** How many items of each origin a section holds — what a regeneration will and will not touch. */
export function originCounts(items) {
  return items.reduce(
    (counts, item) => {
      counts[item.origin] = (counts[item.origin] || 0) + 1;
      return counts;
    },
    { generated: 0, edited: 0, pinned: 0 },
  );
}

export function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
