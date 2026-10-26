/**
 * Artifact references cross the host/client boundary; bytes and filesystem
 * paths stay on the host. The model receives only ids and summaries.
 */

export const ARTIFACT_KINDS = ['screenshot', 'capture', 'log', 'annotation', 'other'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export interface ArtifactRef {
  readonly id: string
  readonly kind: ArtifactKind
  readonly mimeType: string
  readonly bytes: number
  readonly createdAt: string
  readonly expiresAt?: string
  readonly label?: string
}
