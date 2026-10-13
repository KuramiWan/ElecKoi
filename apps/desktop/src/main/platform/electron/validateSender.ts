import type { WebContents } from 'electron'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export function isAppRendererUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    if (developmentUrl !== undefined) {
      return candidate.origin === new URL(developmentUrl).origin
    }
    if (candidate.protocol !== 'file:') return false
    const path = decodeURIComponent(candidate.pathname).replaceAll('\\', '/')
    return path.endsWith('/out/renderer/index.html')
  } catch {
    return false
  }
}

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    return candidate.protocol === 'https:'
  } catch {
    return false
  }
}

export function isDshAppUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    return candidate.protocol === 'dsh-app:' && candidate.hostname === 'app'
      && candidate.username === '' && candidate.password === '' && candidate.port === ''
  } catch {
    return false
  }
}

export function isDshChildUrl(url: string): boolean {
  try {
    const candidate = new URL(url)
    if (!isDshAppUrl(url) || candidate.pathname !== '/' || candidate.hash) return false
    const view = candidate.searchParams.get('view')
    if (view === 'character-editor' || view === 'chat') {
      const key = view === 'chat' ? 'chat' : 'character'
      return candidate.searchParams.size === 2 && Boolean(candidate.searchParams.get(key))
    }
    return (view === 'creator-studio' || view === 'character-manager' || view === 'preset-manager')
      && candidate.searchParams.size === 1
  } catch {
    return false
  }
}

/**
 * 边界⑤ 的活守卫：发送方必须属于本应用窗口集合，且是 `dsh-app://app` 的主框架（或四个受控子路由之一）。
 *
 * 拒绝时抛契约码 `eleckoi/sender/untrusted`（ADR 0002 决定 14），详情按参数名闭集给：
 * `guard` 说清是哪条守卫拒绝的、`what` 是观察到的发送方帧。
 *
 * ⚠️ 本文件里那个零调用者的 legacy 渲染层发送方断言已删除（ADR 0017 的遗留；ADR 0002 实现订正 h
 * 与票 EH-5 第 1 节）。它的名字不再出现在 `apps/` 与 `tests/` 里——票的判据是
 * `grep -rn "<旧导出名>" apps/ tests/` 期望空，所以这里也不留它的名字（留了那条判据就会假红）。
 */
export function assertTrustedDshClientFrame(
  sender: WebContents,
  frameUrl: string,
  isMainFrame: boolean,
  trustedWindowSenders: readonly WebContents[]
): void {
  if (!trustedWindowSenders.includes(sender) || !isMainFrame || frameUrl !== sender.getURL()
    || !isDshAppUrl(frameUrl)
    || (new URL(frameUrl).pathname !== '/')
    || (new URL(frameUrl).search !== '' && !isDshChildUrl(frameUrl))) {
    throw new DesktopError(
      ELECKOI_FAILURE_CODES.senderUntrusted,
      '拒绝来自非 ElecKoi DSH 页面进程的桌面调用。',
      { guard: 'assertTrustedDshClientFrame', what: frameUrl === '' ? '(senderFrame 缺失)' : frameUrl }
    )
  }
}
