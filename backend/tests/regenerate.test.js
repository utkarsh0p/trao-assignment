import { describe, expect, it } from 'vitest';

import { KitSchema } from '../src/schema/kit.js';
import { createFakeClient } from '../src/llm/fake.js';
import { buildServer, createReadyKit, signIn } from './serverHelpers.js';

async function ready(options) {
  const server = buildServer(options);
  const agent = await signIn(server.app);
  const { id, ready: response } = await createReadyKit(agent, server);
  return { server, agent, id, kit: response.body.kit };
}

/** Posts a regeneration and waits for the background job, returning the kit afterwards. */
async function regenerate(agent, server, id, body) {
  const accepted = await agent.post(`/kits/${id}/regenerate`).send(body);
  await server.settle();
  const after = await agent.get(`/kits/${id}`);
  return { accepted, record: after.body, kit: after.body.kit };
}

describe('regenerating a section', () => {
  it('replaces the generated questions in one category and keeps everything else', async () => {
    const { server, agent, id, kit } = await ready();

    // One question edited, one written by hand — the two things a regeneration must not destroy.
    const edited = kit.questions.find((question) => question.category === 'technical');
    await agent
      .patch(`/kits/${id}/questions/${edited.id}`)
      .send({ prompt: 'My own technical question.' });
    const added = await agent
      .post(`/kits/${id}/questions`)
      .send({ prompt: 'Mine too.', category: 'technical', requirement_ids: ['r1'] });
    const pinnedId = added.body.kit.questions.at(-1).id;

    const otherCategories = added.body.kit.questions
      .filter((question) => question.category !== 'technical')
      .map((question) => `${question.id}:${question.prompt}`);

    const { accepted, kit: after } = await regenerate(agent, server, id, {
      section: 'questions',
      category: 'technical',
    });

    expect(accepted.status).toBe(202);
    expect(accepted.body.status).toBe('regenerating');

    // The edit and the hand-written question survive, ids and text intact.
    const survivors = after.questions.filter((question) =>
      [edited.id, pinnedId].includes(question.id),
    );
    expect(survivors).toHaveLength(2);
    expect(survivors.find((q) => q.id === edited.id)).toMatchObject({
      prompt: 'My own technical question.',
      origin: 'edited',
    });
    expect(survivors.find((q) => q.id === pinnedId)).toMatchObject({
      prompt: 'Mine too.',
      origin: 'pinned',
    });

    // The other three categories were not touched at all.
    expect(
      after.questions
        .filter((question) => question.category !== 'technical')
        .map((question) => `${question.id}:${question.prompt}`),
    ).toEqual(otherCategories);

    // And the replacements are new questions with new ids, not recycled ones.
    const fresh = after.questions.filter((question) => question.origin === 'generated' && question.category === 'technical');
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((question) => Number(question.id.slice(1)) > kit.questions.length)).toBe(true);
    expect(KitSchema.safeParse(after).success).toBe(true);
  });

  it('puts the regenerated questions on the schedule and leaves coverage correct', async () => {
    const { server, agent, id } = await ready();
    const { kit } = await regenerate(agent, server, id, { section: 'questions' });

    const scheduled = new Set(kit.schedule.days.flatMap((day) => day.question_ids));
    for (const question of kit.questions) expect(scheduled.has(question.id)).toBe(true);

    const musts = kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id);
    for (const id of musts) expect(kit.coverage.uncovered_requirement_ids).not.toContain(id);
  });

  it('keeps pinned flashcards and replaces the generated ones', async () => {
    const { server, agent, id, kit } = await ready();

    const added = await agent
      .post(`/kits/${id}/flashcards`)
      .send({ front: 'My card', back: 'My answer' });
    const pinnedId = added.body.kit.flashcards.at(-1).id;

    const { kit: after } = await regenerate(agent, server, id, { section: 'flashcards' });

    expect(after.flashcards.find((card) => card.id === pinnedId)).toMatchObject({
      front: 'My card',
      origin: 'pinned',
    });
    // No id is reused, so a practice record still refers to the card it was made against.
    const oldIds = kit.flashcards.map((card) => card.id).filter((cardId) => cardId !== pinnedId);
    const regenerated = after.flashcards.filter((card) => card.origin === 'generated');
    expect(regenerated.every((card) => !oldIds.includes(card.id))).toBe(true);
  });

  it('rebuilds the schedule without asking the model anything', async () => {
    const { server, agent, id } = await ready();
    await agent.patch(`/kits/${id}/schedule/days/1`).send({ focus: 'Whatever I felt like' });

    const callsBefore = server.client.calls.length;
    const { kit } = await regenerate(agent, server, id, { section: 'schedule' });

    expect(server.client.calls).toHaveLength(callsBefore);
    expect(kit.schedule.days[0].focus).not.toBe('Whatever I felt like');
    expect(kit.schedule.days).toHaveLength(3);
  });

  it('reads the site again when the brief is regenerated', async () => {
    let visits = 0;
    const research = async () => {
      visits += 1;
      return {
        status: 'ok',
        links_considered: 4,
        company: 'Acme',
        pages: [{ url: `https://acme.example/visit-${visits}`, title: 'Acme', text: 'Billing.' }],
        notes: [],
      };
    };

    const { server, agent, id } = await ready({ research });
    const { kit } = await regenerate(agent, server, id, { section: 'brief' });

    expect(visits).toBe(2);
    expect(kit.source.pages_used).toEqual(['https://acme.example/visit-2']);
    expect(kit.company_brief.sources).toEqual(['https://acme.example/visit-2']);
  });

  it('reports a failed regeneration without damaging the kit it started from', async () => {
    let allowed = true;
    const client = createFakeClient({
      fail: (call) =>
        !allowed && call.purpose.startsWith('questions:')
          ? Object.assign(new Error('the model did not answer'), { name: 'LlmOutputError' })
          : undefined,
    });

    const { server, agent, id, kit } = await ready({ client });
    allowed = false;

    const { record } = await regenerate(agent, server, id, { section: 'questions' });

    // The kit is still ready and still the one the user had; what failed was the attempt.
    expect(record.status).toBe('ready');
    expect(record.kit.questions).toEqual(kit.questions);
    expect(record.error.code).toBe('GENERATION_FAILED');
  });

  it('refuses to regenerate a kit that is already being worked on', async () => {
    const { server, agent, id } = await ready();

    await server.store.kits.update({ id, patch: { status: 'regenerating' } });
    const response = await agent.post(`/kits/${id}/regenerate`).send({ section: 'flashcards' });

    expect(response.status).toBe(409);
  });

  it('rejects a section that does not exist', async () => {
    const { agent, id } = await ready();

    const response = await agent.post(`/kits/${id}/regenerate`).send({ section: 'everything' });
    expect(response.status).toBe(400);
  });
});
