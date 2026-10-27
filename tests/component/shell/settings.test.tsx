// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  StudioSettingsSnapshot,
  StudioSettingsValues,
} from '../../../src/contracts/settings'
import { TransportError } from '../../../src/client/transport'
import { SettingsPage } from '../../../src/client/shell/settings/SettingsPage'
import type { SettingsApi } from '../../../src/client/shell/settings/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SETTINGS: StudioSettingsValues = {
  allowedOrigins: ['http://localhost:3000'],
  retentionDays: 7,
  contextBudgetBytes: 8192,
  screenshotEnabled: true,
  logLevel: 'info',
}

function snapshot(
  overrides: Partial<StudioSettingsSnapshot> & { settings?: StudioSettingsValues } = {},
): StudioSettingsSnapshot {
  return {
    settings: overrides.settings ?? SETTINGS,
    status: overrides.status ?? 'ok',
    issues: overrides.issues ?? [],
  }
}

function fakeApi(overrides: Partial<SettingsApi> = {}): SettingsApi & {
  load: ReturnType<typeof vi.fn>
  save: ReturnType<typeof vi.fn>
} {
  return {
    load: vi.fn(async () => snapshot()),
    save: vi.fn(async (settings: StudioSettingsValues) => snapshot({ settings })),
    ...overrides,
  } as SettingsApi & { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> }
}

describe('SettingsPage', () => {
  it('loads the Host snapshot into the form', async () => {
    const api = fakeApi()
    render(<SettingsPage locale="en" api={api} />)

    expect(await screen.findByDisplayValue('http://localhost:3000')).toBeTruthy()
    expect(screen.getByDisplayValue('7')).toBeTruthy()
    expect(screen.getByDisplayValue('8192')).toBeTruthy()
    expect(screen.getByLabelText('Log level')).toHaveProperty('value', 'info')
    expect((screen.getByLabelText('Enable screenshots') as HTMLInputElement).checked).toBe(true)
    expect(api.load).toHaveBeenCalledTimes(1)
  })

  it('saves edited values as a typed settings object', async () => {
    const api = fakeApi()
    render(<SettingsPage locale="en" api={api} />)
    const origins = await screen.findByLabelText('Allowed origins')

    fireEvent.change(origins, {
      target: { value: 'http://localhost:3000\n\nhttps://example.test/app\n' },
    })
    fireEvent.change(screen.getByLabelText('Retention (days)'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('Context budget (bytes)'), {
      target: { value: '16384' },
    })
    fireEvent.click(screen.getByLabelText('Enable screenshots'))
    fireEvent.change(screen.getByLabelText('Log level'), { target: { value: 'debug' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save).toHaveBeenCalledWith({
      allowedOrigins: ['http://localhost:3000', 'https://example.test/app'],
      retentionDays: 14,
      contextBudgetBytes: 16384,
      screenshotEnabled: false,
      logLevel: 'debug',
    })
    expect(await screen.findByText('Saved')).toBeTruthy()
  })

  it('blocks invalid numbers before calling the Host', async () => {
    const api = fakeApi()
    render(<SettingsPage locale="en" api={api} />)
    await screen.findByLabelText('Allowed origins')

    fireEvent.change(screen.getByLabelText('Retention (days)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Enter a whole number between 1 and 365.')).toBeTruthy()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('renders Host field issues instead of a saved state', async () => {
    const api = fakeApi({
      save: vi.fn(async () => {
        throw new TransportError('invalid_input', 'settings are invalid', {
          status: 400,
          details: {
            issues: [
              'settings.retentionDays: expected an integer between 1 and 365',
              'settings.allowedOrigins: at least one valid origin is required',
            ],
          },
        })
      }),
    })
    render(<SettingsPage locale="en" api={api} />)
    await screen.findByLabelText('Allowed origins')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('settings.retentionDays: expected an integer between 1 and 365'),
    ).toBeTruthy()
    expect(document.querySelector('[data-settings-issue="retentionDays"]')).toBeTruthy()
    expect(document.querySelector('[data-settings-issue="allowedOrigins"]')).toBeTruthy()
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('shows a load error and retries', async () => {
    const api = fakeApi()
    api.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot())
    render(<SettingsPage locale="en" api={api} />)

    expect(await screen.findByText('Settings unavailable')).toBeTruthy()
    expect(screen.getByText('offline')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByLabelText('Allowed origins')).toBeTruthy()
    expect(api.load).toHaveBeenCalledTimes(2)
  })

  it('shows the unsaved status from the Host snapshot', async () => {
    const api = fakeApi({ load: vi.fn(async () => snapshot({ status: 'missing' })) })
    render(<SettingsPage locale="en" api={api} />)

    expect(
      await screen.findByText('Not saved yet. Defaults come from the profile configuration.'),
    ).toBeTruthy()
  })

  it('renders translated labels for zh-CN', async () => {
    const api = fakeApi()
    render(<SettingsPage locale="zh-CN" api={api} />)

    expect(await screen.findByLabelText('允许的 origin')).toBeTruthy()
    expect(screen.getByLabelText('保留期（天）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
  })
})
