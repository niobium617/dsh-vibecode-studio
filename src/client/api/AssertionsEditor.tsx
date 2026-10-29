/**
 * Declarative response assertions editor (T045).
 *
 * Four built-in checks — status code, header, JSONPath, duration — and no
 * script box: the panel builds a plain JSON list and the Host evaluates it
 * after a send (SPEC FR-API-09/12). Rows hold their values as text so a
 * half-typed number is never lost; `buildAssertions` turns them into the wire
 * shape and reports field issues before anything is sent.
 */
import * as React from 'react'
import {
  API_ASSERTION_KINDS,
  API_ASSERTIONS_MAX,
  API_ASSERTION_PATH_CHARS_MAX,
  API_ASSERTION_VALUE_CHARS_MAX,
  HTTP_TIMEOUT_MAX_MS,
  type ApiAssertion,
  type ApiAssertionKind,
  type ApiAssertionMatch,
  type ApiAssertionResult,
} from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'

export type AssertionDraft =
  | { readonly kind: 'status'; readonly expected: string }
  | {
      readonly kind: 'header'
      readonly name: string
      readonly expected: string
      readonly match: ApiAssertionMatch
    }
  | {
      readonly kind: 'json'
      readonly path: string
      readonly expected: string
      readonly match: ApiAssertionMatch
    }
  | { readonly kind: 'duration'; readonly maxMs: string }

export type AssertionIssueCode =
  | 'status_invalid'
  | 'duration_invalid'
  | 'name_empty'
  | 'path_invalid'
  | 'value_too_long'
  | 'too_many'

export interface AssertionIssue {
  /** Row index; -1 for a list-wide issue. */
  readonly index: number
  readonly code: AssertionIssueCode
}

export function createAssertionDraft(kind: ApiAssertionKind): AssertionDraft {
  switch (kind) {
    case 'status':
      return { kind, expected: '200' }
    case 'duration':
      return { kind, maxMs: '1000' }
    case 'header':
      return { kind, name: 'content-type', expected: '', match: 'contains' }
    case 'json':
      return { kind, path: '$', expected: '', match: 'equals' }
  }
}

export interface BuildAssertionsResult {
  readonly assertions?: readonly ApiAssertion[]
  readonly issues: readonly AssertionIssue[]
}

/**
 * Validates every row and returns the wire list. Any issue means nothing is
 * sent, so a typo in a check cannot silently skip it.
 */
export function buildAssertions(drafts: readonly AssertionDraft[]): BuildAssertionsResult {
  const issues: AssertionIssue[] = []
  const assertions: ApiAssertion[] = []
  if (drafts.length > API_ASSERTIONS_MAX) issues.push({ index: -1, code: 'too_many' })
  drafts.forEach((draft, index) => {
    if (draft.kind === 'status') {
      const expected = Number(draft.expected.trim())
      if (!/^\d{3}$/.test(draft.expected.trim()) || expected < 100 || expected > 599) {
        issues.push({ index, code: 'status_invalid' })
        return
      }
      assertions.push({ kind: 'status', expected })
      return
    }
    if (draft.kind === 'duration') {
      const maxMs = Number(draft.maxMs.trim())
      if (!/^\d+$/.test(draft.maxMs.trim()) || maxMs > HTTP_TIMEOUT_MAX_MS) {
        issues.push({ index, code: 'duration_invalid' })
        return
      }
      assertions.push({ kind: 'duration', maxMs })
      return
    }
    if (draft.expected.length > API_ASSERTION_VALUE_CHARS_MAX) {
      issues.push({ index, code: 'value_too_long' })
      return
    }
    if (draft.kind === 'header') {
      const name = draft.name.trim()
      if (name === '' || name.length > 256) {
        issues.push({ index, code: 'name_empty' })
        return
      }
      assertions.push({ kind: 'header', name, expected: draft.expected, match: draft.match })
      return
    }
    const path = draft.path.trim()
    if (!path.startsWith('$') || path.length > API_ASSERTION_PATH_CHARS_MAX) {
      issues.push({ index, code: 'path_invalid' })
      return
    }
    assertions.push({ kind: 'json', path, expected: draft.expected, match: draft.match })
  })
  return issues.length > 0 ? { issues } : { assertions, issues }
}

type Translator = ReturnType<typeof createTranslator>

