import type { Context } from '@deepseek-ai/cordis'

/** Imported HTML presentation resources; no author or script execution API. */
export interface ElecKoiTavernShared {
  /**
   * Read presentation resource availability.
   * @returns The resource readiness state and its error text.
   */
  getSnapshot(): { status: 'ready'; error: string }
  /**
   * Subscribe to resource availability changes.
   * @param listener - Called when the resource state changes.
   * @returns Stops this subscription.
   */
  subscribe(listener: () => void): () => void
}
declare module '@deepseek-ai/cordis' { interface Context { eleckoiTavernShared: ElecKoiTavernShared } }
export declare function apply(ctx: Context): Promise<void>
export declare const inject: string[]
