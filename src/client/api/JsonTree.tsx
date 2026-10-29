/**
 * Collapsible JSON tree, rich response tier (T040).
 *
 * The model is built with a node budget and a depth cap so a large response
 * costs a bounded amount of work; anything cut off is reported instead of
 * silently dropped. Values render as React text nodes only — response bodies
 * are untrusted, so nothing here uses `dangerouslySetInnerHTML`.
 */
import * as React from 'react'
import { createTranslator, type Locale } from '../i18n'

/** Maximum nodes rendered; deeper/larger trees are truncated with a note. */
export const JSON_TREE_MAX_NODES = 2000
/** Maximum nesting depth expanded into the model. */
export const JSON_TREE_MAX_DEPTH = 16
/** Containers deeper than this start collapsed. */
export const JSON_TREE_INITIAL_DEPTH = 2

export interface JsonContainer {
  readonly kind: 'object' | 'array'
  readonly size: number
  readonly children: readonly JsonChild[]
  readonly omitted: number
  readonly deep: boolean
}

export type JsonScalar =
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'null' }

export type JsonNode = JsonContainer | JsonScalar

// A discriminant union over both literals cannot narrow the container away with
// `!== 'object' && !== 'array'`, so use an explicit guard.
function isContainer(node: JsonNode): node is JsonContainer {
  return node.kind === 'object' || node.kind === 'array'
}

export interface JsonChild {
  readonly key: string | null
  readonly node: JsonNode
}

export interface JsonTreeModel {
  readonly root: JsonNode
  readonly nodes: number
  readonly truncated: boolean
  readonly depthLimited: boolean
}

export interface BuildJsonTreeOptions {
  readonly maxNodes?: number
  readonly maxDepth?: number
}

export function buildJsonTree(value: unknown, options: BuildJsonTreeOptions = {}): JsonTreeModel {
  const maxNodes = Math.max(1, options.maxNodes ?? JSON_TREE_MAX_NODES)
  const maxDepth = Math.max(0, options.maxDepth ?? JSON_TREE_MAX_DEPTH)
  let nodes = 0
  let truncated = false
  let depthLimited = false

  const build = (current: unknown, depth: number): JsonNode => {
    nodes += 1
    if (current === null) return { kind: 'null' }
    if (typeof current === 'string') return { kind: 'string', value: current }
    if (typeof current === 'number') return { kind: 'number', value: String(current) }
    if (typeof current === 'boolean') return { kind: 'boolean', value: current }
    const isArray = Array.isArray(current)
    const entries: readonly (readonly [string | null, unknown])[] = isArray
      ? (current as readonly unknown[]).map((item) => [null, item] as const)
      : Object.entries(current as Record<string, unknown>)
    const size = entries.length
    const kind = isArray ? 'array' : 'object'
    if (depth >= maxDepth) {
      depthLimited = true
      return { kind, size, children: [], omitted: size, deep: true }
    }
    const children: JsonChild[] = []
    for (const [key, childValue] of entries) {
      if (nodes >= maxNodes) {
        truncated = true
        break
      }
      children.push({ key, node: build(childValue, depth + 1) })
    }
    return { kind, size, children, omitted: size - children.length, deep: false }
  }

  return { root: build(value, 0), nodes, truncated, depthLimited }
}

export interface JsonTreeProps {
  readonly text: string
  readonly locale?: Locale
  readonly maxNodes?: number
  readonly maxDepth?: number
  readonly initialDepth?: number
}

const rootStyle: React.CSSProperties = {
  maxHeight: 280,
  overflow: 'auto',
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.25))',
  background: 'rgba(127, 127, 127, 0.06)',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'flex-start',
  minWidth: 0,
}

const childrenStyle: React.CSSProperties = {
  marginLeft: 14,
  paddingLeft: 8,
  borderLeft: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.2))',
}

const toggleStyle: React.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: 0,
  color: 'inherit',
  cursor: 'pointer',
  padding: 0,
  width: 12,
  font: 'inherit',
  opacity: 0.7,
}

const keyStyle: React.CSSProperties = {
  color: 'var(--dsw-color-text-muted, #6b7280)',
  wordBreak: 'break-all',
}

