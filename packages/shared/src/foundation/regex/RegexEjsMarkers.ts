import { ELECKOI_FAILURE_CODES } from '../../contracts/errors/codes'
import { DesktopError } from '../DesktopError'
export const REGEX_EJS_START = '<!-- eleckoi:regex-ejs:start -->'
export const REGEX_EJS_END = '<!-- eleckoi:regex-ejs:end -->'

export function hasRegexEjsOutput(content: string): boolean { return content.includes(REGEX_EJS_START) }

/** Keep literal template text outside authored replacements from becoming executable code. */
export function prepareRegexEjsSource(content: string): string {
  let source = '', cursor = 0, depth = 0
  for (const marker of content.matchAll(/<!-- eleckoi:regex-ejs:(start|end) -->/g)) {
    const text = content.slice(cursor, marker.index)
    source += depth ? text : text.replaceAll('<%', '<%%')
    depth += marker[1] === 'start' ? 1 : -1
    if (depth < 0) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '正则替换后的 EJS 边界不完整。', { field: '正则替换后的 EJS 边界' })
    cursor = marker.index + marker[0].length
  }
  if (depth) throw new DesktopError(ELECKOI_FAILURE_CODES.inputInvalid, '正则替换后的 EJS 边界不完整。', { field: '正则替换后的 EJS 边界' })
  return source + content.slice(cursor).replaceAll('<%', '<%%')
}
