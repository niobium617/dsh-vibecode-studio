/**
 * Request builder form (T038): method, URL, query, headers, body and auth.
 *
 * The form is presentation only — it owns no draft state beyond the open
 * section, so `RequestBuilder` decides when a draft becomes a request. Rows
 * keep empty inputs around on purpose: beginners need somewhere to type before
 * the field is worth sending.
 */
import * as React from 'react'
import {
  HTTP_AUTH_KINDS,
  HTTP_METHODS,
  type HttpAuthKind,
  type HttpMethod,
} from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import {
  appendRow,
  fieldNameForFile,
  readFileAsBase64,
  removeFile,
  removeRow,
  setFile,
  setRow,
  type BodyKind,
  type KeyValueDraft,
  type RequestDraft,
  type RequestSection,
} from './request-model'

const formStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
}

const barStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gap: 6,
  alignItems: 'center',
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  background: 'var(--dsw-panel-bg, transparent)',
  color: 'inherit',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
}

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  background: 'var(--dsw-panel-bg, transparent)',
  color: 'inherit',
  font: '12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace',
  width: '100%',
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 96,
  resize: 'vertical',
}

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
}

const sectionTitleStyle: React.CSSProperties = {
  font: '600 11px/1.4 system-ui, sans-serif',
  opacity: 0.8,
  margin: '2px 0 0',
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
}

const labelStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.7,
}

const moreStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.18))',
  paddingTop: 8,
}

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  opacity: 0.75,
  padding: '2px 0',
}

const coreActionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  borderBottom: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--dsw-accent-color, #4f8cff)' : 'transparent'}`,
    background: 'transparent',
    color: 'inherit',
    opacity: active ? 1 : 0.7,
    cursor: 'pointer',
    font: '11px/1.4 system-ui, sans-serif',
    padding: '6px 8px 4px',
  }
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(64px, 0.8fr) minmax(0, 1.4fr) auto',
  gap: 6,
  alignItems: 'center',
}

const fileRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto',
  gap: 6,
  alignItems: 'center',
}

const smallButtonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  padding: '4px 8px',
}

const hintStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const errorStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

const MORE_SECTIONS: readonly RequestSection[] = ['headers', 'body', 'auth']

export interface RequestFormProps {
  readonly draft: RequestDraft
  readonly onChange: (next: RequestDraft) => void
  /** Disables every input while a request is in flight. */
  readonly disabled?: boolean
  readonly locale?: Locale
  /** Fired by Enter in a text input and by the hidden submit button. */
  readonly onSubmit?: () => void
  /** Send / cancel, rendered as the third cell of the core row. */
  readonly coreAction?: React.ReactNode
  /** Save and status line, rendered right below the core row. */
  readonly secondaryActions?: React.ReactNode
}

function countRows(rows: readonly KeyValueDraft[]): number {
  return rows.filter((row) => row.enabled && row.name.trim() !== '').length
}

