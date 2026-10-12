export const HTML_RESOURCES_BUNDLE = '@eleckoi/dsh-client-html-resources'
const obsoleteBundles = ['@eleckoi/dsh-client-tavern-shared', '@eleckoi/dsh-compatibility-host']

/** Replace the retired pair only when both halves were enabled; preserve user-disabled resources. */
export function replaceHtmlResourceBundles(selected: readonly string[]): string[] {
  const enabled = obsoleteBundles.every(name => selected.includes(name))
  const result: string[] = []
  for (const name of selected) {
    if (obsoleteBundles.includes(name)) {
      if (enabled && !result.includes(HTML_RESOURCES_BUNDLE)) result.push(HTML_RESOURCES_BUNDLE)
    } else if (!result.includes(name)) result.push(name)
  }
  return result
}
