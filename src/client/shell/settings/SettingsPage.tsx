/**
 * Settings page (T014, plan 3.2 / FR-SHELL-04).
 *
 * Loads the Host's `.vibe/studio.json` projection, edits the five settings and
 * saves them back through the unary transport. Invalid input is reported per
 * field and never persisted; the Host stays the validation authority.
 */
import * as React from 'react'
import {
  CONTEXT_BUDGET_BYTES_MAX,
  CONTEXT_BUDGET_BYTES_MIN,
  RETENTION_DAYS_MAX,
  RETENTION_DAYS_MIN,
  SETTINGS_LOG_LEVELS,
  type StudioSettingsField,
  type StudioSettingsLogLevel,
  type StudioSettingsSnapshot,
  type StudioSettingsValues,
} from '../../../contracts/settings'
import { browserLocale, createTranslator, type Locale } from '../../i18n'
import { ErrorState, LoadingState } from '../StateViews'
import { transportSettingsApi, type SettingsApi } from './api'
import { PreviewSettings, type PreviewSettingsApi } from './PreviewSettings'
import {
  groupSettingsIssues,
  issuesFromError,
  type GroupedIssues,
  type SettingsIssues,
} from './issues'

const pageStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  alignContent: 'start',
  font: '12px/1.5 system-ui, sans-serif',
}

const headingStyle: React.CSSProperties = {
  margin: 0,
  font: '600 14px/1.4 system-ui, sans-serif',
}

const hintStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.7,
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const labelStyle: React.CSSProperties = {
  font: '600 12px/1.4 system-ui, sans-serif',
}

const inputStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
}

const issueStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--dsw-danger-color, #d14343)',
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  padding: '6px 8px',
  borderRadius: 4,
  background: 'var(--dsw-warning-surface, rgba(214, 158, 46, 0.12))',
}

interface Draft {
  readonly origins: string
  readonly retentionDays: string
  readonly contextBudgetBytes: string
  readonly screenshotEnabled: boolean
  readonly logLevel: StudioSettingsLogLevel
}

function draftFromSettings(settings: StudioSettingsValues): Draft {
  return {
    origins: settings.allowedOrigins.join('\n'),
    retentionDays: String(settings.retentionDays),
    contextBudgetBytes: String(settings.contextBudgetBytes),
    screenshotEnabled: settings.screenshotEnabled,
    logLevel: settings.logLevel,
  }
}

