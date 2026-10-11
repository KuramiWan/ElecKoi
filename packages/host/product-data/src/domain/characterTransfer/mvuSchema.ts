import { parse } from '@babel/parser'
import traverseModule, { type NodePath } from '@babel/traverse'
import { z } from 'zod'
import { MVU_SCHEMA_REGISTRATION_MODULES } from '@eleckoi/compatibility-mvu'
import { assertVariableJson, loadVariableSchema } from '@product-data/domain/variables'

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule
export { MVU_SCHEMA_REGISTRATION_MODULES }
const registrationModules = new Set(MVU_SCHEMA_REGISTRATION_MODULES)

export interface ImportedMvuSchema {
  code: string
  schema: z.ZodType
  initialize(state: Record<string, unknown>): Record<string, unknown>
}

export function extractMvuSchema(source: string, options: { recognizedModuleOnly?: boolean } = {}): string | undefined {
  if (!source.includes('registerMvuSchema')) return undefined
  const ast = parse(source, { sourceType: 'unambiguous' })
  const registrations: NodePath[] = []
  let program: NodePath | undefined
  const names = new Set(['registerMvuSchema'])
  traverse(ast, {
    ImportSpecifier(path) {
      const name = path.node.imported.type === 'Identifier' ? path.node.imported.name : path.node.imported.value
      if (name === 'registerMvuSchema') {
        names.add(path.node.local.name)
      }
    }
  })
  traverse(ast, {
    Program(path) { program = path },
    CallExpression(path) {
      const callee = path.node.callee
      if (callee.type !== 'Identifier' || !names.has(callee.name)) return
      const binding = path.scope.getBinding(callee.name)
      const module = binding?.path.parentPath
      const imported = binding?.path.isImportSpecifier() ? binding.path.node.imported : undefined
      const knownRegistration = (imported?.type === 'Identifier' ? imported.name : imported?.value) === 'registerMvuSchema'
        && module?.isImportDeclaration() && registrationModules.has(module.node.source.value)
      if (options.recognizedModuleOnly && !knownRegistration) return
      if (binding && !binding.path.isImportSpecifier()) throw new Error('MVU Schema 注册函数被局部声明覆盖，无法确定注册语义。')
      if (!binding) throw new Error('MVU Schema 注册函数缺少明确的模块绑定，无法确定注册语义。')
      if (!knownRegistration) {
        throw new Error('MVU Schema 注册模块尚未支持，不能按同名函数推断处理规则。')
      }
      if (path.node.arguments.length !== 1) throw new Error('MVU Schema 注册必须提供一个明确的结构。')
      const argument = path.get('arguments')[0]!
      if (argument.isSpreadElement()) throw new Error('MVU Schema 注册不支持展开参数。')
      registrations.push(argument)
    }
  })
  if (!registrations.length) return undefined
  if (registrations.length !== 1) throw new Error('存在多个 MVU Schema 注册，无法确定唯一变量结构。')
  assertRegistrationContext(registrations[0]!.parentPath!)
  const declarations = new Map<number, NodePath>()
  const imports = new Map<number, NodePath>()
  function collect(path: NodePath): void {
    const reference = (current: NodePath): void => {
      if (!current.isReferencedIdentifier()) return
      const binding = current.scope.getBinding(current.node.name)
      if (!binding) return
      if (binding.scope !== program!.scope) {
        if (binding.path.node.start! >= path.node.start! && binding.path.node.end! <= path.node.end!) return
        throw new Error('MVU Schema 依赖注册回调中的局部状态，无法静态提取。')
      }
      const declaration = binding.path
      if (declaration.isImportSpecifier() || declaration.isImportDefaultSpecifier()) {
        const specifier = declaration.parentPath.node
        if (specifier.type !== 'ImportDeclaration') throw new Error('MVU Schema 依赖无法解析。')
        if (specifier.source.value === 'zod' && declaration.isImportSpecifier()
          && declaration.node.imported.type === 'Identifier' && declaration.node.imported.name === 'z'
          || specifier.source.value === 'lodash' && declaration.isImportDefaultSpecifier()) {
          imports.set(specifier.start!, declaration.parentPath)
          return
        }
        throw new Error(`MVU Schema 的外部依赖尚不支持：${specifier.source.value}`)
      }
      if (!declaration.isVariableDeclarator() && !declaration.isFunctionDeclaration()) {
        throw new Error('MVU Schema 依赖不是可导入的变量或函数声明。')
      }
      if (!binding.constant) throw new Error('MVU Schema 依赖运行中的变量赋值，无法静态提取。')
      const start = declaration.node.start!
      if (declarations.has(start)) return
      declarations.set(start, declaration)
      collect(declaration)
    }
    reference(path)
    path.traverse({ ReferencedIdentifier: reference })
  }
  collect(registrations[0]!)
  const retained = [...declarations.values(), registrations[0]!]
  const insideRetained = (path: NodePath) => retained.some(root => path.node.start! >= root.node.start! && path.node.end! <= root.node.end!)
  for (const declaration of declarations.values()) {
    const id = declaration.isVariableDeclarator() || declaration.isFunctionDeclaration() ? declaration.node.id : undefined
    if (!id || id.type !== 'Identifier') throw new Error('MVU Schema 的依赖声明必须有明确的名称。')
    const binding = declaration.scope.getBinding(id.name)
    if (binding?.referencePaths.some(reference => !insideRetained(reference))) {
      throw new Error(`MVU Schema 依赖在其他脚本流程中被使用，无法保证静态提取的语义：${id.name}`)
    }
  }
  const code = [...declarations.values()].sort((a, b) => a.node.start! - b.node.start!)
    .map(path => `${path.isVariableDeclarator() ? 'const ' : ''}${source.slice(path.node.start!, path.node.end!)};`).join('\n')
  const expression = source.slice(registrations[0]!.node.start!, registrations[0]!.node.end!)
  const dependencies = [...imports.values()].sort((a, b) => a.node.start! - b.node.start!)
    .map(path => source.slice(path.node.start!, path.node.end!)).join('\n')
  return `${dependencies}\nconst Schema = ((registered) => {
  const original = typeof registered === 'function' ? registered() : registered;
  if (!(original instanceof z.ZodType)) throw new Error('MVU Schema 注册没有返回当前支持的 Zod 结构。');
  const rule = original instanceof z.ZodObject ? z.looseObject(original.shape) : original;
  let input;
  return z.preprocess(value => { input = value; return value; }, rule).transform(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MVU Schema 处理结果必须是 JSON 对象。');
    return { ...input, ...value };
  });
})((() => {\n${code}\nreturn (${expression});\n})());`
}

