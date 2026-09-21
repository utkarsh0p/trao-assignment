import { describe, expect, it } from 'vitest';
import { checkCoverage, uncoveredMustRequirements } from '../src/pipeline/coverage.js';
import { makeQuestion, makeRequirement } from './factories.js';

const requirements = [
  makeRequirement('r1', { priority: 'must' }),
  makeRequirement('r2', { priority: 'must' }),
  makeRequirement('r3', { priority: 'nice' }),
];

describe('checkCoverage', () => {
  it('reports nothing uncovered when every requirement has a question', () => {
    const questions = [
      makeQuestion('q1', { requirement_ids: ['r1', 'r3'] }),
      makeQuestion('q2', { requirement_ids: ['r2'] }),
    ];
    const coverage = checkCoverage({ requirements, questions });

    expect(coverage.uncovered_requirement_ids).toEqual([]);
    expect(coverage.covered_requirement_ids).toEqual(['r1', 'r2', 'r3']);
    expect(coverage.complete).toBe(true);
  });

  it('reports partial coverage in requirement order, split by priority', () => {
    const questions = [makeQuestion('q1', { requirement_ids: ['r1'] })];
    const coverage = checkCoverage({ requirements, questions });

    expect(coverage.uncovered_requirement_ids).toEqual(['r2', 'r3']);
    expect(coverage.uncovered_must_ids).toEqual(['r2']);
    expect(coverage.uncovered_nice_ids).toEqual(['r3']);
    expect(coverage.complete).toBe(false);
  });

  it('reports everything uncovered when there are no questions at all', () => {
    const coverage = checkCoverage({ requirements, questions: [] });

    expect(coverage.uncovered_requirement_ids).toEqual(['r1', 'r2', 'r3']);
    expect(coverage.covered_requirement_ids).toEqual([]);
    expect(coverage.complete).toBe(false);
  });

  it('is complete when only a nice-to-have is uncovered', () => {
    const questions = [makeQuestion('q1', { requirement_ids: ['r1', 'r2'] })];
    const coverage = checkCoverage({ requirements, questions });

    expect(coverage.uncovered_requirement_ids).toEqual(['r3']);
    expect(coverage.complete).toBe(true);
  });

  it('is not complete when only a must-have is uncovered', () => {
    const questions = [makeQuestion('q1', { requirement_ids: ['r1', 'r3'] })];
    const coverage = checkCoverage({ requirements, questions });

    expect(coverage.uncovered_must_ids).toEqual(['r2']);
    expect(coverage.complete).toBe(false);
  });

  it('maps each requirement to the questions covering it, without duplicates', () => {
    const questions = [
      makeQuestion('q1', { requirement_ids: ['r1', 'r1'] }),
      makeQuestion('q2', { requirement_ids: ['r1'] }),
    ];
    const coverage = checkCoverage({ requirements, questions });

    expect(coverage.question_ids_by_requirement.r1).toEqual(['q1', 'q2']);
    expect(coverage.question_ids_by_requirement.r2).toEqual([]);
  });

  it('ignores a question pointing at a requirement that does not exist', () => {
    const questions = [makeQuestion('q1', { requirement_ids: ['r9'] })];
    const coverage = checkCoverage({ requirements, questions });

    expect(coverage.covered_requirement_ids).toEqual([]);
    expect(coverage.question_ids_by_requirement.r9).toBeUndefined();
  });

  it('treats a question with no requirement_ids as covering nothing', () => {
    const coverage = checkCoverage({ requirements, questions: [makeQuestion('q1')] });
    expect(coverage.uncovered_requirement_ids).toEqual(['r1', 'r2', 'r3']);
  });

  it('handles a kit with no requirements at all', () => {
    const coverage = checkCoverage({ requirements: [], questions: [makeQuestion('q1')] });

    expect(coverage.uncovered_requirement_ids).toEqual([]);
    expect(coverage.complete).toBe(true);
  });

  it('does not mutate its input', () => {
    const questions = [makeQuestion('q1', { requirement_ids: ['r1'] })];
    const before = structuredClone({ requirements, questions });
    checkCoverage({ requirements, questions });

    expect({ requirements, questions }).toEqual(before);
  });
});

describe('uncoveredMustRequirements', () => {
  it('returns the requirement objects the next generation pass has to fill', () => {
    const questions = [makeQuestion('q1', { requirement_ids: ['r1'] })];
    const gaps = uncoveredMustRequirements({ requirements, questions });

    expect(gaps.map((requirement) => requirement.id)).toEqual(['r2']);
    expect(gaps[0].text).toBe('Requirement r2');
  });
});