function originLines(draft: Draft): string[] {
  return draft.origins
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function draftToSettings(draft: Draft): StudioSettingsValues {
  return {
    allowedOrigins: originLines(draft),
    retentionDays: Number(draft.retentionDays),
    contextBudgetBytes: Number(draft.contextBudgetBytes),
    screenshotEnabled: draft.screenshotEnabled,
    logLevel: draft.logLevel,
  }
}

function isIntegerInRange(value: string, min: number, max: number): boolean {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
}

function validateDraft(
  draft: Draft,
  t: (key: string, params?: Record<string, string | number>) => string,
): SettingsIssues {
  const issues: SettingsIssues = {}
  if (originLines(draft).length === 0) {
    issues.allowedOrigins = [t('settings.error.origins')]
  }
  if (!isIntegerInRange(draft.retentionDays, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX)) {
    issues.retentionDays = [
      t('settings.error.number', { min: RETENTION_DAYS_MIN, max: RETENTION_DAYS_MAX }),
    ]
  }
  if (
    !isIntegerInRange(draft.contextBudgetBytes, CONTEXT_BUDGET_BYTES_MIN, CONTEXT_BUDGET_BYTES_MAX)
  ) {
    issues.contextBudgetBytes = [
      t('settings.error.number', { min: CONTEXT_BUDGET_BYTES_MIN, max: CONTEXT_BUDGET_BYTES_MAX }),
    ]
  }
  return issues
}

function FieldIssues({
  field,
  messages,
}: {
  readonly field: StudioSettingsField
  readonly messages: readonly string[] | undefined
}): React.ReactElement | null {
  if (!messages || messages.length === 0) return null
  return (
    <ul role="alert" data-settings-issue={field} style={issueStyle}>
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  )
}

export interface SettingsPageProps {
  /** Override the detected locale (tests); the shell passes its locale. */
  readonly locale?: Locale
  /** Injection point for tests; production uses the unary transport. */
  readonly api?: SettingsApi
  /** Injection point for the preview group (U01); production uses the transport. */
  readonly previewApi?: PreviewSettingsApi
}

export function SettingsPage({
  locale,
  api,
  previewApi,
}: SettingsPageProps): React.ReactElement {
  const activeLocale = locale ?? browserLocale()
  const t = React.useMemo(() => createTranslator(activeLocale), [activeLocale])
  const client = api ?? transportSettingsApi

  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = React.useState('')
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [issues, setIssues] = React.useState<SettingsIssues>({})
  const [generalIssues, setGeneralIssues] = React.useState<string[]>([])
  const [note, setNote] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)

  const applySnapshot = React.useCallback(
    (snapshot: StudioSettingsSnapshot): void => {
      setDraft(draftFromSettings(snapshot.settings))
      const grouped = groupSettingsIssues(snapshot.issues)
      setIssues(grouped.byField)
      setGeneralIssues(grouped.other)
      setNote(
        snapshot.status === 'missing'
          ? t('settings.status.missing')
          : snapshot.status === 'invalid'
            ? t('settings.status.invalid')
            : null,
      )
    },
    [t],
  )

  React.useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState('loading')
    setLoadError('')
    client
      .load({ signal: controller.signal })
      .then((snapshot) => {
        if (!active) return
        applySnapshot(snapshot)
        setSaved(false)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : String(error))
        setState('error')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [client, applySnapshot, reloadKey])

  const updateDraft = (patch: Partial<Draft>): void => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous))
    setSaved(false)
  }

  const onSave = async (): Promise<void> => {
    if (!draft || saving) return
    setSaved(false)
    const localIssues = validateDraft(draft, t)
    if (Object.keys(localIssues).length > 0) {
      setIssues(localIssues)
      setGeneralIssues([])
      return
    }

    setSaving(true)
    try {
      const snapshot = await client.save(draftToSettings(draft))
      applySnapshot(snapshot)
      setSaved(true)
    } catch (error) {
      const grouped: GroupedIssues = issuesFromError(error)
      setIssues(grouped.byField)
      setGeneralIssues(grouped.other)
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') {
    return <LoadingState label={t('settings.loading')} />
  }

  if (state === 'error') {
    return (
      <ErrorState
        title={t('settings.loadError.title')}
        body={t('settings.loadError.body')}
        detail={loadError}
        retryLabel={t('state.error.retry')}
        onRetry={() => setReloadKey((key) => key + 1)}
      />
    )
  }

  if (!draft) return <LoadingState label={t('settings.loading')} />

  const invalid = (field: StudioSettingsField): boolean =>
    (issues[field]?.length ?? 0) > 0

  return (
    <form
      data-vibe-settings="1"
      noValidate
      style={pageStyle}
      onSubmit={(event) => {
        event.preventDefault()
        void onSave()
      }}
    >
      <h3 style={headingStyle}>{t('settings.title')}</h3>
      <p style={hintStyle}>{t('settings.description')}</p>
      {note ? (
        <p role="note" data-settings-note="1" style={noteStyle}>
          {note}
        </p>
      ) : null}

      <div style={fieldStyle}>
        <label htmlFor="vibe-settings-origins" style={labelStyle}>
          {t('settings.allowedOrigins.label')}
        </label>
        <textarea
          id="vibe-settings-origins"
          rows={3}
          spellCheck={false}
          style={inputStyle}
          aria-invalid={invalid('allowedOrigins')}
          aria-describedby="vibe-settings-origins-hint"
          value={draft.origins}
          onChange={(event) => updateDraft({ origins: event.target.value })}
        />
        <p id="vibe-settings-origins-hint" style={hintStyle}>
          {t('settings.allowedOrigins.hint')}
        </p>
        <FieldIssues field="allowedOrigins" messages={issues.allowedOrigins} />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="vibe-settings-retention" style={labelStyle}>
          {t('settings.retentionDays.label')}
        </label>
        <input
          id="vibe-settings-retention"
          type="number"
          min={RETENTION_DAYS_MIN}
          max={RETENTION_DAYS_MAX}
          step={1}
          style={inputStyle}
          aria-invalid={invalid('retentionDays')}
          value={draft.retentionDays}
          onChange={(event) => updateDraft({ retentionDays: event.target.value })}
        />
        <p style={hintStyle}>{t('settings.retentionDays.hint')}</p>
        <FieldIssues field="retentionDays" messages={issues.retentionDays} />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="vibe-settings-budget" style={labelStyle}>
          {t('settings.contextBudgetBytes.label')}
        </label>
        <input
          id="vibe-settings-budget"
          type="number"
          min={CONTEXT_BUDGET_BYTES_MIN}
          max={CONTEXT_BUDGET_BYTES_MAX}
          step={1024}
          style={inputStyle}
          aria-invalid={invalid('contextBudgetBytes')}
          value={draft.contextBudgetBytes}
          onChange={(event) => updateDraft({ contextBudgetBytes: event.target.value })}
        />
        <p style={hintStyle}>{t('settings.contextBudgetBytes.hint')}</p>
        <FieldIssues field="contextBudgetBytes" messages={issues.contextBudgetBytes} />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="vibe-settings-screenshots" style={labelStyle}>
          <input
            id="vibe-settings-screenshots"
            type="checkbox"
            checked={draft.screenshotEnabled}
            onChange={(event) => updateDraft({ screenshotEnabled: event.target.checked })}
          />{' '}
          {t('settings.screenshotEnabled.label')}
        </label>
        <p style={hintStyle}>{t('settings.screenshotEnabled.hint')}</p>
        <FieldIssues field="screenshotEnabled" messages={issues.screenshotEnabled} />
      </div>

      <div style={fieldStyle}>
        <label htmlFor="vibe-settings-log-level" style={labelStyle}>
          {t('settings.logLevel.label')}
        </label>
        <select
          id="vibe-settings-log-level"
          style={inputStyle}
          aria-invalid={invalid('logLevel')}
          value={draft.logLevel}
          onChange={(event) =>
            updateDraft({ logLevel: event.target.value as StudioSettingsLogLevel })
          }
        >
          {SETTINGS_LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
        <p style={hintStyle}>{t('settings.logLevel.hint')}</p>
        <FieldIssues field="logLevel" messages={issues.logLevel} />
      </div>

      <PreviewSettings locale={activeLocale} api={previewApi} />

      {generalIssues.length > 0 ? (
        <ul role="alert" data-settings-general="1" style={issueStyle}>
          {generalIssues.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" disabled={saving}>
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        <span role="status" aria-live="polite">
          {saved ? t('settings.saved') : ''}
        </span>
      </div>
    </form>
  )
}
