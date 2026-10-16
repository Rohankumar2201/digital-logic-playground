export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export const isTyping = (t: KeyTarget | null) =>
  !!t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName ?? '') || !!t.isContentEditable);

export const isControl = (t: KeyTarget | null) => ['BUTTON', 'A', 'SUMMARY'].includes(t?.tagName ?? '');
