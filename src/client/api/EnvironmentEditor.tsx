/**
 * Environment panel (T036 view, T046 R4 edit).
 *
 * Two modes share one component:
 *
 * - **Read-only** (no `draft`): the T036 view. Plain values are shown, secret
 *   rows show only what `ctx.credentials.describe()` reported (`configured`,
 *   `source`), and unresolved `{{placeholders}}` are listed with the field
 *   that needs them.
 * - **Edit** (`draft` + `onChange`): the saved environments picker, a name, and
 *   one row per variable. A secret row edits the *credential name*; it never
 *   receives a value, so nothing secret can enter the form.
 *
 * Secret references are validated host-side on save; the panel shows the
 * `configured` badge for a secret whose name matches the saved view, which
 * tells the user a reference is usable before they send.
 */
import * as React from 'react'
import type {
  ApiEnvironment,
  ApiEnvironmentSummary,
  ApiEnvironmentView,
  ApiEnvironmentVariable,
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
  flexWrap: 'wrap',
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

const editRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(90px, 1fr) minmax(120px, 2fr) auto auto auto',
  gap: 6,
  alignItems: 'center',
  font: '11px/1.4 system-ui, sans-serif',
}

const inputStyle: React.CSSProperties = {
  font: '11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  background: 'transparent',
  color: 'inherit',
  minWidth: 0,
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

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
  font: '11px/1.4 system-ui, sans-serif',
}

const buttonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  padding: '2px 8px',
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: 'var(--dsw-accent-color, #4f8cff)',
  background: 'var(--dsw-accent-color, #4f8cff)',
  color: '#fff',
  fontWeight: 600,
}

const checkboxStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 3,
  alignItems: 'center',
  whiteSpace: 'nowrap',
}

const statusOkStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
}

const statusErrorStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

export type EnvironmentEditorStatusKind = 'idle' | 'saving' | 'saved' | 'failed'

export interface EnvironmentEditorStatus {
  readonly kind: EnvironmentEditorStatusKind
  /** Host message for a failure; already path-free. */
  readonly detail?: string
}

