import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import {
  resetAnnotationHistoryStore,
  setAnnotationHistoryApi,
  type AnnotationHistoryApi,
} from '../../src/client/inspect/history-store'

/**
 * Component tests never reach a Host. The history panel loads on mount, so a
 * neutral fake keeps shell/annotation tests deterministic; a test that cares
 * about history installs its own fake after this one.
 */
const fakeHistoryApi: AnnotationHistoryApi = {
  list: async () => ({ entries: [], total: 0, skipped: 0 }),
  read: async (id) => {
    throw new Error(`vibe-studio: no stored annotation ${id} in tests`)
  },
  save: async (annotation) => ({ id: annotation.id }),
  remove: async (id) => ({ id, removed: false }),
}

beforeEach(() => {
  resetAnnotationHistoryStore()
  setAnnotationHistoryApi(fakeHistoryApi)
})

afterEach(() => {
  cleanup()
})
