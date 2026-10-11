import type { ElecKoiAuthorApi } from './contracts'
import type { AuthorVariableState } from './variables'

export const AUTHOR_SCRIPT_RUNTIME = 'eleckoi-module'
export const AUTHOR_SCRIPT_API_VERSION = 1
export type AuthorVariableRuleStage = 'before' | 'after' | 'afterSchema'

export interface AuthorVariableRuleContext {
  readonly conversationId: string
  readonly stage: AuthorVariableRuleStage
  readonly before: AuthorVariableState
  readonly signal: AbortSignal
  state: AuthorVariableState
}

export interface AuthorVariableRule {
  id: string
  stage: AuthorVariableRuleStage
  run(context: AuthorVariableRuleContext): void | Promise<void>
}

export interface AuthorScriptProgramContext {
  api: ElecKoiAuthorApi
  signal: AbortSignal
  readonly settings: Record<string, unknown>
  readonly librarySettings: Record<string, unknown>
  scope: 'global' | 'character' | 'preset'
  ownerId: string
  scriptId: string
}

export type AuthorScriptProgram = (context: AuthorScriptProgramContext) =>
  void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>

export interface AuthorScriptDescriptor {
  buttonsVisible?: boolean
  key: string
  id: string
  name: string
  scope: 'global' | 'character' | 'preset'
  ownerId: string
  source: string
  settings: Record<string, unknown>
  librarySettings: Record<string, unknown>
}

/** Only an explicit runtime declaration selects the native program contract. */
export function isNativeAuthorScript(script: Record<string, unknown>): boolean {
  const runtime = script.runtime
  return !!runtime && typeof runtime === 'object' && !Array.isArray(runtime)
    && (runtime as Record<string, unknown>).kind === AUTHOR_SCRIPT_RUNTIME
}

export function assertNativeAuthorScriptVersion(script: Record<string, unknown>): void {
  if (!isNativeAuthorScript(script)
    || (script.runtime as Record<string, unknown>).apiVersion !== AUTHOR_SCRIPT_API_VERSION) {
    throw new TypeError('不支持的 ElecKoi 原生脚本版本。')
  }
}
