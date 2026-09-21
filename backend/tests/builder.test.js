import { describe, expect, it } from 'vitest';

import { KitSchema } from '../src/schema/kit.js';
import { JD, buildServer, createReadyKit, signIn } from './serverHelpers.js';

/** A ready kit, its id, and its current state. Every test in this file starts here. */
async function ready() {
  const server = buildServer();
  const agent = await signIn(server.app);
  const { id, ready: response } = await createReadyKit(agent, server);
  return { server, agent, id, kit: response.body.kit };
}

const scheduledIds = (kit) => kit.schedule.days.flatMap((day) => day.question_ids);

describe('editing', () => {
  it('marks an edited question as edited, and leaves the rest alone', async () => {
    const { agent, id, kit } = await ready();
    const target = kit.questions[0];

    const response = await agent
      .patch(`/kits/${id}/questions/${target.id}`)
      .send({ prompt: 'My own wording of this question.' });

    expect(response.status).toBe(200);
    const edited = response.body.kit.questions.find((question) => question.id === target.id);
    expect(edited.prompt).toBe('My own wording of this question.');
    expect(edited.origin).toBe('edited');
    expect(edited.answer_outline).toBe(target.answer_outline);

    const untouched = response.body.kit.questions.filter((question) => question.id !== target.id);
    expect(untouched.every((question) => question.origin === 'generated')).toBe(true);
  });

  it('moves a question between categories through the same edit', async () => {
    const { agent, id, kit } = await ready();
    const target = kit.questions.find((question) => question.category === 'technical');

    const response = await agent
      .patch(`/kits/${id}/questions/${target.id}`)
      .send({ category: 'company-fit' });

    const moved = response.body.kit.questions.find((question) => question.id === target.id);
    expect(moved.category).toBe('company-fit');
    expect(moved.prompt).toBe(target.prompt);
  });

  it('adds a hand-written question as pinned and puts it on a day', async () => {
    const { agent, id, kit } = await ready();

    const response = await agent.post(`/kits/${id}/questions`).send({
      prompt: 'How does the billing service handle refunds?',
      category: 'technical',
      requirement_ids: [kit.role.requirements[0].id],
    });

    expect(response.status).toBe(200);
    const added = response.body.kit.questions.at(-1);
    expect(added.id).toBe(`q${kit.questions.length + 1}`);
    expect(added.origin).toBe('pinned');
    expect(added.difficulty).toBe(2);
    expect(scheduledIds(response.body.kit)).toContain(added.id);
  });

  it('refuses a question aimed at a requirement that does not exist', async () => {
    const { agent, id } = await ready();

    const response = await agent
      .post(`/kits/${id}/questions`)
      .send({ prompt: 'Anything.', category: 'technical', requirement_ids: ['r99'] });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('r99');
  });

  it('takes a deleted question out of the schedule as well as the bank', async () => {
    const { agent, id, kit } = await ready();
    const target = kit.questions[0];
    expect(scheduledIds(kit)).toContain(target.id);

    const response = await agent.delete(`/kits/${id}/questions/${target.id}`);

    expect(response.status).toBe(200);
    expect(response.body.kit.questions.map((question) => question.id)).not.toContain(target.id);
    expect(scheduledIds(response.body.kit)).not.toContain(target.id);
    expect(KitSchema.safeParse(response.body.kit).success).toBe(true);
  });

  it('recomputes coverage when the last question for a requirement goes', async () => {
    const { agent, id, kit } = await ready();
    const requirement = kit.role.requirements[0];
    const covering = kit.questions.filter((question) =>
      question.requirement_ids.includes(requirement.id),
    );

    let body;
    for (const question of covering) {
      ({ body } = await agent.delete(`/kits/${id}/questions/${question.id}`));
    }

    expect(body.kit.coverage.uncovered_requirement_ids).toContain(requirement.id);
  });

  it('reorders a subset, leaving the questions not named where they were', async () => {
    const { agent, id, kit } = await ready();
    const technical = kit.questions.filter((question) => question.category === 'technical');
    if (technical.length < 2) return; // nothing to reorder in a one-question category

    const reversed = technical.map((question) => question.id).reverse();
    const response = await agent.post(`/kits/${id}/questions/reorder`).send({ ids: reversed });

    const after = response.body.kit.questions
      .filter((question) => question.category === 'technical')
      .map((question) => question.id);
    expect(after).toEqual(reversed);

    const others = response.body.kit.questions
      .filter((question) => question.category !== 'technical')
      .map((question) => question.id);
    const before = kit.questions
      .filter((question) => question.category !== 'technical')
      .map((question) => question.id);
    expect(others).toEqual(before);
  });

  it('refuses a reorder naming a question from another kit', async () => {
    const { agent, id } = await ready();

    const response = await agent.post(`/kits/${id}/questions/reorder`).send({ ids: ['q404'] });
    expect(response.status).toBe(404);
  });

  it('edits flashcards, adds pinned ones, and deletes them', async () => {
    const { agent, id, kit } = await ready();
    const card = kit.flashcards[0];

    const edited = await agent.patch(`/kits/${id}/flashcards/${card.id}`).send({ back: 'My answer.' });
    expect(edited.body.kit.flashcards[0].back).toBe('My answer.');
    expect(edited.body.kit.flashcards[0].origin).toBe('edited');

    const added = await agent
      .post(`/kits/${id}/flashcards`)
      .send({ front: 'What is idempotency?', back: 'Same request, same effect.' });
    const mine = added.body.kit.flashcards.at(-1);
    expect(mine.origin).toBe('pinned');

    const deleted = await agent.delete(`/kits/${id}/flashcards/${card.id}`);
    expect(deleted.body.kit.flashcards.map((item) => item.id)).not.toContain(card.id);
  });

  it('edits the brief and the role, keeping the role title in step with the source', async () => {
    const { agent, id } = await ready();

    const brief = await agent
      .patch(`/kits/${id}/brief`)
      .send({ summary: 'They sell billing infrastructure. I checked.' });
    expect(brief.body.kit.company_brief.summary).toBe('They sell billing infrastructure. I checked.');

    const role = await agent.patch(`/kits/${id}/role`).send({ title: 'Staff Backend Engineer' });
    expect(role.body.kit.role.title).toBe('Staff Backend Engineer');
    expect(role.body.kit.source.role).toBe('Staff Backend Engineer');
  });

  it('lets a day be rewritten, but not to a question that does not exist', async () => {
    const { agent, id, kit } = await ready();

    const good = await agent
      .patch(`/kits/${id}/schedule/days/1`)
      .send({ focus: 'Billing deep dive', question_ids: [kit.questions[0].id], minutes: 90 });
    expect(good.status).toBe(200);
    expect(good.body.kit.schedule.days[0]).toMatchObject({
      focus: 'Billing deep dive',
      minutes: 90,
      question_ids: [kit.questions[0].id],
    });

    const bad = await agent.patch(`/kits/${id}/schedule/days/1`).send({ question_ids: ['q404'] });
    expect(bad.status).toBe(400);

    const missingDay = await agent.patch(`/kits/${id}/schedule/days/99`).send({ focus: 'Nope' });
    expect(missingDay.status).toBe(404);
  });

  it('leaves a hand-edited day alone when an unrelated question changes', async () => {
    const { agent, id, kit } = await ready();
    await agent
      .patch(`/kits/${id}/schedule/days/2`)
      .send({ focus: 'My own plan', minutes: 45, question_ids: [] });

    const response = await agent
      .patch(`/kits/${id}/questions/${kit.questions[0].id}`)
      .send({ prompt: 'Reworded.' });

    const day = response.body.kit.schedule.days.find((entry) => entry.day === 2);
    expect(day).toMatchObject({ focus: 'My own plan', minutes: 45, question_ids: [] });
  });

  it('says a kit is still being generated rather than editing a half-built one', async () => {
    const server = buildServer();
    const agent = await signIn(server.app);
    const { id: userId } = await server.store.users.findByEmail('ada@example.com');

    // Written straight into the store so the job never starts: the fake model finishes a kit in
    // milliseconds, and a test that raced it would pass for the wrong reason.
    const record = await server.store.kits.create({
      userId,
      input: { jd: JD, company_url: 'https://acme.example/', days: 3 },
      idempotencyKey: 'still-running',
    });

    const response = await agent.patch(`/kits/${record.id}/brief`).send({ summary: 'Too early.' });

    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('still being generated');
  });

  it('rejects an empty patch rather than writing a no-op version', async () => {
    const { agent, id } = await ready();

    const response = await agent.patch(`/kits/${id}/brief`).send({});
    expect(response.status).toBe(400);
  });
});
