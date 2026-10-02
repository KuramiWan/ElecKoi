const FinalOpenTag = '<FINAL>'
const FinalCloseTag = '</FINAL>'

/** Extract the roleplay reply body recorded in the official assistant message. */
export function finalReplyText(value: string): string {
  const markerIndex = value.indexOf(FinalOpenTag)
  if (markerIndex < 0) return value
  const content = value.slice(markerIndex + FinalOpenTag.length).replace(/^(?:\r\n|\r|\n)/, '')
  const closingIndex = content.indexOf(FinalCloseTag)
  return (closingIndex < 0 ? content : content.slice(0, closingIndex))
    .replace(/(?:\r\n|\r|\n)$/, '')
}
