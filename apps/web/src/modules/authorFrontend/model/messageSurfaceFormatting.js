import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes';
import { DesktopError } from '@shared/foundation/DesktopError';

/** Terminal HTML formatting after the shared SDK has expanded macros and regexes. */
export function createMessageSurfaceFormatter(view) {
  if (!view.showdown?.Converter) throw new DesktopError(ELECKOI_FAILURE_CODES.lifecycleNotReady, '消息显示 Markdown 渲染库尚未就绪', { what: '消息显示 Markdown 渲染库' });
  const converter = new view.showdown.Converter();
  return text => converter.makeHtml(String(text ?? ''));
}
