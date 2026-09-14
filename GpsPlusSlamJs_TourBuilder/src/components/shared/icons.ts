/**
 * Shared inline-SVG icon set for the authoring composition (onboarding gate,
 * waypoint card). No icon library is installed in this project, so these are
 * hand-authored: simple, geometric, stroke-only, `currentColor`-driven so
 * every caller sets color via CSS rather than editing the markup.
 */
export const ICONS = {
  cube: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4 8 L12 4 L20 8 L20 16 L12 20 L4 16 Z"/><path d="M4 8 L12 12 L20 8"/><path d="M12 12 L12 20"/></svg>',
  photo:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.4"/><path d="M21 15 L15 10 L10 14 L7 12 L3 15"/></svg>',
  audio:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 12 V12 M7 8 V16 M10 5 V19 M13 10 V14 M16 3 V21 M19 8 V16 M22 12 V12"/></svg>',
  text: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 6 H20 M4 12 H20 M4 18 H13"/></svg>',
  chevron:
    '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2 L9 6 L4 10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg width="13" height="13" viewBox="0 0 14 14"><path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  check:
    '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8 L6.5 11.5 L13 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  spinner:
    '<svg width="14" height="14" viewBox="0 0 16 16" class="icon-spin"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="10"/></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 21s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.3"/></svg>',
} as const;
