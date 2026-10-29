/**
 * Read-only environment view (T036).
 *
 * The panel receives `ApiEnvironmentView`, whose secret rows carry only what
 * `ctx.credentials.describe()` reports — there is no field a value could ride
 * in. Editing and saving environments arrive with the collections work
 * (T037); this component stays intentionally passive so the API page can show
 * which variables exist, which secrets are configured, and exactly where a
 * `{{placeholder}}` failed to resolve.
 */
import * as React from 'react'
import type {
  ApiEnvironmentView,
  ApiEnvironmentVariableView,
  UnresolvedVariable,
} from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { EmptyState } from '../shell/StateViews'

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  margin: 0,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 12px/1.4 system-ui, sans-serif',
}

const hintStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  margin: 0,
  padding: 0,
  listStyle: 'none',
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, max-content) 1fr',
  gap: 8,
  alignItems: 'baseline',
  font: '11px/1.4 system-ui, sans-serif',
}

const nameStyle: React.CSSProperties = {
  font: '11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
  overflowWrap: 'anywhere',
}

const valueStyle: React.CSSProperties = {
  overflowWrap: 'anywhere',
}

const mutedStyle: React.CSSProperties = {
  opacity: 0.6,
}

const badgeStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.75,
}

const unresolvedBadgeStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-warning, #b26a00)',
}

const unresolvedBoxStyle: React.CSSProperties = {
  display: 'grid',
  gap: 2,
  padding: 8,
  borderRadius: 6,
  background: 'var(--dsw-color-warning-bg, rgba(178, 106, 0, 0.08))',
}

export interface EnvironmentEditorProps {
  readonly view: ApiEnvironmentView
  /** Placeholders the last request expansion could not resolve. */
  readonly unresolved?: readonly UnresolvedVariable[]
  readonly locale?: Locale
}

function groupUnresolved(
  unresolved: readonly UnresolvedVariable[],
): ReadonlyMap<string, readonly UnresolvedVariable[]> {
  const grouped = new Map<string, UnresolvedVariable[]>()
  for (const item of unresolved) {
    const list = grouped.get(item.name)
    if (list) list.push(item)
    else grouped.set(item.name, [item])
  }
  return grouped
}

export function EnvironmentEditor({
  view,
  unresolved = [],
  locale,
}: EnvironmentEditorProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const grouped = React.useMemo(() => groupUnresolved(unresolved), [unresolved])
  const heading = view.name ?? t('api.env.title')

  return (
    <section style={sectionStyle} aria-label={heading} data-vibe-env-editor="1">
      <header style={headerStyle}>
        <h3 style={titleStyle}>{heading}</h3>
        <span style={hintStyle}>{t('api.env.readonly')}</span>
      </header>

      {view.variables.length === 0 ? (
        <EmptyState title={t('api.env.empty.title')} body={t('api.env.empty.body')} />
      ) : (
        <ul style={listStyle} data-vibe-env-variables="1">
          {view.variables.map((variable) => (
            <VariableRow
              key={variable.name}
              variable={variable}
              unresolved={grouped.get(variable.name)}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {unresolved.length > 0 ? (
        <div style={unresolvedBoxStyle} data-vibe-env-unresolved-list="1" role="status">
          <strong style={badgeStyle}>{t('api.env.unresolved.title')}</strong>
          <ul style={listStyle}>
            {unresolved.map((item) => (
              <li key={`${item.name}\u0000${item.where}`} style={valueStyle}>
                {t('api.env.unresolved.row', { name: item.name, where: item.where })}{' '}
                <span style={mutedStyle}>{t(`api.env.reason.${item.reason}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function VariableRow({
  variable,
  unresolved,
  locale,
}: {
  readonly variable: ApiEnvironmentVariableView
  readonly unresolved?: readonly UnresolvedVariable[]
  readonly locale?: Locale
}): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])

  return (
    <li
      style={rowStyle}
      data-vibe-env-variable="1"
      data-vibe-env-name={variable.name}
      data-vibe-env-secret={variable.secret ? '1' : '0'}
    >
      <code style={nameStyle}>{`{{${variable.name}}}`}</code>
      <span style={valueStyle}>
        {variable.secret ? (
          <>
            <span style={variable.configured ? undefined : mutedStyle}>
              {variable.configured ? t('api.env.secret.configured') : t('api.env.secret.missing')}
            </span>
            {variable.configured && variable.source ? (
              <span style={mutedStyle}>
                {' '}
                {t('api.env.secret.source', { source: variable.source })}
              </span>
            ) : null}
          </>
        ) : (
          <span style={mutedStyle}>{variable.value}</span>
        )}
        {variable.enabled ? null : (
          <span style={badgeStyle}> · {t('api.env.disabled')}</span>
        )}
        {unresolved && unresolved.length > 0 ? (
          <span style={unresolvedBadgeStyle} data-vibe-env-unresolved="1">
            {' '}
            · {t('api.env.unresolved.badge')}
          </span>
        ) : null}
      </span>
    </li>
  )
}
