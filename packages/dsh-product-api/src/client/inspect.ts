import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cordis-client-runner/client'
import { createApiInspectProvider } from '../inspectProvider.js'
import { queryServiceApi } from './cordisApi.generated.js'
import { queryServiceApi as queryHostServiceApi } from '../cordisApi.generated.js'
import { REMOTE_API, REMOTE_DECLARATION } from './remoteApi.generated.js'

/** 随 Client 生命周期把产品接口目录注册到官方 Inspect。 */
export function registerClientApiInspect(ctx: Context) {
  return ctx.inject(['cordisInspect'], scope => {
    const disposeService = scope.cordisInspect.register(createApiInspectProvider(
      'ElecKoi.Service', 'ElecKoi Client 公开服务的调用说明和数据类型。', 'key', queryServiceApi
    ))
    let disposeRemote: (() => void) | undefined
    try {
      disposeRemote = scope.cordisInspect.register(createApiInspectProvider(
        'ElecKoi.Remote', 'ElecKoi 官方 Host-for-Client Remote 调用声明。', 'namespace', namespace => {
          if (namespace === undefined) return { mode: 'catalog', namespaces: REMOTE_API }
          const entry = REMOTE_API.find(row => row.namespace === namespace)
          if (!entry) throw new Error(`不存在公开的 Remote namespace：${namespace}`)
          const host = queryHostServiceApi(entry.hostService) as { referencedTypes: object[] }
          return { mode: 'namespace', namespace, methods: entry.methods,
            declaration: REMOTE_DECLARATION, referencedTypes: host.referencedTypes,
            access: { inject: ['remote', `remote.${namespace}`], expression: `ctx.remote.${namespace}` } }
        }
      ))
    } catch (error) {
      disposeService()
      throw error
    }
    return () => { disposeRemote?.(); disposeService() }
  })
}
