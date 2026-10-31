/**
 * T050: the `/vibe` human command — status plus one next step.
 *
 * The Host mirrors DSH's `commands` registry structurally instead of importing
 * `@deepseek-ai/dsh-commands`: this package ships without that dependency and
 * DSH resolves plugin imports from the plugin itself.
 *
 * The handler reuses the `vibe_status` tool handler, so the human command and
 * the model tool can never disagree about the preview state. Nothing here
 * starts, stops, navigates or captures a preview: every suggestion names an
 * action the user or the agent still has to take, and the whole reply stays
 * inside the 2 KB budget.
 */
import { truncateUtf8 } from '../../../contracts/budget'
import {
  describePreviewError,
  type ToolPreviewState,
} from '../tools/preview-data'
import {
  createStatusHandler,
  type StatusToolDeps,
  type StatusToolOutput,
} from '../tools/status'

export const VIBE_COMMAND_NAME = 'vibe'
/** `/vibe` is a glance, not a report: the reply never exceeds 2 KB. */
export const VIBE_COMMAND_BUDGET_BYTES = 2 * 1024
export const VIBE_COMMAND_USAGE = '用法：/vibe（不接受参数）'

const URL_DISPLAY_CHARS = 200

/** What one invocation hands the handler; the rest of DSH's fields are unused. */
export interface VibeCommandInvocation {
  /** Exact text after the command name, including any separator whitespace. */
  readonly rawInput: string
  readonly signal?: AbortSignal
}

export type VibeCommandResult =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** The subset of DSH's command definition this command fills in. */
export interface VibeCommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint?: string }
  readonly recordInput?: boolean
  readonly handler: (
    invocation: VibeCommandInvocation,
  ) => VibeCommandResult | Promise<VibeCommandResult>
}

/** The subset of DSH's command registry used for registration. */
export interface VibeCommandRegistry {
  readonly register: (definition: VibeCommandDefinition) => () => void
}

/** Same read-only sources the `vibe_status` tool uses. */
export type VibeCommandDeps = StatusToolDeps

export type VibeCommandHandler = (
  invocation: VibeCommandInvocation,
) => Promise<VibeCommandResult>

const STATE_LABELS: Readonly<Record<ToolPreviewState, string>> = {
  ready: '已就绪',
  starting: '启动中',
  degraded: '已降级',
  failed: '启动失败',
  closed: '未启动',
}

function clipUrl(url: string): string {
  return url.length <= URL_DISPLAY_CHARS ? url : `${url.slice(0, URL_DISPLAY_CHARS)}…`
}

function previewLine(status: StatusToolOutput): string {
  const label = STATE_LABELS[status.preview.state]
  const fps = status.preview.state === 'ready' ? ` · ${status.preview.fps} fps` : ''
  // T053: the hint shares the status line instead of adding a fourth line.
  const stale = status.stale ? ' · 可能过期（文件已改动）' : ''
  const url = status.target?.url
  return url ? `预览：${label}${fps}${stale} · ${clipUrl(url)}` : `预览：${label}${fps}${stale}`
}

function countsLine(status: StatusToolOutput): string {
  return (
    `控制台错误 ${status.consoleErrors} · 网络失败 ${status.networkFailures}` +
    ` · 已保存标注 ${status.annotations.saved}`
  )
}

/**
 * One suggestion, aimed at a beginner who may not know the tool names: the
 * first problem found wins, because fixing it is what changes the next reply.
 */
export function suggestNextStep(status: StatusToolOutput): string {
  switch (status.preview.state) {
    case 'failed':
      return '下一步：在右栏 Vibe Studio 面板点「重启预览」；若仍失败，让 agent 调用 vibe_status 查看错误码。'
    case 'closed':
      return '下一步：在右栏 Vibe Studio 面板点「启动预览」，或让 agent 调用 vibe_preview start（会先请求你确认）。'
    case 'starting':
      return '下一步：等预览启动完成后再运行 /vibe；若长时间无响应，在面板里重启。'
    default:
      break
  }
  if (status.stale) {
    return '下一步：文件改动后预览还是旧页面，先在面板里点「更多 → 刷新」重载，再看报错是否还在。'
  }
  if (status.consoleErrors > 0) {
    return '下一步：让 agent 调用 vibe_observe（include 设为 ["console"]）查看报错。'
  }
  if (status.networkFailures > 0) {
    return '下一步：让 agent 调用 vibe_observe（include 设为 ["network"]）查看失败请求。'
  }
  if (status.annotations.saved > 0) {
    return '下一步：让 agent 用 vibe_annotation_get 打开一条已保存标注（需要标注 id）。'
  }
  return '下一步：在预览里点选元素写标注，或让 agent 调用 vibe_observe 读取页面。'
}

/** The exact reply text; exported so tests can assert on it directly. */
export function renderVibeStatus(status: StatusToolOutput): string {
  return [previewLine(status), countsLine(status), suggestNextStep(status)].join('\n')
}

function success(text: string): VibeCommandResult {
  return { kind: 'success', text: truncateUtf8(text, VIBE_COMMAND_BUDGET_BYTES) }
}

function failure(text: string): VibeCommandResult {
  return { kind: 'error', text: truncateUtf8(text, VIBE_COMMAND_BUDGET_BYTES) }
}

/**
 * `/vibe` takes no arguments today: a stray argument is answered with the
 * usage line instead of being ignored, so a half-typed subcommand never looks
 * like it did something.
 */
export function createVibeCommandHandler(deps: VibeCommandDeps): VibeCommandHandler {
  const readStatus = createStatusHandler(deps)
  return async (invocation: VibeCommandInvocation): Promise<VibeCommandResult> => {
    if (invocation.rawInput.trim() !== '') return failure(VIBE_COMMAND_USAGE)
    try {
      return success(renderVibeStatus(await readStatus({}, { signal: invocation.signal })))
    } catch (error) {
      return failure(`无法读取 Vibe Studio 状态（${describePreviewError(error)}）。`)
    }
  }
}

export function createVibeCommand(deps: VibeCommandDeps): VibeCommandDefinition {
  return {
    name: VIBE_COMMAND_NAME,
    description: '查看 Vibe Studio 预览状态和下一步建议',
    recordInput: false,
    handler: createVibeCommandHandler(deps),
  }
}

/** Register `/vibe`; the returned disposer removes exactly this definition. */
export function registerVibeCommand(
  registry: VibeCommandRegistry,
  deps: VibeCommandDeps,
): () => void {
  return registry.register(createVibeCommand(deps))
}
