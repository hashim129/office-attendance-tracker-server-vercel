/** Staff app look: Classic (default) or one of four themes, kept per device. */
export const UI_THEMES = [
  { id: 'classic', label: 'Classic', swatch: ['#2563eb', '#4f46e5', '#f1f5f9'] },
  { id: 'ocean', label: 'Ocean Breeze', swatch: ['#0d9488', '#0891b2', '#ecfeff'] },
  { id: 'sand', label: 'Desert Sand', swatch: ['#b8532c', '#d97706', '#faf6ef'] },
  { id: 'forest', label: 'Forest', swatch: ['#059669', '#0d9488', '#f3f6f4'] },
  { id: 'graphite', label: 'Graphite', swatch: ['#2f2f36', '#71717a', '#f4f4f5'] },
] as const;
export type UiThemeId = typeof UI_THEMES[number]['id'];
const KEY = 'office_ui_theme';
export function getUiTheme(): UiThemeId {
  try { const v = localStorage.getItem(KEY); return (UI_THEMES.some((t) => t.id === v) ? v : 'classic') as UiThemeId; } catch { return 'classic'; }
}
export function applyUiTheme(id: UiThemeId = getUiTheme()): void {
  const el = document.documentElement;
  if (id === 'classic') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', id);
}
export function setUiTheme(id: UiThemeId): void {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  applyUiTheme(id);
  window.dispatchEvent(new CustomEvent('office-ui-theme', { detail: id }));
}
