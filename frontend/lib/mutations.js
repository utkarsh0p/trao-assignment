'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { del, patch, post } from './api.js';
import { kitKey, kitsKey } from './kits.js';
import { useToast } from '@/components/ui/Toast';

/**
 * Every edit endpoint answers with the whole recomputed kit, so success is
 * always the same thing: drop the new kit into the cache. There is no merge
 * logic anywhere, which is what keeps coverage and the schedule — both of
 * which the server recomputes on every edit — from going stale on screen.
 */
function useKitMutation(kitId, { request, optimistic, success }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = kitKey(kitId);

  return useMutation({
    mutationFn: (variables) => request(variables),

    onMutate: async (variables) => {
      if (!optimistic) return {};
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      if (previous?.kit) {
        queryClient.setQueryData(key, {
          ...previous,
          kit: optimistic(previous.kit, variables),
        });
      }
      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      const detail = error.detail?.[0];
      toast.error(detail ? `${error.message} ${detail.field}: ${detail.message}` : error.message);
    },

    onSuccess: (data, variables) => {
      queryClient.setQueryData(key, (current) =>
        current ? { ...current, kit: data.kit, error: null } : current,
      );
      queryClient.invalidateQueries({ queryKey: kitsKey });
      const message = typeof success === 'function' ? success(variables) : success;
      if (message) toast.success(message);
    },
  });
}

/* ── Origin ────────────────────────────────────────────────────────────────
   The server flips `generated` to `edited` and leaves `pinned` alone. The
   optimistic copy has to do the same or the border flickers on save. */
const originAfterEdit = (origin) => (origin === 'pinned' ? 'pinned' : 'edited');

const replaceById = (items, id, changes) =>
  items.map((item) =>
    item.id === id ? { ...item, ...changes, origin: originAfterEdit(item.origin) } : item,
  );

/** The server permutes only the named items among the slots they already hold. */
function permute(items, ids) {
  const slots = [];
  items.forEach((item, index) => {
    if (ids.includes(item.id)) slots.push(index);
  });
  const next = [...items];
  ids.forEach((id, i) => {
    const item = items.find((candidate) => candidate.id === id);
    if (item && slots[i] != null) next[slots[i]] = item;
  });
  return next;
}

export function useEditBrief(kitId) {
  return useKitMutation(kitId, {
    request: (fields) => patch(`/kits/${kitId}/brief`, fields),
    optimistic: (kit, fields) => ({
      ...kit,
      company_brief: { ...kit.company_brief, ...fields },
    }),
  });
}

export function useEditRole(kitId) {
  return useKitMutation(kitId, {
    request: (fields) => patch(`/kits/${kitId}/role`, fields),
    optimistic: (kit, fields) => ({
      ...kit,
      role: { ...kit.role, ...fields },
      source: fields.title ? { ...kit.source, role: fields.title } : kit.source,
    }),
  });
}

export function useEditQuestion(kitId) {
  return useKitMutation(kitId, {
    request: ({ id, ...fields }) => patch(`/kits/${kitId}/questions/${id}`, fields),
    optimistic: (kit, { id, ...fields }) => ({
      ...kit,
      questions: replaceById(kit.questions, id, fields),
    }),
  });
}

export function useAddQuestion(kitId) {
  return useKitMutation(kitId, {
    // No optimistic copy: the id is minted by the server, and inventing one
    // locally would let the schedule reference a question that never existed.
    request: (body) => post(`/kits/${kitId}/questions`, body),
    success: 'Question added.',
  });
}

export function useDeleteQuestion(kitId) {
  return useKitMutation(kitId, {
    request: (id) => del(`/kits/${kitId}/questions/${id}`),
    optimistic: (kit, id) => ({
      ...kit,
      questions: kit.questions.filter((question) => question.id !== id),
      schedule: {
        ...kit.schedule,
        days: kit.schedule.days.map((day) => ({
          ...day,
          question_ids: day.question_ids.filter((questionId) => questionId !== id),
        })),
      },
    }),
    success: 'Question deleted.',
  });
}

export function useReorderQuestions(kitId) {
  return useKitMutation(kitId, {
    request: (ids) => post(`/kits/${kitId}/questions/reorder`, { ids }),
    optimistic: (kit, ids) => ({ ...kit, questions: permute(kit.questions, ids) }),
  });
}

export function useEditFlashcard(kitId) {
  return useKitMutation(kitId, {
    request: ({ id, ...fields }) => patch(`/kits/${kitId}/flashcards/${id}`, fields),
    optimistic: (kit, { id, ...fields }) => ({
      ...kit,
      flashcards: replaceById(kit.flashcards, id, fields),
    }),
  });
}

export function useAddFlashcard(kitId) {
  return useKitMutation(kitId, {
    request: (body) => post(`/kits/${kitId}/flashcards`, body),
    success: 'Flashcard added.',
  });
}

export function useDeleteFlashcard(kitId) {
  return useKitMutation(kitId, {
    request: (id) => del(`/kits/${kitId}/flashcards/${id}`),
    optimistic: (kit, id) => ({
      ...kit,
      flashcards: kit.flashcards.filter((card) => card.id !== id),
    }),
    success: 'Flashcard deleted.',
  });
}

export function useReorderFlashcards(kitId) {
  return useKitMutation(kitId, {
    request: (ids) => post(`/kits/${kitId}/flashcards/reorder`, { ids }),
    optimistic: (kit, ids) => ({ ...kit, flashcards: permute(kit.flashcards, ids) }),
  });
}

export function useEditScheduleDay(kitId) {
  return useKitMutation(kitId, {
    request: ({ day, ...fields }) => patch(`/kits/${kitId}/schedule/days/${day}`, fields),
    optimistic: (kit, { day, ...fields }) => ({
      ...kit,
      schedule: {
        ...kit.schedule,
        days: kit.schedule.days.map((entry) =>
          entry.day === day ? { ...entry, ...fields } : entry,
        ),
      },
    }),
  });
}

/**
 * Regeneration answers 202 and runs in the background, so there is no kit to
 * put in the cache — the poll picks it up. Marking the record `regenerating`
 * here is what restarts that poll without waiting for the next tick.
 */
export function useRegenerate(kitId) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ section, category }) =>
      post(`/kits/${kitId}/regenerate`, category ? { section, category } : { section }),
    onSuccess: () => {
      queryClient.setQueryData(kitKey(kitId), (current) =>
        current ? { ...current, status: 'regenerating', error: null } : current,
      );
    },
    onError: (error) => toast.error(error.message),
  });
}
