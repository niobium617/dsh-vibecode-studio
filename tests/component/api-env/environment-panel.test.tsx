/**
 * FR-API-04 panel (T046 R4): saved environments load into an editable draft,
 * a secret row shows the credential reference plus its `configured` state and
 * never a value, saves go through the seam, and the request builder names the
 * active environment instead of shipping the document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EnvironmentPanel } from '../../../src/client/api/EnvironmentPanel'
import { RequestBuilder, type ApiSend, type ApiSendOutcome } from '../../../src/client/api/RequestBuilder'
import {
  resetApiEnvironmentStore,
  selectEnvironment,
  setApiEnvironmentApi,
  type ApiEnvironmentApi,
} from '../../../src/client/api/environment-store'
import type { ApiEnvironmentDetail } from '../../../src/contracts/api'

afterEach(() => {
  cleanup()
  resetApiEnvironmentStore()
  vi.restoreAllMocks()
})

const LOCAL: ApiEnvironmentDetail = {
  environment: {
    id: 'local',
    name: 'Local',
    variables: [
      { name: 'baseUrl', value: 'https://api.example.com' },
      { name: 'token', value: 'API_TOKEN', secret: true },
    ],
  },
  view: {
    name: 'Local',
    variables: [
      { name: 'baseUrl', secret: false, enabled: true, value: 'https://api.example.com' },
      { name: 'token', secret: true, enabled: true, configured: true, writable: true, source: 'file' },
    ],
  },
}

function envApi(overrides: Partial<ApiEnvironmentApi> = {}): ApiEnvironmentApi {
  return {
    list: vi.fn(async () => ({
      environments: [{ id: 'local', name: 'Local', variableCount: 2, secretCount: 1 }],
      skipped: 0,
    })),
    read: vi.fn(async () => LOCAL),
    save: vi.fn(async (environment) => ({
      environment: { ...environment, id: environment.id ?? 'local' },
      view: LOCAL.view,
    })),
    remove: vi.fn(async () => ({ removed: true })),
    ...overrides,
  }
}

function fields(container: HTMLElement) {
  return {
    select: container.querySelector<HTMLSelectElement>('[data-vibe-env-select="1"]')!,
    name: container.querySelector<HTMLInputElement>('[data-vibe-env-name-input="1"]')!,
    names: () =>
      [...container.querySelectorAll<HTMLInputElement>('[data-vibe-env-var-name="1"]')],
    values: () =>
      [...container.querySelectorAll<HTMLInputElement>('[data-vibe-env-var-value="1"]')],
    save: container.querySelector<HTMLButtonElement>('[data-vibe-env-save="1"]')!,
    status: () => container.querySelector('[data-vibe-env-status="1"]')?.textContent ?? '',
  }
}

async function selectLocal(container: HTMLElement): Promise<void> {
  const select = fields(container).select
  await waitFor(() => expect(select.options.length).toBe(2))
  fireEvent.change(select, { target: { value: 'local' } })
  await waitFor(() => expect(fields(container).name.value).toBe('Local'))
}

describe('EnvironmentPanel', () => {
  it('loads a saved environment into the draft without a secret value', async () => {
    setApiEnvironmentApi(envApi())
    const { container } = render(<EnvironmentPanel />)

    await selectLocal(container)
    const f = fields(container)
    expect(f.values()[0]!.value).toBe('https://api.example.com')
    // The secret row edits the credential *name*; the view supplies the badge.
    expect(f.values()[1]!.value).toBe('API_TOKEN')
    expect(container.textContent).toContain('Configured')
    expect(container.textContent).toContain('never shown here')
    expect(container.textContent).not.toContain('s3cret')
  })

  it('saves edits through the seam and reports success', async () => {
    const save = vi.fn(envApi().save)
    setApiEnvironmentApi(envApi({ save }))
    const { container } = render(<EnvironmentPanel />)
    await selectLocal(container)

    fireEvent.change(fields(container).values()[0]!, {
      target: { value: 'https://staging.example.com' },
    })
    fireEvent.click(fields(container).save)

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![0]).toEqual({
      id: 'local',
      name: 'Local',
      variables: [
        { name: 'baseUrl', value: 'https://staging.example.com' },
        { name: 'token', value: 'API_TOKEN', secret: true },
      ],
    })
    await waitFor(() => expect(fields(container).status()).toContain('Saved.'))
  })

  it('creates a new environment and drops a blank row', async () => {
    const save = vi.fn(envApi().save)
    setApiEnvironmentApi(envApi({ save }))
    const { container } = render(<EnvironmentPanel />)

    fireEvent.click(container.querySelector('[data-vibe-env-new="1"]')!)
    fireEvent.change(fields(container).name, { target: { value: 'Staging' } })
    fireEvent.click(container.querySelector('[data-vibe-env-add="1"]')!)
    fireEvent.change(fields(container).names()[0]!, { target: { value: 'region' } })
    fireEvent.change(fields(container).values()[0]!, { target: { value: 'eu' } })
    fireEvent.click(container.querySelector('[data-vibe-env-add="1"]')!)

    fireEvent.click(fields(container).save)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![0]).toEqual({
      name: 'Staging',
      variables: [{ name: 'region', value: 'eu', enabled: true }],
    })
  })

  it('refuses to save without a name and deletes the selected environment', async () => {
    const remove = vi.fn(async () => ({ removed: true }))
    setApiEnvironmentApi(envApi({ remove }))
    const { container } = render(<EnvironmentPanel />)
    await selectLocal(container)

    expect(fields(container).save.disabled).toBe(false)
    fireEvent.change(fields(container).name, { target: { value: '   ' } })
    expect(fields(container).save.disabled).toBe(true)

    fireEvent.change(fields(container).name, { target: { value: 'Local' } })
    fireEvent.click(container.querySelector('[data-vibe-env-delete="1"]')!)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('local'))
    await waitFor(() => expect(fields(container).name.value).toBe(''))
  })

  it('reports a failed save instead of showing success', async () => {
    const save = vi.fn(async () => {
      throw new Error('vibe-studio: API store document is invalid')
    })
    setApiEnvironmentApi(envApi({ save }))
    const { container } = render(<EnvironmentPanel />)
    await selectLocal(container)

    fireEvent.click(fields(container).save)
    await waitFor(() => expect(fields(container).status()).toContain('Could not save the environment.'))
    expect(fields(container).status()).toContain('API store document is invalid')
  })

  it('renders zh-CN labels', async () => {
    setApiEnvironmentApi(envApi())
    const { container } = render(<EnvironmentPanel locale="zh-CN" />)
    await waitFor(() => expect(fields(container).select.options.length).toBe(2))
    expect(screen.getByText('保存')).toBeTruthy()
    expect(container.querySelector('[data-vibe-env-new="1"]')?.textContent).toBe('新建')
  })
})

describe('RequestBuilder environment selection', () => {
  function outcome(): ApiSendOutcome {
    return {
      result: {
        status: 200,
        statusText: 'OK',
        url: 'https://api.example.com/items',
        redirects: [],
        headers: {},
        elapsedMs: 1,
        body: { text: '', base64: '', bytes: 0, truncated: false, contentType: '' },
      },
      unresolved: [],
    }
  }

  it('names the active environment in the send options', async () => {
    setApiEnvironmentApi(envApi())
    await selectEnvironment('local')
    const send = vi.fn<ApiSend>(async () => outcome())
    const { container } = render(<RequestBuilder send={send} />)

    fireEvent.change(container.querySelector('[data-vibe-request-url="1"]')!, {
      target: { value: 'https://api.example.com/items' },
    })
    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![1]).toMatchObject({ environmentId: 'local' })
  })

  it('omits environmentId when no environment is selected', async () => {
    setApiEnvironmentApi(envApi())
    const send = vi.fn<ApiSend>(async () => outcome())
    const { container } = render(<RequestBuilder send={send} />)

    fireEvent.change(container.querySelector('[data-vibe-request-url="1"]')!, {
      target: { value: 'https://api.example.com/items' },
    })
    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![1]).not.toHaveProperty('environmentId')
  })
})
