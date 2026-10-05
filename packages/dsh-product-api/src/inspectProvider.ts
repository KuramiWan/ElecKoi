import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** 为官方 Inspect 注册表声明一个只读接口目录，不读取用户资料。 */
export function createApiInspectProvider(
  id: string,
  description: string,
  selector: 'key' | 'namespace',
  queryApi: (selection?: string) => object
) {
  return {
    manifest: {
      id, description,
      methods: [{
        name: 'api',
        description: `省略 ${selector} 时列出目录；指定时返回该接口的参数、返回值和引用类型。`,
        inputSchema: {
          type: 'object', properties: { [selector]: { type: 'string' } }, additionalProperties: false
        },
        outputSchema: { type: 'object' }
      }]
    },
    async query(method: string, input: JsonValue | undefined): Promise<JsonValue> {
      if (method !== 'api') throw new Error(`不支持的接口查询：${method}`)
      if (input !== undefined && (input === null || typeof input !== 'object' || Array.isArray(input))) {
        throw new Error('接口查询参数必须是对象。')
      }
      const value = input?.[selector]
      if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
        throw new Error(`${selector} 必须是非空字符串。`)
      }
      if (input && Object.keys(input).some(key => key !== selector)) throw new Error('接口查询包含未知参数。')
      return queryApi(value as string | undefined) as JsonValue
    }
  }
}
