export interface RegexEjsInput {
  content: string
  rawContent: string
  variables: Record<string, unknown> | null
  message: { id: string; conversationId: string; role: string; status: string; content: string }
  surface: 'Display' | 'Prompt' | 'Stored'
  filename?: string
}
export function createRegexEjsLocals(input: RegexEjsInput, failureCodes?: typeof import('../../contracts/errors/codes').ELECKOI_FAILURE_CODES): RegexEjsInput & { getvar(path: string, options?: { defaults?: unknown }): unknown }
export function compileRegexEjs(source: string, filename?: string): (locals: ReturnType<typeof createRegexEjsLocals>) => Promise<string>
export function evaluateRegexEjs(input: RegexEjsInput): Promise<string>
