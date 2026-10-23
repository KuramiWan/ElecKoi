import type { ElecKoiAuthorApi } from './contracts'
import { contractFailure } from './errors'
import type { AuthorVariableState } from './variables'

export const AUTHOR_SCRIPT_RUNTIME = 'eleckoi-module'
export const AUTHOR_SCRIPT_API_VERSION = 1

/** 契约码 `eleckoi/input/unsupported` 的本地副本（本 SDK 没有运行期依赖；用例守住一致性）。 */
export const UNSUPPORTED_NATIVE_SCRIPT_VERSION_CODE = 'eleckoi/input/unsupported'

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
    // 这条失败会穿过产品 Remote 边界到用户眼前（脚本目录读取），所以给契约码而不是裸 TypeError。
    throw contractFailure(UNSUPPORTED_NATIVE_SCRIPT_VERSION_CODE, '不支持的 ElecKoi 原生脚本版本。', {
      what: '原生脚本版本',
      expected: String(AUTHOR_SCRIPT_API_VERSION)
    })
  }
}
