export function selectableTreeIds(nodes) {
  return nodes.flatMap(node => [...(node.fixed ? [] : [node.id]), ...selectableTreeIds(node.children || [])]);
}

export function visibleTreeSelectionIds(nodes, query) {
  const term = query.trim().toLocaleLowerCase();
  const visit = node => {
    const children = (node.children || []).flatMap(visit);
    const match = !term || String(node.searchText || node.label).toLocaleLowerCase().includes(term);
    return [...(!node.fixed && (match || children.length) ? [node.id] : []), ...children];
  };
  return nodes.flatMap(visit);
}

/** A selected folder already includes its descendants in copy and delete operations. */
export function selectedTreeRootIds(nodes, selected) {
  const visit = node => selected.has(node.id) && !node.fixed ? [node.id] : (node.children || []).flatMap(visit);
  return nodes.flatMap(visit);
}