function assertRegistrationContext(call: NodePath): void {
  const statement = call.parentPath
  if (statement?.isExpressionStatement() && statement.parentPath.isProgram()) return
  const callback = statement?.isArrowFunctionExpression() ? statement
    : statement?.isExpressionStatement() && statement.parentPath.isBlockStatement() ? statement.parentPath.parentPath : undefined
  const ready = callback?.parentPath
  if (!callback?.isArrowFunctionExpression() || callback.node.params.length
    || !ready?.isCallExpression() || ready.node.arguments.length !== 1
    || ready.node.callee.type !== 'Identifier' || !['$', 'jQuery'].includes(ready.node.callee.name)
    || ready.scope.getBinding(ready.node.callee.name)
    || !ready.parentPath.isExpressionStatement() || !ready.parentPath.parentPath.isProgram()) {
    throw new Error('MVU Schema 注册依赖条件或运行中的回调，无法静态提取。')
  }
  if (callback.node.body.type === 'BlockStatement') {
    for (const item of callback.node.body.body) {
      if (item === statement?.node) continue
      if (item.type === 'ExpressionStatement' && item.expression.type === 'AwaitExpression') {
        const awaited = item.expression.argument
        if (awaited.type === 'CallExpression' && awaited.callee.type === 'Identifier'
          && awaited.callee.name === 'waitGlobalInitialized' && !callback.scope.getBinding('waitGlobalInitialized')
          && awaited.arguments.length === 1 && awaited.arguments[0]?.type === 'StringLiteral' && awaited.arguments[0].value === 'Mvu'
          && item.start! < call.node.start!) continue
      }
      throw new Error('MVU Schema 注册依赖回调中的额外处理，无法静态提取。')
    }
  }
}

export function loadMvuSchema(scripts: string[]): ImportedMvuSchema | undefined {
  const codes = scripts.map(source => extractMvuSchema(source)).filter((code): code is string => code !== undefined)
  if (!codes.length) return undefined
  if (codes.length !== 1) throw new Error('启用的脚本中存在多个 MVU Schema，无法确定唯一变量结构。')
  const code = codes[0]!
  // Only the registered schema dependency graph is evaluated, not script lifecycle handlers.
  const runtime = loadVariableSchema(code)
  return {
    code,
    schema: runtime.schema,
    initialize: runtime.parse,
  }
}

export function assertMvuJson(value: unknown): void {
  assertVariableJson(value)
}

export function structuralMvuSchema(schema: z.ZodType | undefined): z.ZodType | undefined {
  const seen = new Set<z.ZodType>()
  let current = schema
  while (current && !seen.has(current)) {
    seen.add(current)
    const definition = current.def as z.core.$ZodTypeDef & { innerType?: z.ZodType; in?: z.ZodType; out?: z.ZodType }
    if (definition.innerType) current = definition.innerType
    else if (definition.type === 'pipe') current = definition.in?.def.type === 'transform' ? definition.out : definition.in
    else return current
  }
  return undefined
}
