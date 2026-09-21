'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import { PencilIcon } from '@/components/ui/icons';

/**
 * Click (or Enter on the keyboard) to edit in place. Escape cancels, blur
 * saves, ⌘/Ctrl-Enter saves from inside a textarea.
 *
 * Saving an unchanged value is skipped — the server would flip `origin` to
 * `edited` for it, and a stray click should not change what a regeneration
 * will keep.
 */
export default function InlineEdit({
  value,
  onSave,
  label,
  multiline = false,
  maxLength,
  placeholder = 'Empty',
  className,
  inputClassName,
  rows = 4,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const node = ref.current;
    node?.focus();
    node?.setSelectionRange?.(node.value.length, node.value.length);
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? '').trim()) onSave(next);
    else setDraft(value ?? '');
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelled.current = true;
      setDraft(value ?? '');
      setEditing(false);
      return;
    }
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  }

  if (editing) {
    const Tag = multiline ? 'textarea' : 'input';
    return (
      <Tag
        ref={ref}
        aria-label={label}
        value={draft}
        rows={multiline ? rows : undefined}
        maxLength={maxLength}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          commit();
        }}
        className={cx(
          'w-full rounded-lg border border-accent bg-surface px-2 py-1 text-[15px] leading-relaxed text-text',
          multiline && 'resize-y',
          inputClassName,
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${label}`}
      className={cx(
        'group -mx-2 flex w-full items-start gap-1.5 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-bg-subtle',
        className,
      )}
    >
      <span className={cx('min-w-0 flex-1 whitespace-pre-wrap', !value && 'text-text-faint')}>
        {value || placeholder}
      </span>
      <PencilIcon className="mt-1 h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