function resultText(draft: AssertionDraft, result: ApiAssertionResult, t: Translator): string {
  const actual = result.actual ?? '—'
  if (result.passed) return t('api.assertions.passWith', { actual })
  switch (result.failure) {
    case 'status_mismatch':
      return t('api.assertions.failure.status', {
        expected: draft.kind === 'status' ? draft.expected : '',
        actual,
      })
    case 'header_missing':
      return t('api.assertions.failure.headerMissing', {
        name: draft.kind === 'header' ? draft.name : '',
      })
    case 'duration_exceeded':
      return t('api.assertions.failure.duration', {
        expected: draft.kind === 'duration' ? draft.maxMs : '',
        actual,
      })
    case 'body_not_json':
      return t('api.assertions.failure.bodyNotJson')
    case 'path_syntax':
      return t('api.assertions.failure.pathSyntax', {
        path: draft.kind === 'json' ? draft.path : '',
      })
    case 'path_missing':
      return t('api.assertions.failure.pathMissing', {
        path: draft.kind === 'json' ? draft.path : '',
      })
    case 'value_mismatch':
    default:
      return t('api.assertions.failure.value', {
        expected: 'expected' in draft ? draft.expected : '',
        actual,
      })
  }
}

const boxStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 10,
  borderRadius: 6,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
}

const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

const inputStyle: React.CSSProperties = {
  appearance: 'auto' as never,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: '11px/1.4 ui-monospace, monospace',
  padding: '3px 6px',
  minWidth: 0,
  flex: '1 1 120px',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  flex: '0 1 auto',
}

const buttonStyle: React.CSSProperties = {
  appearance: 'none',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.35))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: '11px/1.4 system-ui, sans-serif',
  padding: '3px 8px',
}

const removeStyle: React.CSSProperties = {
  ...buttonStyle,
  flex: '0 0 auto',
  padding: '1px 7px',
}

const hintStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const summaryStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  marginLeft: 'auto',
}

const resultStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  flex: '1 1 100%',
  wordBreak: 'break-word',
}

const issueStyle: React.CSSProperties = {
  ...resultStyle,
  color: 'var(--dsw-color-danger, #c62828)',
}

export interface AssertionsEditorProps {
  readonly drafts: readonly AssertionDraft[]
  readonly onChange: (next: readonly AssertionDraft[]) => void
  /** Results of the last send; the container clears them when a row changes. */
  readonly results?: readonly ApiAssertionResult[]
  readonly issues?: readonly AssertionIssue[]
  readonly disabled?: boolean
  readonly locale?: Locale
}

