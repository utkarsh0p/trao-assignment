/**
 * The coverage check.
 *
 * Which requirements have no question against them? That is a set difference, so it is written
 * here and never asked of the model (RULES.md -> "Never let the model decide coverage").
 *
 * Step 5 of the pipeline feeds step 4: the must-have gaps this returns are what the next
 * generation pass is told to fill. A kit that ships with an uncovered must-have has failed at the
 * one job it had, so the must/nice split is part of the result rather than something the caller
 * has to recompute.
 *
 * Pure. No I/O. Imports nothing.
 */

/**
 * @param {{ requirements?: Array<{id: string, priority: 'must'|'nice'}>,
 *           questions?: Array<{id: string, requirement_ids?: string[]}> }} input
 * @returns {{
 *   uncovered_requirement_ids: string[],
 *   uncovered_must_ids: string[],
 *   uncovered_nice_ids: string[],
 *   covered_requirement_ids: string[],
 *   question_ids_by_requirement: Record<string, string[]>,
 *   complete: boolean
 * }}
 *
 * `uncovered_requirement_ids` is in requirement order, so it reads the same way the role does.
 * `complete` is about must-haves only — an uncovered "nice to have" is a fact worth reporting, not
 * a reason to spend another pass.
 */
export function checkCoverage({ requirements = [], questions = [] } = {}) {
  const questionIdsByRequirement = {};
  for (const requirement of requirements) {
    questionIdsByRequirement[requirement.id] = [];
  }

  for (const question of questions) {
    for (const requirementId of question.requirement_ids ?? []) {
      // A question pointing at a requirement that does not exist covers nothing. The schema
      // rejects that kit, but coverage runs on drafts that have not been validated yet.
      if (Object.hasOwn(questionIdsByRequirement, requirementId)) {
        const covering = questionIdsByRequirement[requirementId];
        if (!covering.includes(question.id)) covering.push(question.id);
      }
    }
  }

  const uncovered = [];
  const uncoveredMust = [];
  const uncoveredNice = [];
  const covered = [];

  for (const requirement of requirements) {
    if (questionIdsByRequirement[requirement.id].length > 0) {
      covered.push(requirement.id);
    } else {
      uncovered.push(requirement.id);
      if (requirement.priority === 'must') uncoveredMust.push(requirement.id);
      else uncoveredNice.push(requirement.id);
    }
  }

  return {
    uncovered_requirement_ids: uncovered,
    uncovered_must_ids: uncoveredMust,
    uncovered_nice_ids: uncoveredNice,
    covered_requirement_ids: covered,
    question_ids_by_requirement: questionIdsByRequirement,
    complete: uncoveredMust.length === 0,
  };
}

/** The requirement objects behind the must-have gaps — what a fill-the-gaps prompt needs. */
export function uncoveredMustRequirements({ requirements = [], questions = [] } = {}) {
  const gaps = new Set(checkCoverage({ requirements, questions }).uncovered_must_ids);
  return requirements.filter((requirement) => gaps.has(requirement.id));
}

export default checkCoverage;
