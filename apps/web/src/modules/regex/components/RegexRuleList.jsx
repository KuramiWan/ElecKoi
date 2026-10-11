import { CaretDown, FileCode } from "../../../ui/icons/interfaceIcons.jsx";
import { REGEX_SCOPES, rulesForScope } from "../model/regexRulesEditing.js";
import { useTouchReorder } from '../../../ui/tree/useTouchReorder.js';

function RuleSwitch({ checked, onChange, label }) {
  return (
    <label className="regex-rule-switch" aria-label={label} onDoubleClick={event => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function RegexRuleList({
  collection,
  query,
  selectedId,
  collapsed,
  draggedId,
  onToggleSection,
  onSelect,
  onOpen,
  onToggleRule,
  onMove,
  onDragState,
  touchReorder = false,
  dragEnabled = true,
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const touch = useTouchReorder({ enabled: touchReorder && dragEnabled && !normalizedQuery, onSelect,
    onMove: ({ dragId, parentId, destinationIndex }) => onMove(parentId, dragId, destinationIndex) });

  function matches(rule) {
    if (!normalizedQuery) return true;
    return [rule.name, rule.pattern, rule.replacement].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }

  return (
    <div className="regex-rule-groups" {...touch.handlers}>
      {REGEX_SCOPES.map((scope) => {
        const allRules = rulesForScope(collection, scope.id);
        const visibleRules = allRules.filter(matches);
        const enabledCount = allRules.filter((rule) => rule.enabled).length;
        const isCollapsed = collapsed.has(scope.id) && !normalizedQuery;
        return (
          <section className="regex-rule-group" key={scope.id}>
            <button type="button" className="regex-group-heading" aria-expanded={!isCollapsed} onClick={() => onToggleSection(scope.id)}>
              <CaretDown size={15} className={isCollapsed ? "is-collapsed" : ""} />
              <strong>{scope.label}</strong>
              <span>{enabledCount} / {allRules.length}</span>
            </button>
            {!isCollapsed ? (
              <div className="regex-group-rows">
                {visibleRules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`regex-rule-row${selectedId === rule.id ? " is-selected" : ""}${(draggedId === rule.id || touch.preview?.dragId === rule.id) ? " is-dragging" : ""}`}
                    data-reorder-id={rule.id} data-reorder-parent={scope.id}
                    data-reorder-target={touch.preview?.targetId === rule.id ? (touch.preview.after ? 'after' : 'before') : undefined}
                    onClick={() => onSelect(rule.id)}
                    onDoubleClick={() => onOpen?.(rule.id)}
                    onDragOver={(event) => {
                      if (!dragEnabled || query || !draggedId || draggedId === rule.id) return;
                      event.preventDefault();
                      const targetIndex = allRules.findIndex((item) => item.id === rule.id);
                      onMove(scope.id, draggedId, targetIndex);
                    }}
                  >
                    <div
                      className="regex-rule-main"
                      draggable={dragEnabled && !query}
                      tabIndex={0}
                      aria-label={`${rule.name || "未命名规则"}，拖动排序`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", rule.id);
                        onDragState(rule.id);
                      }}
                      onDragEnd={() => onDragState("")}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(rule.id); return; }
                        if (!dragEnabled || normalizedQuery) return;
                        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                        event.preventDefault();
                        const sourceIndex = allRules.findIndex((item) => item.id === rule.id);
                        onMove(scope.id, rule.id, sourceIndex + (event.key === "ArrowDown" ? 1 : -1));
                      }}
                    >
                      <FileCode size={18} aria-hidden="true" />
                      <span>{rule.name.trim() || "未命名规则"}</span>
                    </div>
                    <RuleSwitch checked={rule.enabled} label={`${rule.name || "未命名规则"}启用状态`} onChange={(enabled) => onToggleRule(scope.id, rule.id, enabled)} />
                  </div>
                ))}
                {visibleRules.length === 0 ? <p className="regex-group-empty">{normalizedQuery ? "没有匹配的规则" : "暂无规则"}</p> : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
