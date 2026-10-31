/**
 * Evidence focus for the Console/Network drawers (T056).
 *
 * A verification result names the buffer entry behind a failing check. The
 * panel cannot render the drawers itself (they own polling and formatting), so
 * it hands the page a `DrawerFocus`; the page opens the matching drawer and
 * passes the same value down. `nonce` makes a repeated click on the same entry
 * observable — the drawers reveal once per nonce, not once per id.
 */
export interface DrawerFocus {
  readonly id: string
  readonly nonce: number
}

/** How long the revealed row stays highlighted. */
export const FOCUS_HIGHLIGHT_MS = 2000

/**
 * Finds the row for `id` without building a selector from page-derived data:
 * buffer ids are Host-generated, but the comparison stays literal either way.
 */
export function findEntryRow(
  list: HTMLElement | null | undefined,
  marker: string,
  id: string,
): HTMLElement | null {
  if (list === null || list === undefined) return null
  for (const row of Array.from(list.querySelectorAll<HTMLElement>(`[${marker}]`))) {
    if (row.getAttribute('data-entry-id') === id) return row
  }
  return null
}

/** jsdom has no layout, so `scrollIntoView` is absent there; tests skip it. */
export function revealEntry(row: HTMLElement): void {
  row.scrollIntoView?.({ block: 'center' })
}
