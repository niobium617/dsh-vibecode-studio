/**
 * T002 S2 host half: intentionally empty.
 *
 * Composer handoff is a client-side concern. This host entry exists only so
 * the spike can be installed as a DSH plugin package; it registers no routes
 * and holds no state.
 */
export const name = 'dsh-vibe-s2-spike'
export const inject: string[] = []

export function apply(): void {}