export function AssertionsEditor({
  drafts,
  onChange,
  results,
  issues = [],
  disabled = false,
  locale,
}: AssertionsEditorProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const aligned = results !== undefined && results.length === drafts.length
  const passed = aligned ? results.filter((result) => result.passed).length : 0
  const issuesFor = (index: number): readonly AssertionIssue[] =>
    issues.filter((issue) => issue.index === index)
  const setDraft = (index: number, next: AssertionDraft): void => {
    onChange(drafts.map((draft, i) => (i === index ? next : draft)))
  }

  return (
    <div style={boxStyle} data-vibe-assertions="1">
      <div style={headStyle}>
        <strong style={{ font: '600 11px/1.4 system-ui, sans-serif' }}>
          {t('api.assertions.title')}
        </strong>
        <span style={hintStyle}>{t('api.assertions.hint')}</span>
        {aligned ? (
          <span
            style={summaryStyle}
            role="status"
            data-state={passed === drafts.length ? 'pass' : 'fail'}
            data-vibe-assertions-summary="1"
          >
            {t('api.assertions.summary', { passed: String(passed), total: String(drafts.length) })}
          </span>
        ) : null}
      </div>

      {drafts.length === 0 ? (
        <span style={hintStyle} data-vibe-assertions-empty="1">
          {t('api.assertions.empty')}
        </span>
      ) : null}

      {drafts.map((draft, index) => {
        const result = aligned ? results[index] : undefined
        const rowIssues = issuesFor(index)
        return (
          <div key={index} style={rowStyle} data-vibe-assertion="1" data-assertion-index={index}>
            <select
              aria-label={t('api.assertions.kind')}
              data-vibe-assertion-kind="1"
              style={selectStyle}
              value={draft.kind}
              disabled={disabled}
              onChange={(event) =>
                setDraft(index, createAssertionDraft(event.target.value as ApiAssertionKind))
              }
            >
              {API_ASSERTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`api.assertions.kind.${kind}`)}
                </option>
              ))}
            </select>

            {draft.kind === 'status' ? (
              <input
                aria-label={t('api.assertions.expectedStatus')}
                data-vibe-assertion-expected="1"
                style={inputStyle}
                type="text"
                inputMode="numeric"
                placeholder="200"
                spellCheck={false}
                value={draft.expected}
                disabled={disabled}
                onChange={(event) => setDraft(index, { ...draft, expected: event.target.value })}
              />
            ) : null}

            {draft.kind === 'duration' ? (
              <input
                aria-label={t('api.assertions.maxMs')}
                data-vibe-assertion-max-ms="1"
                style={inputStyle}
                type="text"
                inputMode="numeric"
                placeholder="1000"
                spellCheck={false}
                value={draft.maxMs}
                disabled={disabled}
                onChange={(event) => setDraft(index, { ...draft, maxMs: event.target.value })}
              />
            ) : null}

            {draft.kind === 'header' ? (
              <input
                aria-label={t('api.assertions.name')}
                data-vibe-assertion-name="1"
                style={inputStyle}
                type="text"
                spellCheck={false}
                placeholder="content-type"
                value={draft.name}
                disabled={disabled}
                onChange={(event) => setDraft(index, { ...draft, name: event.target.value })}
              />
            ) : null}

            {draft.kind === 'json' ? (
              <input
                aria-label={t('api.assertions.path')}
                data-vibe-assertion-path="1"
                style={inputStyle}
                type="text"
                spellCheck={false}
                placeholder={t('api.assertions.path.placeholder')}
                value={draft.path}
                disabled={disabled}
                onChange={(event) => setDraft(index, { ...draft, path: event.target.value })}
              />
            ) : null}

            {draft.kind === 'header' || draft.kind === 'json' ? (
              <>
                <select
                  aria-label={t('api.assertions.match')}
                  data-vibe-assertion-match="1"
                  style={selectStyle}
                  value={draft.match}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft(index, { ...draft, match: event.target.value as ApiAssertionMatch })
                  }
                >
                  <option value="equals">{t('api.assertions.match.equals')}</option>
                  <option value="contains">{t('api.assertions.match.contains')}</option>
                </select>
                <input
                  aria-label={t('api.assertions.expected')}
                  data-vibe-assertion-expected="1"
                  style={inputStyle}
                  type="text"
                  spellCheck={false}
                  value={draft.expected}
                  disabled={disabled}
                  onChange={(event) =>
                    setDraft(index, { ...draft, expected: event.target.value })
                  }
                />
              </>
            ) : null}

            <button
              type="button"
              style={removeStyle}
              data-vibe-assertion-remove="1"
              aria-label={t('api.assertions.remove')}
              title={t('api.assertions.remove')}
              disabled={disabled}
              onClick={() => onChange(drafts.filter((_, i) => i !== index))}
            >
              ×
            </button>

            {rowIssues.map((issue) => (
              <span
                key={issue.code}
                style={issueStyle}
                role="alert"
                data-vibe-assertion-issue="1"
              >
                {t(`api.assertions.issue.${issue.code}`)}
              </span>
            ))}

            {result === undefined ? null : (
              <span
                style={resultStyle}
                data-vibe-assertion-result="1"
                data-state={result.passed ? 'pass' : 'fail'}
              >
                {resultText(draft, result, t)}
              </span>
            )}
          </div>
        )
      })}

      {issues
        .filter((issue) => issue.index < 0)
        .map((issue) => (
          <span key={issue.code} style={issueStyle} role="alert" data-vibe-assertion-issue="1">
            {t(`api.assertions.issue.${issue.code}`)}
          </span>
        ))}

      <button
        type="button"
        style={buttonStyle}
        data-vibe-assertion-add="1"
        disabled={disabled || drafts.length >= API_ASSERTIONS_MAX}
        onClick={() => onChange([...drafts, createAssertionDraft('status')])}
      >
        {t('api.assertions.add')}
      </button>
    </div>
  )
}
