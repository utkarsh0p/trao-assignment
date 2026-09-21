/** Join class names, dropping anything falsy. */
export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}