export function RequestForm({
  draft,
  onChange,
  disabled = false,
  locale,
  onSubmit,
  coreAction,
  secondaryActions,
}: RequestFormProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  // U04: query parameters stay on screen; headers, body and auth move into a
  // collapsed "more options" group so the first screen keeps one core row.
  const [section, setSection] = React.useState<RequestSection>('headers')
  const [fileError, setFileError] = React.useState<string | null>(null)
  const patch = (next: Partial<RequestDraft>): void => onChange({ ...draft, ...next })

  const sectionCount: Record<RequestSection, number> = {
    query: countRows(draft.query),
    headers: countRows(draft.headers),
    body: 0,
    auth: draft.authKind === 'none' ? 0 : 1,
  }

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setFileError(null)
    try {
      const drafts = await Promise.all(
        Array.from(files).map(async (file) => ({
          field: fieldNameForFile(file.name),
          fileName: file.name,
          contentType: file.type,
          base64: await readFileAsBase64(file),
        })),
      )
      patch({ files: [...draft.files, ...drafts] })
    } catch {
      setFileError(t('api.request.file.readFailed'))
    }
  }

  return (
    <form
      style={formStyle}
      data-vibe-request-form="1"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
    >
      {/* Implicit submission target so Enter in the URL field sends. */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      <div style={barStyle}>
        <select
          aria-label={t('api.request.method')}
          data-vibe-request-method="1"
          style={selectStyle}
          value={draft.method}
          disabled={disabled}
          onChange={(event) => patch({ method: event.target.value as HttpMethod })}
        >
          {HTTP_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>
        <input
          aria-label={t('api.request.url')}
          data-vibe-request-url="1"
          style={inputStyle}
          type="text"
          inputMode="url"
          spellCheck={false}
          placeholder={t('api.request.url.placeholder')}
          value={draft.url}
          disabled={disabled}
          onChange={(event) => patch({ url: event.target.value })}
        />
        <div style={coreActionStyle}>{coreAction}</div>
      </div>
      {secondaryActions}

      <section style={sectionStyle} data-vibe-query-section="1">
        <h3 style={sectionTitleStyle}>{t('api.request.section.query')}</h3>
        <KeyValueEditor
          section="query"
          rows={draft.query}
          disabled={disabled}
          locale={locale}
          onChange={(rows) => patch({ query: rows })}
        />
      </section>

      <details style={moreStyle} data-vibe-more-config="1">
        <summary style={summaryStyle}>{t('api.request.more')}</summary>
        <div role="tablist" aria-label={t('api.request.sections')} style={tabListStyle}>
          {MORE_SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`vibe-api-section-${id}`}
              aria-selected={section === id}
              data-vibe-section={id}
              style={tabStyle(section === id)}
              onClick={() => setSection(id)}
            >
              {t(`api.request.section.${id}`)}
              {sectionCount[id] > 0 ? ` (${sectionCount[id]})` : ''}
            </button>
          ))}
        </div>

        {section === 'headers' ? (
          <section role="tabpanel" aria-labelledby="vibe-api-section-headers" style={sectionStyle}>
            <KeyValueEditor
              section="headers"
              rows={draft.headers}
              disabled={disabled}
              locale={locale}
              onChange={(rows) => patch({ headers: rows })}
            />
            <span style={hintStyle}>{t('api.request.headers.hint')}</span>
          </section>
        ) : null}

      {section === 'body' ? (
        <section role="tabpanel" aria-labelledby="vibe-api-section-body" style={sectionStyle}>
          <select
            aria-label={t('api.request.body.kind')}
            data-vibe-body-kind="1"
            style={selectStyle}
            value={draft.bodyKind}
            disabled={disabled}
            onChange={(event) => patch({ bodyKind: event.target.value as BodyKind })}
          >
            {(['none', 'json', 'text', 'form', 'multipart'] as const).map((kind) => (
              <option key={kind} value={kind}>
                {t(`api.request.body.kind.${kind}`)}
              </option>
            ))}
          </select>

          {draft.bodyKind === 'json' || draft.bodyKind === 'text' ? (
            <>
              <textarea
                aria-label={t('api.request.body.text')}
                data-vibe-body-text="1"
                style={textareaStyle}
                spellCheck={false}
                placeholder={
                  draft.bodyKind === 'json' ? t('api.request.body.json.placeholder') : ''
                }
                value={draft.bodyText}
                disabled={disabled}
                onChange={(event) => patch({ bodyText: event.target.value })}
              />
              {draft.bodyKind === 'text' ? (
                <input
                  aria-label={t('api.request.body.contentType')}
                  data-vibe-body-content-type="1"
                  style={inputStyle}
                  type="text"
                  spellCheck={false}
                  placeholder="text/plain; charset=utf-8"
                  value={draft.bodyContentType}
                  disabled={disabled}
                  onChange={(event) => patch({ bodyContentType: event.target.value })}
                />
              ) : null}
            </>
          ) : null}

          {draft.bodyKind === 'form' || draft.bodyKind === 'multipart' ? (
            <KeyValueEditor
              section="fields"
              rows={draft.fields}
              disabled={disabled}
              locale={locale}
              onChange={(rows) => patch({ fields: rows })}
            />
          ) : null}

          {draft.bodyKind === 'multipart' ? (
            <div style={sectionStyle}>
              {draft.files.map((file, index) => (
                <div key={`${file.fileName}-${index}`} style={fileRowStyle} data-vibe-file="1">
                  <input
                    aria-label={t('api.request.file.field')}
                    data-vibe-file-field="1"
                    style={inputStyle}
                    type="text"
                    value={file.field}
                    disabled={disabled}
                    onChange={(event) => patch({ files: setFile(draft.files, index, { field: event.target.value }) })}
                  />
                  <span style={hintStyle}>{file.fileName}</span>
                  <button
                    type="button"
                    style={smallButtonStyle}
                    data-vibe-file-remove="1"
                    disabled={disabled}
                    onClick={() => patch({ files: removeFile(draft.files, index) })}
                  >
                    {t('api.request.row.remove')}
                  </button>
                </div>
              ))}
              <label style={hintStyle}>
                {t('api.request.file.add')}
                <input
                  type="file"
                  multiple
                  data-vibe-file-input="1"
                  disabled={disabled}
                  onChange={(event) => {
                    void addFiles(event.target.files)
                    event.target.value = ''
                  }}
                />
              </label>
              <span style={errorStyle} data-vibe-file-error="1">
                {fileError ?? ''}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {section === 'auth' ? (
        <section role="tabpanel" aria-labelledby="vibe-api-section-auth" style={sectionStyle}>
          <select
            aria-label={t('api.request.auth.kind')}
            data-vibe-auth-kind="1"
            style={selectStyle}
            value={draft.authKind}
            disabled={disabled}
            onChange={(event) => patch({ authKind: event.target.value as HttpAuthKind })}
          >
            {HTTP_AUTH_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`api.request.auth.kind.${kind}`)}
              </option>
            ))}
          </select>

          {draft.authKind === 'bearer' ? (
            <LabeledField label={t('api.request.auth.token')}>
              <input
                aria-label={t('api.request.auth.token')}
                data-vibe-auth-token="1"
                style={inputStyle}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="{{token}}"
                value={draft.bearerToken}
                disabled={disabled}
                onChange={(event) => patch({ bearerToken: event.target.value })}
              />
            </LabeledField>
          ) : null}

          {draft.authKind === 'basic' ? (
            <>
              <LabeledField label={t('api.request.auth.username')}>
                <input
                  aria-label={t('api.request.auth.username')}
                  data-vibe-auth-username="1"
                  style={inputStyle}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('api.request.auth.username.placeholder')}
                  value={draft.basicUsername}
                  disabled={disabled}
                  onChange={(event) => patch({ basicUsername: event.target.value })}
                />
              </LabeledField>
              <LabeledField label={t('api.request.auth.password')}>
                <input
                  aria-label={t('api.request.auth.password')}
                  data-vibe-auth-password="1"
                  style={inputStyle}
                  type="password"
                  autoComplete="off"
                  placeholder={t('api.request.auth.password.placeholder')}
                  value={draft.basicPassword}
                  disabled={disabled}
                  onChange={(event) => patch({ basicPassword: event.target.value })}
                />
              </LabeledField>
            </>
          ) : null}

          {draft.authKind === 'api-key' ? (
            <>
              <LabeledField label={t('api.request.auth.keyName')}>
                <input
                  aria-label={t('api.request.auth.keyName')}
                  data-vibe-auth-key-name="1"
                  style={inputStyle}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="X-API-Key"
                  value={draft.apiKeyName}
                  disabled={disabled}
                  onChange={(event) => patch({ apiKeyName: event.target.value })}
                />
              </LabeledField>
              <LabeledField label={t('api.request.auth.keyValue')}>
                <input
                  aria-label={t('api.request.auth.keyValue')}
                  data-vibe-auth-key-value="1"
                  style={inputStyle}
                  type="password"
                  autoComplete="off"
                  placeholder="{{apiKey}}"
                  value={draft.apiKeyValue}
                  disabled={disabled}
                  onChange={(event) => patch({ apiKeyValue: event.target.value })}
                />
              </LabeledField>
              <LabeledField label={t('api.request.auth.keyIn')}>
                <select
                  aria-label={t('api.request.auth.keyIn')}
                  data-vibe-auth-key-in="1"
                  style={selectStyle}
                  value={draft.apiKeyIn}
                  disabled={disabled}
                  onChange={(event) =>
                    patch({ apiKeyIn: event.target.value === 'query' ? 'query' : 'header' })
                  }
                >
                  <option value="header">{t('api.request.auth.in.header')}</option>
                  <option value="query">{t('api.request.auth.in.query')}</option>
                </select>
              </LabeledField>
            </>
          ) : null}
          <span style={hintStyle}>{t('api.request.auth.hint')}</span>
        </section>
      ) : null}
      </details>
    </form>
  )
}

