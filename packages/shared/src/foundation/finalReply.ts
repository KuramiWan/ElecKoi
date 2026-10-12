import { richDisplayReplacementRanges } from './richMessage'

const FinalOpenTag = '<FINAL>'
const FinalCloseTag = '</FINAL>'

/** Project display text after regex processing; the final opening starts ordinary text, never limits rich replacements. */
export function finalReplyText(value: string, options: { streaming?: boolean; bodyStart?: number } = {}): string {
  const ranges = richDisplayReplacementRanges(value)
  let opening = value.indexOf(FinalOpenTag)
  for (const range of ranges) {
    if (opening < 0 || opening < range.start) break
    if (opening < range.end) opening = value.indexOf(FinalOpenTag, range.end)
  }
  const bodyStart = options.bodyStart ?? (opening >= 0 ? opening + FinalOpenTag.length
    : options.streaming ? value.length : 0)
  const prefix = ranges.filter(range => range.end <= bodyStart).map(range => value.slice(range.start, range.end))
  const clean = (text: string) => text.replace(/<FINAL>(?:\r\n|\r|\n)?/g, '')
    .replace(/(?:\r\n|\r|\n)?<\/FINAL>/g, '')
  let body = ''
  let cursor = bodyStart
  for (const range of ranges) {
    if (range.end <= cursor) continue
    body += clean(value.slice(cursor, range.start)) + value.slice(range.start, range.end)
    cursor = range.end
  }
  let tail = value.slice(cursor)
  if (options.streaming) {
    for (let length = FinalCloseTag.length - 1; length > 0; length -= 1) {
      if (!tail.endsWith(FinalCloseTag.slice(0, length))) continue
      tail = tail.slice(0, -length)
      break
    }
  }
  body = (body + clean(tail)).replace(/^(?:\r\n|\r|\n)/, '').replace(/(?:\r\n|\r|\n)$/, '')
  return [...prefix, ...(body ? [body] : [])].join('\n')
}
