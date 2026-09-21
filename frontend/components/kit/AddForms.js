'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { CATEGORY_LABEL } from '@/components/ui/Chip';
import { QUESTION_CATEGORIES } from '@/lib/kit';

/** Requirement ids are picked from the kit — never typed, so they always resolve. */
function RequirementPicker({ requirements, selected, onChange }) {
  if (requirements.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-text">Covers (optional)</legend>
      <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
        {requirements.map((requirement) => (
          <label
            key={requirement.id}
            className="flex cursor-pointer items-start gap-2 rounded-lg p-2 text-[15px] leading-relaxed hover:bg-bg-subtle"
          >
            <input
              type="checkbox"
              className="mt-1 accent-accent"
              checked={selected.includes(requirement.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, requirement.id]
                    : selected.filter((id) => id !== requirement.id),
                )
              }
            />
            <span className="font-mono text-xs text-text-muted">{requirement.id}</span>
            <span className="min-w-0 flex-1 text-text">{requirement.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AddQuestionModal({ open, onClose, kit, onSubmit, pending, defaultCategory }) {
  const [prompt, setPrompt] = useState('');
  const [outline, setOutline] = useState('');
  const [category, setCategory] = useState(defaultCategory || 'technical');
  const [difficulty, setDifficulty] = useState('2');
  const [requirementIds, setRequirementIds] = useState([]);

  function reset() {
    setPrompt('');
    setOutline('');
    setDifficulty('2');
    setRequirementIds([]);
  }

  function submit(event) {
    event.preventDefault();
    if (!prompt.trim()) return;
    onSubmit(
      {
        prompt: prompt.trim(),
        answer_outline: outline.trim(),
        category,
        difficulty: Number(difficulty),
        requirement_ids: requirementIds,
      },
      () => {
        reset();
        onClose();
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a question"
      description="Questions you write are kept through every regeneration."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            Add question
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Textarea
          label="Question"
          rows={3}
          maxLength={2000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          required
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {QUESTION_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABEL[value]}
              </option>
            ))}
          </Select>
          <Select
            label="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="1">1 — warm-up</option>
            <option value="2">2 — standard</option>
            <option value="3">3 — hard</option>
          </Select>
        </div>
        <Textarea
          label="Answer outline"
          rows={4}
          maxLength={6000}
          value={outline}
          onChange={(event) => setOutline(event.target.value)}
          hint="Optional."
        />
        <RequirementPicker
          requirements={kit.role.requirements}
          selected={requirementIds}
          onChange={setRequirementIds}
        />
      </form>
    </Modal>
  );
}

export function AddFlashcardModal({ open, onClose, kit, onSubmit, pending }) {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [requirementIds, setRequirementIds] = useState([]);

  function submit(event) {
    event.preventDefault();
    if (!front.trim()) return;
    onSubmit(
      { front: front.trim(), back: back.trim(), requirement_ids: requirementIds },
      () => {
        setFront('');
        setBack('');
        setRequirementIds([]);
        onClose();
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a flashcard"
      description="Cards you write are kept through every regeneration."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            Add card
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Front"
          maxLength={1000}
          value={front}
          onChange={(event) => setFront(event.target.value)}
          required
        />
        <Textarea
          label="Back"
          rows={4}
          maxLength={4000}
          value={back}
          onChange={(event) => setBack(event.target.value)}
        />
        <RequirementPicker
          requirements={kit.role.requirements}
          selected={requirementIds}
          onChange={setRequirementIds}
        />
      </form>
    </Modal>
  );
}
