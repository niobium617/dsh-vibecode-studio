/**
 * FR-API-08 panel (T046 R3): a pasted or chosen document is imported through
 * the seam, the tree refreshes, and every refusal explains itself without
 * calling the Host (empty, over-limit) or with a stable reason (invalid JSON).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ApiWorkbench } from '../../../src/client/api/ApiWorkbench'
import { OpenApiImportPanel } from '../../../src/client/api/OpenApiImportPanel'
import {
  resetApiOpenApiApi,
  setApiOpenApiApi,
  type ApiOpenApiApi,
} from '../../../src/client/api/openapi-import'
import {
  resetApiCollectionStore,
  setApiCollectionApi,
  type ApiCollectionApi,
} from '../../../src/client/api/collection-store'
import type { ApiOpenApiImportResult } from '../../../src/contracts/api'
import { MAX_UNARY_BODY_BYTES } from '../../../src/contracts/transport'

afterEach(() => {
  cleanup()
  resetApiOpenApiApi()
  resetApiCollectionStore()
  vi.restoreAllMocks()
})

function result(overrides: Partial<ApiOpenApiImportResult> = {}): ApiOpenApiImportResult {
  return {
    collection: { id: 'pet-store', name: 'Pet Store', requestCount: 2, folderCount: 1 },
    version: '3',
    title: 'Pet Store',
    endpointCount: 2,
    groupCount: 1,
    skipped: 0,
    warnings: [],
    remoteDocumentCount: 0,
    ...overrides,
  }
}

function collectionApi(): ApiCollectionApi {
  return {
    list: vi.fn(async () => ({
      collections: [{ id: 'pet-store', name: 'Pet Store', requestCount: 2, folderCount: 1 }],
      skipped: 0,
    })),
    read: vi.fn(async () => ({ id: 'pet-store', name: 'Pet Store', requests: [] })),
    add: vi.fn(async () => ({ collectionId: 'saved', requestId: 'row', requestCount: 1 })),
    remove: vi.fn(async () => ({ removed: true })),
    rename: vi.fn(async (id: string, name: string) => ({
      collection: { id, name, requestCount: 0, folderCount: 0 },
    })),
    duplicate: vi.fn(async (id: string) => ({
      collection: { id: `${id}-copy`, name: 'Copy', requestCount: 0, folderCount: 0 },
    })),
  }
}

function open(container: HTMLElement): void {
  fireEvent.click(container.querySelector('[data-vibe-openapi-toggle="1"]')!)
}

function paste(container: HTMLElement, text: string): void {
  fireEvent.change(container.querySelector('[data-vibe-openapi-input="1"]')!, {
    target: { value: text },
  })
}

function status(container: HTMLElement): string | null | undefined {
  return container.querySelector('[data-vibe-openapi-status="1"]')?.textContent
}

describe('OpenApiImportPanel', () => {
  it('imports a pasted document, refreshes the tree and says nothing was sent', async () => {
    const importDocument = vi.fn(async () => result())
    setApiOpenApiApi({ importDocument } as ApiOpenApiApi)
    const list = vi.fn(collectionApi().list)
    setApiCollectionApi({ ...collectionApi(), list })
    const onImported = vi.fn()

    const { container } = render(<OpenApiImportPanel onImported={onImported} />)
    open(container)
    paste(container, '{"openapi":"3.0.3"}')
    fireEvent.click(container.querySelector('[data-vibe-openapi-import="1"]')!)

    await waitFor(() => expect(status(container)).toContain('Imported 2 endpoints'))
    expect(status(container)).toContain('Pet Store')
    expect(status(container)).toContain('Nothing is sent')
    expect(importDocument).toHaveBeenCalledWith({ text: '{"openapi":"3.0.3"}' })
    expect(onImported).toHaveBeenCalledWith(result())
    expect(list).toHaveBeenCalled()
    expect(container.querySelector<HTMLTextAreaElement>('[data-vibe-openapi-input="1"]')!.value).toBe(
      '',
    )
  })

  it('reports skipped operations and warnings from the import', async () => {
    setApiOpenApiApi({
      importDocument: async () => result({ skipped: 2, warnings: ['multiple_servers'] }),
    } as ApiOpenApiApi)
    setApiCollectionApi(collectionApi())

    const { container } = render(<OpenApiImportPanel />)
    open(container)
    paste(container, '{"openapi":"3.0.3"}')
    fireEvent.click(container.querySelector('[data-vibe-openapi-import="1"]')!)

    await waitFor(() => expect(status(container)).toContain('2 operations could not be imported'))
    expect(status(container)).toContain('1 document warnings')
  })

  it('words a known failure itself instead of showing the Host message', async () => {
    const importDocument = vi.fn(async () => {
      throw {
        code: 'invalid_input',
        message: 'document is not valid JSON (at /paths)',
        details: { reason: 'invalid_json' },
      }
    })
    setApiOpenApiApi({ importDocument } as unknown as ApiOpenApiApi)
    setApiCollectionApi(collectionApi())

    const { container } = render(<OpenApiImportPanel />)
    open(container)
    paste(container, '{not json')
    fireEvent.click(container.querySelector('[data-vibe-openapi-import="1"]')!)

    await waitFor(() => expect(status(container)).toContain('The document is not valid JSON.'))
    expect(status(container)).not.toContain('/paths')
  })

  it('refuses an over-limit document locally', () => {
    const importDocument = vi.fn()
    setApiOpenApiApi({ importDocument } as unknown as ApiOpenApiApi)
    setApiCollectionApi(collectionApi())

    const { container } = render(<OpenApiImportPanel />)
    open(container)
    paste(container, 'x'.repeat(MAX_UNARY_BODY_BYTES))
    fireEvent.click(container.querySelector('[data-vibe-openapi-import="1"]')!)

    expect(status(container)).toContain('too large for one import call')
    expect(importDocument).not.toHaveBeenCalled()
  })

  it('reads a chosen JSON file into the textarea', async () => {
    setApiCollectionApi(collectionApi())
    const { container } = render(<OpenApiImportPanel />)
    open(container)

    const file = {
      name: 'pets.json',
      size: 12,
      text: async () => '{"swagger":"2.0"}',
    } as unknown as File
    fireEvent.change(container.querySelector('[data-vibe-openapi-file="1"]')!, {
      target: { files: [file] },
    })

    await waitFor(() =>
      expect(container.querySelector<HTMLTextAreaElement>('[data-vibe-openapi-input="1"]')!.value).toBe(
        '{"swagger":"2.0"}',
      ),
    )
    expect(container.querySelector('[data-vibe-openapi-name="1"]')?.textContent).toContain(
      'pets.json',
    )
  })

  it('disables Import until there is text', () => {
    setApiCollectionApi(collectionApi())
    const { container } = render(<OpenApiImportPanel />)
    open(container)

    expect(
      container.querySelector<HTMLButtonElement>('[data-vibe-openapi-import="1"]')!.disabled,
    ).toBe(true)
    paste(container, '{}')
    expect(
      container.querySelector<HTMLButtonElement>('[data-vibe-openapi-import="1"]')!.disabled,
    ).toBe(false)
  })

  it('renders the zh-CN labels and mounts inside the workbench', () => {
    setApiCollectionApi(collectionApi())
    const panel = render(<OpenApiImportPanel locale="zh-CN" />)
    open(panel.container)
    expect(panel.container.querySelector('[data-vibe-openapi-panel="1"]')?.textContent).toContain(
      '导入 OpenAPI 文档',
    )
    panel.unmount()

    const workbench = render(<ApiWorkbench locale="en" />)
    expect(workbench.container.querySelector('[data-vibe-openapi-toggle="1"]')).not.toBeNull()
  })
})
