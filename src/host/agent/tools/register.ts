/**
 * T047: registration glue for the four Vibe Studio tools.
 *
 * `createVibeToolDefinitions` turns the schemas in `definitions.ts` into
 * registry-ready definitions that are structurally compatible with DSH's
 * `ToolDefinition` (name/description/parameters/output/execute/timeoutMs).
 * Tool bodies arrive with T048/T049; a tool without a handler fails with a
 * stable `unsupported` code instead of silently returning empty data.
 *
 * Arguments are validated here because DSH only validates tools built through
 * its own `defineTool` helper; a hand-built definition must enforce its own
 * schema. Errors are normalized to {@link VibeToolError} so the model sees one
 * stable code prefix per failure.
 */
import { OBSERVE_BUDGET_BYTES, truncateUtf8 } from '../../../contracts/budget'
import { isStudioError, type StudioErrorCode } from '../../../contracts/errors'
import {
  VIBE_TOOL_SPECS,
  validateToolArguments,
  validateToolSpecs,
  type VibeToolName,
  type VibeToolSpec,
} from './definitions'

export interface VibeTextBlock {
  readonly type: 'text'
  readonly text: string
}

export type VibeToolContent = readonly VibeTextBlock[]

/** The subset of DSH's `ToolRunContext` a tool body may rely on. */
export interface VibeToolRunContext {
  readonly signal?: AbortSignal
  readonly agent?: unknown
}

/** Stable failure surfaced to the model as `code: detail`. */
export class VibeToolError extends Error {
  readonly code: StudioErrorCode
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: StudioErrorCode,
    detail: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(`${code}: ${detail}`)
    this.name = 'VibeToolError'
    this.code = code
    if (details) this.details = details
  }
}

/** Map anything a tool body may throw onto one stable tool error. */
export function asVibeToolError(error: unknown): VibeToolError {
  if (error instanceof VibeToolError) return error
  if (isStudioError(error)) return new VibeToolError(error.code, error.message, error.details)
  if (error instanceof Error && error.message) {
    return new VibeToolError('internal', error.message)
  }
  return new VibeToolError('internal', 'tool execution failed')
}

export interface VibeToolDefinition {
  readonly name: VibeToolName
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly output: {
    readonly schema: Readonly<Record<string, unknown>>
    readonly render: (args: unknown, value: unknown) => VibeToolContent
  }
  readonly timeoutMs?: number
  readonly execute: (args: unknown, exec: VibeToolRunContext) => Promise<unknown>
}

/** The subset of DSH's tool registry used for registration. */
export interface VibeToolRegistry {
  readonly register: (definition: VibeToolDefinition) => () => void
}

export type VibeToolHandler = (
  args: Readonly<Record<string, unknown>>,
  exec: VibeToolRunContext,
) => unknown | Promise<unknown>

export type VibeToolHandlers = Partial<Record<VibeToolName, VibeToolHandler>>

function stringifyToolValue(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? json : String(value)
  } catch {
    return '{"error":"unserializable tool result"}'
  }
}

/**
 * Default model-facing projection: compact JSON capped at the observe budget.
 * T048 replaces this with per-tool summaries; the cap stays either way.
 */
export function renderToolResult(value: unknown): VibeToolContent {
  return [{ type: 'text', text: truncateUtf8(stringifyToolValue(value), OBSERVE_BUDGET_BYTES) }]
}

function defineVibeTool(
  spec: VibeToolSpec,
  handler: VibeToolHandler | undefined,
): VibeToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: spec.outputSchema,
      render: (_args, value) => renderToolResult(value),
    },
    ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
    async execute(args, exec) {
      const violations = validateToolArguments(spec.parameters, args)
      if (violations.length > 0) {
        throw new VibeToolError('invalid_input', violations[0], { violations })
      }
      if (!handler) {
        throw new VibeToolError(
          'unsupported',
          `${spec.name} is not implemented in this build yet`,
        )
      }
      const record = args as Readonly<Record<string, unknown>>
      try {
        return await handler(record, exec)
      } catch (error) {
        throw asVibeToolError(error)
      }
    },
  }
}

/**
 * Build all four definitions. A malformed schema is a programming error, so it
 * fails here with `internal` rather than registering a tool the model cannot
 * call correctly.
 */
export function createVibeToolDefinitions(
  handlers: VibeToolHandlers = {},
): readonly VibeToolDefinition[] {
  const violations = validateToolSpecs()
  if (violations.length > 0) {
    throw new VibeToolError('internal', `invalid tool schema: ${violations[0]}`, {
      violations,
    })
  }
  return VIBE_TOOL_SPECS.map((spec) => defineVibeTool(spec, handlers[spec.name]))
}

/**
 * Register the four tools and return one idempotent disposer. T052 decides
 * which sessions see them; registration alone does not gate visibility.
 */
export function registerVibeTools(
  registry: VibeToolRegistry,
  handlers: VibeToolHandlers = {},
): () => void {
  const disposers = createVibeToolDefinitions(handlers).map((definition) =>
    registry.register(definition),
  )
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers.reverse()) dispose()
  }
}
