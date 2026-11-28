// Phones: tables marked "phone-cards" are shown as stacked cards (see index.css).
// Each cell gets its column name from the table header, so nothing needs to change in the pages themselves.
export function startPhoneTables() {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return;
  let queued = false;
  const label = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('table.phone-cards').forEach((table) => {
      const heads = Array.from(table.querySelectorAll('thead tr:last-child th')).map((th) => (th.textContent || '').trim());
      table.querySelectorAll<HTMLTableRowElement>('tbody tr, tfoot tr').forEach((tr) => {
        let col = 0;
        Array.from(tr.children).forEach((cell) => {
          const td = cell as HTMLTableCellElement;
          if (!td.hasAttribute('data-label')) td.setAttribute('data-label', td.colSpan > 1 ? '' : heads[col] || '');
          col += td.colSpan || 1;
        });
      });
    });
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(label); } };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  queue();
}
