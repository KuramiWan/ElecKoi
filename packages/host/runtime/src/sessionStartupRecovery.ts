import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@eleckoi/dsh-product-api'
import { recoverSessionHistory } from './sessionHistoryRecovery'
import { refreshSessionProjections, type SessionProjectionRefreshContext } from './sessionProjectionRefresh'

/**
 * A stored conversation failure must not prevent the desktop Host from becoming ready.
 * TODO(迁移清理)：recoverSessionHistory 退役时同步移除归档读取及该恢复调用。
 * 官方格式升级、投影重放、句柄关闭与逐会话错误隔离仍保障正常启动，不能整段删掉。
 */
export async function recoverStartupSessions(ctx: Context, root: string): Promise<void> {
  const handles = ctx.get('eleckoiSessionHandles') as {
    withClosed<T>(id: string, action: () => Promise<T>): Promise<T>
  }
  for (const conversation of ctx.eleckoiProductData.readConversationCatalog()) {
    if (!conversation.metadata.characterId) continue
    try {
      const archive = ctx.eleckoiProductData.exportConversationArchive(conversation.id)
      if (!archive.tables.agent_turns?.some(turn => turn.kind === 'user')) continue
      if (!await ctx.sessionPersistence.stat(SessionId(conversation.runtimeSessionId))) continue
      await handles.withClosed(conversation.runtimeSessionId, async () => {
        const probe = await ctx.sessionPersistence.open(SessionId(conversation.runtimeSessionId), 'write')
        await probe.close()
        try {
          await recoverSessionHistory(root, conversation.runtimeSessionId, archive)
        } catch (error) {
          console.error(`DSH Session ${conversation.runtimeSessionId} 旧聊天历史恢复失败：`, error)
        }
        // An unchanged header does not establish that cached watermarks still match the log.
        await refreshSessionProjections(ctx as unknown as SessionProjectionRefreshContext, conversation.runtimeSessionId)
      })
    } catch (error) {
      console.error(`DSH Session ${conversation.runtimeSessionId} 启动恢复失败，继续启动客户端：`, error)
    }
  }
}