function LabeledField({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}

function KeyValueEditor({
  section,
  rows,
  disabled,
  locale,
  onChange,
}: {
  readonly section: 'query' | 'headers' | 'fields'
  readonly rows: readonly KeyValueDraft[]
  readonly disabled: boolean
  readonly locale?: Locale
  readonly onChange: (rows: KeyValueDraft[]) => void
}): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  return (
    <div style={sectionStyle} data-vibe-rows={section}>
      {rows.map((row, index) => (
        <div key={index} style={rowStyle} data-vibe-row={section}>
          <input
            type="checkbox"
            aria-label={t('api.request.row.enabled')}
            data-vibe-row-enabled="1"
            checked={row.enabled}
            disabled={disabled}
            onChange={(event) =>
              onChange(setRow(rows, index, { enabled: event.target.checked }))
            }
          />
          <input
            aria-label={t('api.request.row.name')}
            data-vibe-row-name="1"
            style={inputStyle}
            type="text"
            spellCheck={false}
            placeholder={t('api.request.row.name')}
            value={row.name}
            disabled={disabled}
            onChange={(event) => onChange(setRow(rows, index, { name: event.target.value }))}
          />
          <input
            aria-label={t('api.request.row.value')}
            data-vibe-row-value="1"
            style={inputStyle}
            type="text"
            spellCheck={false}
            placeholder={t('api.request.row.value')}
            value={row.value}
            disabled={disabled}
            onChange={(event) => onChange(setRow(rows, index, { value: event.target.value }))}
          />
          <button
            type="button"
            style={smallButtonStyle}
            data-vibe-row-remove="1"
            disabled={disabled}
            aria-label={t('api.request.row.remove')}
            onClick={() => onChange(removeRow(rows, index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        style={smallButtonStyle}
        data-vibe-row-add="1"
        disabled={disabled}
        onClick={() => onChange(appendRow(rows))}
      >
        {t('api.request.row.add')}
      </button>
    </div>
  )
}
