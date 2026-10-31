/**
 * Verification route (T056).
 *
 * One unary method, `preview.verify.run`, exposes the T055 service to the
 * panel. The run takes no params and has no side effects: it reads the live
 * session and the bounded buffers, then answers with the fitted ≤ 4 KB result.
 * The panel's evidence buttons reuse the ids inside it to open the existing
 * Console/Network drawers, so nothing is duplicated here.
 */
import { PREVIEW_VERIFY_RUN_METHOD } from '../../contracts/transport'
import type { UnaryRegistry } from '../transport'
import type { VerifyService } from './service'

/** Registers the unary method; returns an idempotent unregister. */
export function registerVerifyMethods(
  registry: UnaryRegistry,
  service: VerifyService,
): () => void {
  return registry.register(PREVIEW_VERIFY_RUN_METHOD, async () => service.run())
}
