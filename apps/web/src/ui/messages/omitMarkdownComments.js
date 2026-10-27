import { fromMarkdown } from 'mdast-util-from-markdown';

/** Remove comment nodes from the display copy; Markdown code and escaped examples remain literal. */
export function omitMarkdownComments(source, preserve = () => false) {
  if (!source.includes('<!--')) return source;
  const pending = [fromMarkdown(source)], ranges = [];
  while (pending.length) {
    const node = pending.pop();
    if (node.type === 'html' && node.value.startsWith('<!--')) {
      const raw = source.slice(node.position.start.offset, node.position.end.offset);
      for (const match of raw.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
        const start = node.position.start.offset + match.index;
        if (!preserve(match[0])) ranges.push([start, start + match[0].length]);
      }
    }
    if (node.children) for (const child of node.children) pending.push(child);
  }
  let result = '', cursor = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    result += source.slice(cursor, start);
    cursor = end;
  }
  return result + source.slice(cursor);
}
