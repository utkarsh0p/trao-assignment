'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripIcon } from '@/components/ui/icons';

/**
 * A drag handle that is also a keyboard control. @dnd-kit gives reordering to
 * the keyboard for free — Tab to the handle, Space to lift, arrows to move,
 * Space to drop — and DESIGN.md says plainly not to break it, so the sensors
 * and the handle's own focusability are load-bearing.
 */
function Handle({ attributes, listeners, label }) {
  return (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      className="cursor-grab touch-none rounded-lg p-1 text-text-faint transition-colors duration-150 hover:bg-bg-subtle hover:text-text-muted active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripIcon />
    </button>
  );
}

function SortableItem({ id, label, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10' : undefined}
    >
      {children({
        dragging: isDragging,
        handle: <Handle attributes={attributes} listeners={listeners} label={label} />,
      })}
    </li>
  );
}

/**
 * @param {object}   props
 * @param {Array}    props.items     objects with an `id`
 * @param {Function} props.onReorder called with the new id order
 * @param {Function} props.children  render prop: (item, {dragging, handle}) => node
 */
export default function SortableList({ items, onReorder, label = 'item', children, className }) {
  const sensors = useSensors(
    // A short distance so a click on the handle is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = items.map((item) => item.id);

  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id} label={label}>
              {(state) => children(item, state)}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
