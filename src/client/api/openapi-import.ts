/**
 * OpenAPI import seam (FR-API-08, T046 R3).
 *
 * The document is parsed and saved on the Host: the panel sends text and gets
 * back a summary of the collection that was written. The module stays outside
 * React so the size check and the failure wording are testable on their own,
 * and so tests can inject a fake API instead of the transport.
 *
 * The document shares the unary envelope with every other call, so it is
 * capped at `MAX_UNARY_BODY_BYTES`. Importing a 500-endpoint document still
 * works — it is the *document* that must fit, not the collection it produces.
 */
import {
  API_OPENAPI_IMPORT_METHOD,
  type ApiOpenApiImportParams,
  type ApiOpenApiImportResult,
} from '../../contracts/api'
import { utf8Bytes } from '../../contracts/budget'
import { MAX_UNARY_BODY_BYTES } from '../../contracts/transport'
import { callUnary } from '../transport'

export interface ApiOpenApiApi {
  importDocument(params: ApiOpenApiImportParams): Promise<ApiOpenApiImportResult>
}

/** Default transport-backed implementation; tests inject a fake. */
export const hostApiOpenApiApi: ApiOpenApiApi = {
  importDocument: (params) =>
    callUnary<ApiOpenApiImportResult>(API_OPENAPI_IMPORT_METHOD, params),
}

let api: ApiOpenApiApi = hostApiOpenApiApi

/** Tests swap in a fake; the panel always uses the transport-backed API. */
export function setApiOpenApiApi(next: ApiOpenApiApi): void {
  api = next
}

/** Restores the transport-backed API (tests call this between cases). */
export function resetApiOpenApiApi(): void {
  api = hostApiOpenApiApi
}

export function importOpenApiDocument(
  params: ApiOpenApiImportParams,
): Promise<ApiOpenApiImportResult> {
  return api.importDocument(params)
}

/**
 * Exact size of the unary body the panel is about to send, including the
 * `{ method, params }` wrapper. Checking this (rather than the text length)
 * means a document is refused here instead of by a 413 with no explanation.
 */
export function importEnvelopeBytes(params: ApiOpenApiImportParams): number {
  return utf8Bytes(JSON.stringify({ method: API_OPENAPI_IMPORT_METHOD, params }))
}

export { MAX_UNARY_BODY_BYTES }
