import { createContext, Script } from 'node:vm'
import { parse } from '@babel/parser'
import lodash from 'lodash'
import { z } from 'zod'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export interface VariableSchemaRuntime {
  schema: z.ZodType
  parse(value: Record<string, unknown>): Record<string, unknown>
}

export type VariableRuleStage = 'schema' | 'input' | 'validation' | 'execution' | 'output'
const remoteFailure = z.object({
  error_stage: z.enum(['schema', 'input', 'validation', 'execution', 'output']),
  detail: z.string().max(8000),
  issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string().max(1000) })).max(64).optional(),
  issues_truncated: z.boolean().optional(),
}).strict()

export class VariableRuleError extends Error {
  constructor(readonly stage: VariableRuleStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'VariableRuleError'
  }
}

export function describeVariableRuleFailure(error: unknown): {
  error_stage: VariableRuleStage
  detail: string
  issues?: Array<{ path: string; code: string; message: string }>
  issues_truncated?: boolean
} {
  if (error && typeof error === 'object' && 'variableRuleFailure' in error) {
    const decoded = remoteFailure.safeParse(error.variableRuleFailure)
    if (decoded.success) return {
      error_stage: decoded.data.error_stage,
      detail: decoded.data.detail,
      ...(decoded.data.issues !== undefined ? { issues: decoded.data.issues } : {}),
      ...(decoded.data.issues_truncated !== undefined ? { issues_truncated: decoded.data.issues_truncated } : {}),
    }
  }
  const cause = error instanceof VariableRuleError ? error.cause : error
  const detail = (error instanceof Error ? error.message : String(error)).slice(0, 8000)
  return {
    error_stage: error instanceof VariableRuleError ? error.stage : 'execution',
    detail,
    ...(cause instanceof z.ZodError ? {
      issues: cause.issues.slice(0, 64).map(issue => ({
        path: issue.path.length ? '/' + issue.path.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '',
        code: issue.code,
        message: issue.message.slice(0, 1000),
      })),
      issues_truncated: cause.issues.length > 64,
    } : {}),
  }
}

/** JSON serialization must not discard authored fields or invoke authored accessors. */
export function assertVariableJson(value: unknown, objectPrototypes = new Set<unknown>([Object.prototype, null]), ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量状态必须是有限、无循环的 JSON 数据。', { what: '变量状态' })
  if (!Array.isArray(value) && !objectPrototypes.has(Object.getPrototypeOf(value))) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量状态包含非 JSON 对象。', { what: '变量状态' })
  if (Object.getOwnPropertySymbols(value).length) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量状态包含无法保存的 Symbol 字段。', { what: '变量状态' })
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(descriptors, String(index))) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量状态包含稀疏数组。', { what: '变量状态' })
  }
  ancestors.add(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量状态包含无法保存的属性或访问器。', { what: '变量状态' })
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量数组包含无法保存的附加字段。', { what: '变量数组' })
    assertVariableJson(descriptor.value, objectPrototypes, ancestors)
  }
  ancestors.delete(value)
}

export function loadVariableSchema(source: string): VariableSchemaRuntime {
  try { return createVariableSchema(source) }
  catch (error) { throw new VariableRuleError('schema', error) }
}

function createVariableSchema(source: string): VariableSchemaRuntime {
  const ast = parse(source, { sourceType: 'module' })
  const statements: string[] = []
  let result = 'Schema'
  const bindings: Record<string, unknown> = { z, _: lodash }
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      if (statement.source.value !== 'zod' && statement.source.value !== 'lodash') throw new DesktopError(ELECKOI_FAILURE_CODES.inputUnsupported, `变量规则的外部依赖尚不支持：${statement.source.value}`, { what: '变量规则的外部依赖' })
      for (const specifier of statement.specifiers) {
        if (statement.source.value === 'zod' && specifier.type === 'ImportSpecifier'
          && specifier.imported.type === 'Identifier' && specifier.imported.name === 'z') bindings[specifier.local.name] = z
        else if (statement.source.value === 'lodash' && specifier.type === 'ImportDefaultSpecifier') bindings[specifier.local.name] = lodash
        else throw new DesktopError(ELECKOI_FAILURE_CODES.inputUnsupported, '变量规则的依赖声明尚不支持。', { what: '变量规则的依赖声明' })
      }
      continue
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      if (statement.declaration.type === 'FunctionDeclaration' || statement.declaration.type === 'ClassDeclaration') throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '变量规则必须返回 Zod Schema。', { field: 'rule' })
      result = `(${source.slice(statement.declaration.start!, statement.declaration.end!)})`
    } else if (statement.type === 'ExportNamedDeclaration') {
      if (!statement.declaration) throw new DesktopError(ELECKOI_FAILURE_CODES.inputUnsupported, '变量规则的导出声明尚不支持。', { what: '变量规则的导出声明' })
      statements.push(source.slice(statement.declaration.start!, statement.declaration.end!))
    } else if (ast.program.body.length === 1 && statement.type === 'ExpressionStatement') {
      result = `(${source.slice(statement.expression.start!, statement.expression.end!)})`
    } else statements.push(source.slice(statement.start!, statement.end!))
  }
  const context = createContext(bindings, { codeGeneration: { strings: false, wasm: false } })
  const schema: unknown = new Script(`(() => {\n${statements.join('\n')}\nreturn ${result};\n})()`).runInContext(context, { timeout: 1000 })
  if (!(schema instanceof z.ZodType)) throw new DesktopError(ELECKOI_FAILURE_CODES.inputUnsupported, '变量规则没有返回当前支持的 Zod Schema。', { what: '变量规则返回的 Zod Schema' })
  const prototypes = new Set([Object.prototype, null, new Script('Object.prototype').runInContext(context)])
  context.__schema = schema
  const evaluate = new Script('__schema.parse(__state)')
  return {
    schema,
    parse(value) {
      try { assertVariableJson(value) }
      catch (error) { throw new VariableRuleError('input', error) }
      context.__state = structuredClone(value)
      try {
        let parsed: unknown
        try { parsed = evaluate.runInContext(context, { timeout: 1000 }) }
        catch (error) { throw new VariableRuleError(error instanceof z.ZodError ? 'validation' : 'execution', error) }
        try {
          assertVariableJson(parsed, prototypes)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, '变量规则处理结果必须是 JSON 对象。', { what: '变量规则处理结果' })
          return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>
        } catch (error) { throw new VariableRuleError('output', error) }
      } finally { delete context.__state }
    },
  }
}
