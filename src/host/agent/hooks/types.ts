/**
 * Structural subsets of DSH's tool-pipeline hook types. This package does not
 * depend on `@deepseek-ai/dsh-tools`, and the hooks only need the fields they
 * read: `kind` to know whether a call was accepted, and (for pre-execute) the
 * deny shape. Every hook passes the real decision through unchanged, so these
 * narrow types never drop data at runtime.
 */

/** Enough of `tools/post-execute`'s decision to branch on `accept`. */
export type PostToolDecision =
  | { readonly kind: 'accept'; readonly [key: string]: unknown }
  | { readonly kind: 'block'; readonly feedback: readonly unknown[]; readonly [key: string]: unknown }

/** `tools/pre-execute` denial; `reason` is the model-facing text. */
export type PreToolDenyDecision = {
  readonly kind: 'deny'
  readonly reason: string
  /** Structured error identity, so policy failures stay routable like tool errors. */
  readonly info?: {
    readonly name: string
    readonly code: string
    readonly reason?: string
  }
}