export interface EnvironmentEditorProps {
  readonly view: ApiEnvironmentView
  /** Placeholders the last request expansion could not resolve. */
  readonly unresolved?: readonly UnresolvedVariable[]
  readonly locale?: Locale
  /** Editable draft; present (with `onChange`) turns the panel into an editor. */
  readonly draft?: ApiEnvironment
  readonly summaries?: readonly ApiEnvironmentSummary[]
  readonly busy?: boolean
  readonly status?: EnvironmentEditorStatus
  readonly onChange?: (draft: ApiEnvironment) => void
  readonly onSelect?: (id: string) => void
  readonly onCreate?: () => void
  readonly onSave?: () => void
  readonly onRemove?: () => void
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
  draft,
  summaries = [],
  busy = false,
  status,
  onChange,
  onSelect,
  onCreate,
  onSave,
  onRemove,
}: EnvironmentEditorProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const grouped = React.useMemo(() => groupUnresolved(unresolved), [unresolved])
  const editable = draft !== undefined && onChange !== undefined
  const heading = editable ? (draft.name ?? '').trim() || t('api.env.title') : (view.name ?? t('api.env.title'))

  return (
    <section
      style={sectionStyle}
      aria-label={heading}
      data-vibe-env-editor="1"
      data-vibe-env-mode={editable ? 'edit' : 'view'}
    >
      <header style={headerStyle}>
        <h3 style={titleStyle}>{heading}</h3>
        <span style={hintStyle}>
          {editable
            ? draft.id === undefined
              ? t('api.env.edit.unsaved')
              : t('api.env.edit.active', { id: draft.id })
            : t('api.env.readonly')}
        </span>
      </header>

      {editable ? (
        <EditorBody
          draft={draft}
          view={view}
          summaries={summaries}
          busy={busy}
          status={status}
          locale={locale}
          onChange={onChange}
          onSelect={onSelect}
          onCreate={onCreate}
          onSave={onSave}
          onRemove={onRemove}
        />
      ) : view.variables.length === 0 ? (
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

interface EditorBodyProps {
  readonly draft: ApiEnvironment
  readonly view: ApiEnvironmentView
  readonly summaries: readonly ApiEnvironmentSummary[]
  readonly busy: boolean
  readonly status: EnvironmentEditorStatus | undefined
  readonly locale: Locale | undefined
  readonly onChange: (draft: ApiEnvironment) => void
  readonly onSelect?: (id: string) => void
  readonly onCreate?: () => void
  readonly onSave?: () => void
  readonly onRemove?: () => void
}

function EditorBody({
  draft,
  view,
  summaries,
  busy,
  status,
  locale,
  onChange,
  onSelect,
  onCreate,
  onSave,
  onRemove,
}: EditorBodyProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const configured = React.useMemo(() => {
    const map = new Map<string, ApiEnvironmentVariableView>()
    for (const variable of view.variables) {
      if (variable.secret) map.set(variable.name, variable)
    }
    return map
  }, [view])

  const setVariable = (index: number, patch: Partial<ApiEnvironmentVariable>): void => {
    onChange({
      ...draft,
      variables: draft.variables.map((variable, at) =>
        at === index ? { ...variable, ...patch } : variable,
      ),
    })
  }

  const removeVariable = (index: number): void => {
    onChange({ ...draft, variables: draft.variables.filter((_, at) => at !== index) })
  }

  const addVariable = (): void => {
    onChange({
      ...draft,
      variables: [...draft.variables, { name: '', value: '', enabled: true }],
    })
  }

  return (
    <>
      <div style={toolbarStyle}>
        <label style={checkboxStyle}>
          {t('api.env.edit.select')}
          <select
            style={inputStyle}
            data-vibe-env-select="1"
            value={draft.id ?? ''}
            disabled={busy}
            onChange={(event) => onSelect?.(event.target.value)}
          >
            <option value="">{t('api.env.edit.none')}</option>
            {summaries.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={buttonStyle} data-vibe-env-new="1" disabled={busy} onClick={onCreate}>
          {t('api.env.edit.new')}
        </button>
        <label style={checkboxStyle}>
          {t('api.env.edit.name')}
          <input
            style={inputStyle}
            data-vibe-env-name-input="1"
            value={draft.name}
            disabled={busy}
            placeholder={t('api.env.edit.namePlaceholder')}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
      </div>

      {draft.variables.length === 0 ? (
        <span style={mutedStyle} data-vibe-env-edit-empty="1">
          {t('api.env.edit.empty')}
        </span>
      ) : (
        <ul style={listStyle} data-vibe-env-edit-variables="1">
          {draft.variables.map((variable, index) => {
            const described = configured.get(variable.name)
            return (
              <li
                key={index}
                style={editRowStyle}
                data-vibe-env-variable="1"
                data-vibe-env-name={variable.name}
                data-vibe-env-secret={variable.secret === true ? '1' : '0'}
              >
                <input
                  style={inputStyle}
                  data-vibe-env-var-name="1"
                  aria-label={t('api.env.edit.name')}
                  value={variable.name}
                  disabled={busy}
                  placeholder="baseUrl"
                  onChange={(event) => setVariable(index, { name: event.target.value })}
                />
                <input
                  style={inputStyle}
                  data-vibe-env-var-value="1"
                  aria-label={t('api.env.edit.value')}
                  value={variable.value}
                  disabled={busy}
                  placeholder={
                    variable.secret === true
                      ? t('api.env.edit.secret.placeholder')
                      : t('api.env.edit.value')
                  }
                  onChange={(event) => setVariable(index, { value: event.target.value })}
                />
                <label style={checkboxStyle}>
                  <input
                    type="checkbox"
                    data-vibe-env-var-secret="1"
                    checked={variable.secret === true}
                    disabled={busy}
                    onChange={(event) =>
                      setVariable(index, { secret: event.target.checked ? true : undefined })
                    }
                  />
                  {t('api.env.edit.secret')}
                </label>
                <label style={checkboxStyle}>
                  <input
                    type="checkbox"
                    data-vibe-env-var-enabled="1"
                    checked={variable.enabled !== false}
                    disabled={busy}
                    onChange={(event) =>
                      setVariable(index, { enabled: event.target.checked ? undefined : false })
                    }
                  />
                  {t('api.env.edit.enabled')}
                </label>
                <span style={described?.configured ? badgeStyle : mutedStyle}>
                  {variable.secret === true
                    ? described?.configured
                      ? t('api.env.secret.configured')
                      : t('api.env.secret.missing')
                    : null}
                  <button
                    type="button"
                    style={{ ...buttonStyle, marginLeft: 6 }}
                    data-vibe-env-var-remove="1"
                    disabled={busy}
                    onClick={() => removeVariable(index)}
                  >
                    {t('api.env.edit.remove')}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {draft.variables.some((variable) => variable.secret === true) ? (
        <span style={hintStyle} data-vibe-env-secret-hint="1">
          {t('api.env.edit.secret.hint')}
        </span>
      ) : null}

      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} data-vibe-env-add="1" disabled={busy} onClick={addVariable}>
          {t('api.env.edit.add')}
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          data-vibe-env-save="1"
          disabled={busy || (draft.name ?? '').trim() === ''}
          onClick={onSave}
        >
          {busy ? t('api.env.edit.saving') : t('api.env.edit.save')}
        </button>
        {draft.id === undefined ? null : (
          <button
            type="button"
            style={buttonStyle}
            data-vibe-env-delete="1"
            disabled={busy}
            onClick={onRemove}
          >
            {t('api.env.edit.delete')}
          </button>
        )}
        {status === undefined || status.kind === 'idle' ? null : (
          <span
            style={status.kind === 'failed' ? statusErrorStyle : statusOkStyle}
            data-vibe-env-status="1"
            role={status.kind === 'failed' ? 'alert' : 'status'}
          >
            {status.kind === 'saving'
              ? t('api.env.edit.saving')
              : status.kind === 'saved'
                ? t('api.env.edit.saved')
                : `${t('api.env.edit.failed')}${status.detail ? ` ${status.detail}` : ''}`}
          </span>
        )}
      </div>
    </>
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
