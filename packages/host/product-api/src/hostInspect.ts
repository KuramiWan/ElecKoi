import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import { createApiInspectProvider } from './inspectProvider.js'
import { queryServiceApi } from './cordisApi.generated.js'

/** 随 Host 生命周期把产品接口目录注册到官方 Inspect。 */
export function registerHostApiInspect(ctx: Context) {
  return ctx.inject(['cordisInspect'], scope => scope.cordisInspect.register(createApiInspectProvider(
    'ElecKoi.Service', 'ElecKoi Host 公开服务的调用说明和数据类型。', 'key', queryServiceApi
  )))
}