const stringStyle: React.CSSProperties = { color: 'var(--dsw-color-success, #1b7f3b)', wordBreak: 'break-all' }
const numberStyle: React.CSSProperties = { color: 'var(--dsw-color-info, #2a6fdb)' }
const booleanStyle: React.CSSProperties = { color: 'var(--dsw-color-warning, #b26a00)' }
const nullStyle: React.CSSProperties = { opacity: 0.6 }
const noteStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.7,
  padding: '2px 0',
}

interface RenderContext {
  readonly expanded: (path: string, depth: number) => boolean
  readonly toggle: (path: string, depth: number) => void
  readonly maxDepth: number
  readonly initialDepth: number
}

function valueOf(node: JsonScalar): React.ReactNode {
  switch (node.kind) {
    case 'string':
      return <span style={stringStyle}>{`"${node.value}"`}</span>
    case 'number':
      return <span style={numberStyle}>{node.value}</span>
    case 'boolean':
      return <span style={booleanStyle}>{String(node.value)}</span>
    case 'null':
      return <span style={nullStyle}>null</span>
  }
}

function TreeRow({
  node,
  name,
  path,
  depth,
  context,
}: {
  readonly node: JsonNode
  readonly name: string | null
  readonly path: string
  readonly depth: number
  readonly context: RenderContext
}): React.ReactElement {
  const prefix = name === null ? null : <span style={keyStyle}>{name}</span>

  if (!isContainer(node)) {
    return (
      <div style={rowStyle} data-vibe-json-leaf="1">
        {prefix}
        {prefix ? <span style={keyStyle}>:</span> : null}
        {valueOf(node)}
      </div>
    )
  }

  const open = context.expanded(path, depth)
  const shape = node.kind === 'array' ? `[ ${node.size} ]` : `{ ${node.size} }`
  return (
    <div data-vibe-json-node={node.kind}>
      <div style={rowStyle}>
        <button
          type="button"
          style={toggleStyle}
          data-vibe-json-toggle="1"
          aria-expanded={open}
          onClick={() => context.toggle(path, depth)}
        >
          {open ? '▾' : '▸'}
        </button>
        {prefix}
        {prefix ? <span style={keyStyle}>:</span> : null}
        <span>{shape}</span>
      </div>
      {open ? (
        <div style={childrenStyle}>
          {node.children.map((child, index) => (
            <TreeRow
              key={child.key ?? String(index)}
              node={child.node}
              name={child.key ?? String(index)}
              path={child.key === null ? `${path}[${index}]` : `${path}.${child.key}`}
              depth={depth + 1}
              context={context}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function JsonTree({
  text,
  locale,
  maxNodes,
  maxDepth,
  initialDepth = JSON_TREE_INITIAL_DEPTH,
}: JsonTreeProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const parsed = React.useMemo(() => {
    try {
      return { ok: true as const, model: buildJsonTree(JSON.parse(text), { maxNodes, maxDepth }) }
    } catch {
      return { ok: false as const }
    }
  }, [text, maxNodes, maxDepth])
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    setOverrides({})
  }, [text])

  const context = React.useMemo<RenderContext>(
    () => ({
      expanded: (path, depth) => overrides[path] ?? depth < initialDepth,
      toggle: (path, depth) =>
        setOverrides((previous) => ({
          ...previous,
          [path]: !(previous[path] ?? depth < initialDepth),
        })),
      maxDepth: maxDepth ?? JSON_TREE_MAX_DEPTH,
      initialDepth,
    }),
    [overrides, initialDepth, maxDepth],
  )

  if (!parsed.ok) {
    return (
      <div style={rootStyle} data-vibe-json-invalid="1">
        {t('api.response.tree.invalid')}
      </div>
    )
  }

  const { model } = parsed
  return (
    <div style={rootStyle} data-vibe-json-tree="1">
      {model.truncated ? (
        <div style={noteStyle} data-vibe-json-truncated="1">
          {t('api.response.tree.truncated', { count: model.nodes })}
        </div>
      ) : null}
      {model.depthLimited ? (
        <div style={noteStyle} data-vibe-json-depth="1">
          {t('api.response.tree.depth', { depth: context.maxDepth })}
        </div>
      ) : null}
      <TreeRow node={model.root} name={null} path="$" depth={0} context={context} />
    </div>
  )
}
