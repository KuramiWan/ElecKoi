/** Image positions use only the declared, standalone frame marker and exact frame ID. */
export function generatedImageSegments(content, images, streaming = false) {
  let text = String(content || '');
  if (streaming) text = text.replace(/\[\[IMAGE:(?:\d+\]?)?$/, '');
  const segments = [], used = new Set();
  const marker = /^[\t ]*\[\[IMAGE:(\d+)\]\][\t ]*$/gm;
  let start = 0, match;
  while ((match = marker.exec(text))) {
    const candidates = images.filter(image => image.frameId === Number(match[1]));
    if (candidates.length !== 1 || used.has(candidates[0].id)) continue;
    const before = text.slice(start, match.index);
    if (before.trim()) segments.push({ type: 'text', content: before });
    const image = candidates[0];
    used.add(image.id);
    const previous = segments.at(-1);
    if (previous?.type === 'images' && !before.trim()) previous.images.push(image);
    else segments.push({ type: 'images', images: [image] });
    start = match.index + match[0].length;
  }
  const rest = text.slice(start);
  if (rest.trim()) segments.push({ type: 'text', content: rest });
  const remaining = images.filter(image => !used.has(image.id));
  if (!streaming && remaining.length) segments.push({ type: 'images', images: remaining });
  return segments;
}
