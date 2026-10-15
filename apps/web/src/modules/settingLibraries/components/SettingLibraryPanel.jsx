import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ChatCircleDots,
  Code,
  Copy,
  FileText,
  LinkSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  Trash,
} from "../../../ui/icons/interfaceIcons.jsx";
import { DshFolderClosedIcon } from "../../../ui/icons/dshTreeIcons.jsx";
import { SETTING_LIBRARY_CREATE_ICONS } from "../../../ui/icons/settingLibraryCreateIcons.jsx";
import { SettingLibraryManager } from "./SettingLibraryManager.jsx";
import { ConfirmationDialog, SaveControl } from "./SettingLibraryControls.jsx";
import { SettingLibraryInspector } from "./SettingLibraryInspector.jsx";
import { SettingLibraryTree, SettingTreeActionsContext } from "./SettingLibraryTree.jsx";
import { EditorSidebarLayout } from "../../../ui/ui/EditorSidebarLayout.jsx";
import { useEditorPresentation } from '../../../ui/ui/EditorPresentationContext.jsx';
import { MobileEditorActions } from '../../../ui/ui/MobileEditorActions.jsx';
import { EditorCollectionToolbar, EditorSelectionBar, useEditorMultiSelect } from '../../../ui/ui/EditorCollectionControls.jsx';
import { selectableTreeIds, selectedTreeRootIds, visibleTreeSelectionIds } from '../../../ui/ui/editorCollectionSelection.js';
import {
  PINNED_ENTRY_IDS,
  canTransferSettingNode,
  copySettingNode,
  createEntryDraft,
  createGroupDraft,
  createId,
  deleteOpening,
  moveTreeNode,
  uniqueName,
} from "../model/settingLibraryEditing.js";
import {
  descendants,
  findSelected,
  hasSearchResults,
  nodeKey,
  parseNodeKey,
  treeNodes,
} from "../model/settingLibraryTree.js";

const CreateFolderIcon = SETTING_LIBRARY_CREATE_ICONS.group;
const CreateEntryIcon = SETTING_LIBRARY_CREATE_ICONS.entry;
const CreateReferenceIcon = SETTING_LIBRARY_CREATE_ICONS.reference;

function nodeIcon(entry) {
  if (entry?.kind === "opening") return ChatCircleDots;
  if (entry?.contentMode === "ejs") return Code;
  if (entry?.dynamicMode === "ejs_reference") return LinkSimple;
  return FileText;
}

export const SettingLibraryPanel = forwardRef(function SettingLibraryPanel({ characterId, settingLibraries, variables, onDirtyChange }, ref) {
  const { compact } = useEditorPresentation();
  const [library, setLibrary] = useState(null);
  const [variableSnapshot, setVariableSnapshot] = useState({ value: null, error: "" });
  const [persisted, setPersisted] = useState(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [clipboard, setClipboard] = useState(null);
  const [expandedKeys, setExpandedKeys] = useState([]);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const nameInputRef = useRef(null);
  const libraryRef = useRef(null);
  const persistedRef = useRef(null);
  const expandedKeysRef = useRef([]);
  const savePromiseRef = useRef(null);
  const dirty = useMemo(() => JSON.stringify(library) !== JSON.stringify(persisted), [library, persisted]);
  const selected = useMemo(() => findSelected(library, selectedKey), [library, selectedKey]);
  const nodes = useMemo(() => treeNodes(library), [library]);
  const searchHasResults = useMemo(() => library ? hasSearchResults(library, query) : false, [library, query]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    expandedKeysRef.current = expandedKeys;
  }, [expandedKeys]);

  useEffect(() => {
    if (saveNotice !== "saved") return undefined;
    const timeout = window.setTimeout(() => setSaveNotice(""), 1600);
    return () => window.clearTimeout(timeout);
  }, [saveNotice]);

  useEffect(() => {
    let active = true;
    setError("");
    setSaveNotice("");
    libraryRef.current = null;
    persistedRef.current = null;
    setLibrary(null);
    setPersisted(null);
    setSelectedKey("");
    setManagerOpen(false);
    const adopt = (loaded) => {
      if (!active || savePromiseRef.current || (libraryRef.current && persistedRef.current
        && JSON.stringify(libraryRef.current) !== JSON.stringify(persistedRef.current))) return;
      libraryRef.current = loaded;
      persistedRef.current = loaded;
      setLibrary(loaded);
      setPersisted(loaded);
      const expanded = loaded.expandedGroupIds.map((id) => nodeKey("group", id));
      expandedKeysRef.current = expanded;
      setExpandedKeys(expanded);
    };
    const stop = settingLibraries.subscribe((kind, id, snapshot) => {
      if (kind === "configuration" && id === characterId && snapshot.status === "ready") adopt(snapshot.value);
    });
    const cached = settingLibraries.getSnapshot(characterId);
    if (cached.status === "ready") adopt(cached.value);
    void settingLibraries.read(characterId).catch((cause) => {
      if (active) setError(cause?.message || "读取设定库失败");
    });
    return () => { active = false; stop(); };
  }, [characterId, settingLibraries]);

  useEffect(() => {
    let active = true;
    setVariableSnapshot({ value: null, error: "" });
    if (!variables) return undefined;
    const adopt = (snapshot) => { if (active) setVariableSnapshot(snapshot); };
    adopt(variables.getSnapshot(characterId));
    const stop = variables.subscribe((kind, id, snapshot) => {
      if (kind === "configuration" && id === characterId) adopt(snapshot);
    });
    void variables.read(characterId).catch((cause) => {
      if (active) setVariableSnapshot((current) => ({ ...current, error: cause?.message || "读取变量版本失败" }));
    });
    return () => { active = false; stop(); };
  }, [characterId, variables]);

  function changeLibrary(updater) {
    setError("");
    setSaveNotice("");
    setLibrary((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      libraryRef.current = next;
      return next;
    });
  }

  async function save() {
    if (!libraryRef.current) return false;
    if (savePromiseRef.current) {
      const inFlight = savePromiseRef.current;
      const saved = await inFlight;
      if (savePromiseRef.current === inFlight) savePromiseRef.current = null;
      if (!saved) return false;
      if (JSON.stringify(libraryRef.current) !== JSON.stringify(persistedRef.current)) return save();
      return true;
    }

    const task = (async () => {
      const snapshot = libraryRef.current;
      setSaving(true);
      setError("");
      setSaveNotice("");
      try {
        const saved = await settingLibraries.save(characterId, {
          ...snapshot,
          listAllExpanded: false,
          expandedGroupIds: expandedKeysRef.current.map(parseNodeKey).filter((item) => item.kind === "group").map((item) => item.id),
        });
        persistedRef.current = saved;
        setPersisted(saved);
        if (libraryRef.current === snapshot) {
          libraryRef.current = saved;
          setLibrary(saved);
          setSaveNotice("saved");
        }
        return true;
      } catch (cause) {
        setError(cause?.message || "保存设定库失败");
        return false;
      } finally {
        setSaving(false);
      }
    })();

    savePromiseRef.current = task;
    try {
      return await task;
    } finally {
      if (savePromiseRef.current === task) savePromiseRef.current = null;
    }
  }

  function discard() {
    libraryRef.current = persistedRef.current;
    setLibrary(persistedRef.current);
    setError("");
    setSaveNotice("");
  }

  function requestCloseInspector() {
    if (compact) setEditing(false);
    else setSelectedKey('');
  }

  function selectNode(key) {
    setSelectedKey(key);
    setEditing(false);
  }

  function openEditor(key = selectedKey) {
    setSelectedKey(key);
    setEditing(true);
  }

  function startTransfer(mode) {
    if (!selected.value || PINNED_ENTRY_IDS.has(selected.value.id)) return;
    setClipboard({ mode, target: { kind: selected.kind, id: selected.value.id } });
    selectNode('');
  }

  function pasteSelection() {
    const parentId = parentForNewNode();
    if (!clipboard || !canTransferSettingNode(libraryRef.current, clipboard.target, parentId)) {
      setError('不能粘贴到此文件夹，请选择其他位置。');
      return;
    }
    if (clipboard.mode === 'cut') {
      handleMove({ dragId: nodeKey(clipboard.target.kind, clipboard.target.id), parentId: parentId ? nodeKey('group', parentId) : '',
        destinationIndex: Number.MAX_SAFE_INTEGER, expandParentId: parentId ? nodeKey('group', parentId) : '' });
      setSelectedKey(nodeKey(clipboard.target.kind, clipboard.target.id));
    } else {
      const copied = copySettingNode(libraryRef.current, clipboard.target, parentId);
      changeLibrary(copied.library);
      setSelectedKey(copied.key);
      if (parentId) handleExpandedKeysChange([...new Set([...expandedKeysRef.current, nodeKey('group', parentId)])]);
    }
    setClipboard(null);
  }

  function applyManagerChange(nextLibrary) {
    changeLibrary(nextLibrary);
    const nextExpanded = nextLibrary.expandedGroupIds.map((id) => nodeKey("group", id));
    expandedKeysRef.current = nextExpanded;
    setExpandedKeys(nextExpanded);
    setSelectedKey("");
  }

  function requestSelection(key, contextMenuAfterSelection = null) {
    const nextKey = String(key || "");
    if (!nextKey) {
      setSelectedKey("");
      if (contextMenuAfterSelection) setContextMenu(contextMenuAfterSelection);
      return;
    }
    if (nextKey === selectedKey) {
      if (contextMenuAfterSelection) setContextMenu(contextMenuAfterSelection);
      return;
    }
    setSelectedKey(nextKey);
    if (contextMenuAfterSelection) setContextMenu(contextMenuAfterSelection);
  }

  useEffect(() => {
    function handleSaveShortcut(event) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== "s") return;
      event.preventDefault();
      if (dirty && !saving) void save();
    }

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [characterId, dirty, expandedKeys, library, saving]);

  useImperativeHandle(ref, () => ({ save, discard }), [library, persisted, expandedKeys, saving]);

  function updateEntryById(id, updater) {
    changeLibrary((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === id
        ? (typeof updater === "function" ? updater(entry) : { ...entry, ...updater })
        : entry),
    }));
  }

  function updateGroup(patch) {
    if (selected.kind !== "group" || !selected.value) return;
    changeLibrary((current) => ({ ...current, groups: current.groups.map((group) => group.id === selected.value.id ? { ...group, ...patch } : group) }));
  }

  function parentForNewNode() {
    if (selected.kind === "group") return selected.value?.id || "";
    if (selected.kind === "entry") return selected.value?.groupId || "";
    return "";
  }

  function requestAddNode(kind, parentOverride) {
    const parentId = parentOverride ?? parentForNewNode();
    const sourceLibrary = libraryRef.current;
    if (!sourceLibrary) return;
    const order = 1 + Math.max(0,
      ...sourceLibrary.groups.filter((group) => group.parentId === parentId).map((group) => group.treeViewOrder),
      ...sourceLibrary.entries.filter((entry) => entry.groupId === parentId).map((entry) => entry.treeViewOrder),
    );
    let nextLibrary;
    let nextKey;
    if (kind === "group") {
      const names = new Set(sourceLibrary.groups.filter((group) => group.parentId === parentId).map((group) => group.name));
      const group = createGroupDraft(parentId, order, names);
      nextLibrary = { ...sourceLibrary, groups: [...sourceLibrary.groups, group] };
      nextKey = nodeKey("group", group.id);
    } else {
      const entry = createEntryDraft(parentId, order, sourceLibrary.entries, kind === "reference" ? "reference" : "standard");
      nextLibrary = { ...sourceLibrary, entries: [...sourceLibrary.entries, entry] };
      nextKey = nodeKey("entry", entry.id);
    }
    if (parentId) {
      const parentKey = nodeKey("group", parentId);
      const nextExpanded = [...new Set([...expandedKeysRef.current, parentKey])];
      const nextGroupIds = nextExpanded.map(parseNodeKey).filter((item) => item.kind === "group").map((item) => item.id);
      expandedKeysRef.current = nextExpanded;
      setExpandedKeys(nextExpanded);
      nextLibrary = {
        ...nextLibrary,
        listAllExpanded: false,
        expandedGroupIds: nextGroupIds,
        versions: nextLibrary.versions.map((version) => version.id === nextLibrary.activeVersionId
          ? { ...version, listAllExpanded: false, expandedGroupIds: nextGroupIds }
          : version),
      };
    }
    changeLibrary(nextLibrary);
    setMenuOpen(false);
    setContextMenu(null);
    openEditor(nextKey);
    requestAnimationFrame(() => nameInputRef.current?.select());
  }

  function askDelete(kind, id) {
    const value = kind === "group" ? library.groups.find((group) => group.id === id) : library.entries.find((entry) => entry.id === id);
    if (!value || PINNED_ENTRY_IDS.has(id)) return;
    const name = kind === "group" ? value.name : value.title;
    const isReference = kind === "entry" && value.dynamicMode === "ejs_reference";
    setDeleteTarget({
      kind,
      id,
      title: kind === "group" ? `删除“${name}”？` : isReference ? "删除这条 EJS引用设定？" : `删除“${name || "未命名设定"}”？`,
      message: kind === "group"
        ? "文件夹内的设定也会一起删除。"
        : isReference ? `使用它的控制器将无法再通过 getwi 读取“${name || "未命名 EJS引用设定"}”。` : "此操作会在保存后生效。",
    });
    setContextMenu(null);
  }

  function askDeleteOpening(message) {
    setDeleteTarget({
      kind: "opening",
      id: selected.value.id,
      messageId: message.id,
      title: `删除“${message.title || "未命名开场白"}”？`,
      message: "这条开场白会从角色设定中移除。",
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'batch') {
      const targets = deleteTarget.ids.map(parseNodeKey);
      changeLibrary(current => {
        const groups = new Set(targets.filter(target => target.kind === 'group').flatMap(target => [...descendants(current.groups, target.id)]));
        const entries = new Set(targets.filter(target => target.kind === 'entry').map(target => target.id));
        return { ...current, groups: current.groups.filter(group => !groups.has(group.id)),
          entries: current.entries.filter(entry => PINNED_ENTRY_IDS.has(entry.id) || !groups.has(entry.groupId) && !entries.has(entry.id)) };
      });
      selectNode(''); setDeleteTarget(null); multi.clear(); return;
    }
    if (deleteTarget.kind === "opening") {
      updateEntryById(deleteTarget.id, (entry) => deleteOpening(entry, deleteTarget.messageId));
      setDeleteTarget(null);
      return;
    }
    changeLibrary((current) => {
      if (deleteTarget.kind === "entry") return { ...current, entries: current.entries.filter((entry) => entry.id !== deleteTarget.id) };
      const removed = descendants(current.groups, deleteTarget.id);
      return {
        ...current,
        groups: current.groups.filter((group) => !removed.has(group.id)),
        entries: current.entries.filter((entry) => !removed.has(entry.groupId)),
      };
    });
    selectNode(compact ? "" : nodeKey("entry", "fixed-opening-assistant"));
    setDeleteTarget(null);
  }

  function duplicateEntry(id) {
    const source = library.entries.find((entry) => entry.id === id);
    if (!source || PINNED_ENTRY_IDS.has(id)) return;
    const timestamp = new Date().toISOString();
    const names = new Set(library.entries.filter((entry) => entry.groupId === source.groupId).map((entry) => entry.title));
    const title = uniqueName(source.title ? `${source.title} 副本` : "新建设定", names);
    const entry = {
      ...source,
      id: createId("setting"),
      title,
      treeViewOrder: Math.max(0, ...library.entries.filter((item) => item.groupId === source.groupId).map((item) => item.treeViewOrder)) + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    changeLibrary((current) => ({ ...current, entries: [...current.entries, entry] }));
    setSelectedKey(nodeKey("entry", entry.id));
    setContextMenu(null);
  }

  function handleMove({ dragId, parentId, destinationIndex, expandParentId }) {
    const moved = parseNodeKey(dragId);
    const destinationParentId = parentId ? parseNodeKey(parentId).id : "";
    if (!moved.id || PINNED_ENTRY_IDS.has(moved.id)) return;
    const expandedParentKey = expandParentId || "";
    const nextExpandedKeys = expandedParentKey
      ? [...new Set([...expandedKeysRef.current, expandedParentKey])]
      : expandedKeysRef.current;
    const nextGroupIds = nextExpandedKeys.map(parseNodeKey).filter((item) => item.kind === "group").map((item) => item.id);
    if (expandedParentKey) {
      expandedKeysRef.current = nextExpandedKeys;
      setExpandedKeys(nextExpandedKeys);
    }
    changeLibrary((current) => {
      const next = moveTreeNode(current, moved, destinationParentId, destinationIndex);
      if (!expandedParentKey) return next;
      return {
        ...next,
        listAllExpanded: false,
        expandedGroupIds: nextGroupIds,
        versions: next.versions.map((version) => version.id === next.activeVersionId
          ? { ...version, listAllExpanded: false, expandedGroupIds: nextGroupIds }
          : version),
      };
    });
  }

  function handleExpandedKeysChange(nextKeys) {
    const nextGroupIds = nextKeys.map(parseNodeKey).filter((item) => item.kind === "group").map((item) => item.id);
    const applyViewState = (value) => value ? {
      ...value,
      listAllExpanded: false,
      expandedGroupIds: nextGroupIds,
      versions: value.versions.map((version) => version.id === value.activeVersionId
        ? { ...version, listAllExpanded: false, expandedGroupIds: nextGroupIds }
        : version),
    } : value;
    expandedKeysRef.current = nextKeys;
    setExpandedKeys(nextKeys);
    libraryRef.current = applyViewState(libraryRef.current);
    persistedRef.current = applyViewState(persistedRef.current);
    setLibrary((current) => applyViewState(current));
    setPersisted((current) => applyViewState(current));
    void settingLibraries.saveViewState(characterId, nextGroupIds).catch(() => {});
  }

  function openContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();
    if (compact) { selectNode(String(node.key)); return; }
    setMenuOpen(false);
    if (node.fixed) {
      setContextMenu({
        x: Math.min(event.clientX, window.innerWidth - 176),
        y: Math.min(event.clientY, window.innerHeight - 126),
        kind: "background",
        id: "",
        parentId: "",
      });
      return;
    }
    const nextContextMenu = {
      x: Math.min(event.clientX, window.innerWidth - 176),
      y: Math.min(event.clientY, window.innerHeight - 190),
      kind: node.nodeKind,
      id: node.recordId,
      parentId: node.nodeKind === "group"
        ? node.recordId
        : library.entries.find((entry) => entry.id === node.recordId)?.groupId || "",
    };
    requestSelection(String(node.key), nextContextMenu);
  }

  function openTreeContextMenu(event) {
    event.preventDefault();
    if (!libraryRef.current) return;
    setMenuOpen(false);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 176),
      y: Math.min(event.clientY, window.innerHeight - 126),
      kind: "background",
      id: "",
      parentId: "",
    });
  }

  function handleTreeMouseDown(event) {
    setContextMenu(null);
    if (event.button !== 0 || event.target.closest('[role="treeitem"]')) return;
    const tree = event.currentTarget;
    const treeRect = tree.getBoundingClientRect();
    const scrollbarHitWidth = Math.max(16, tree.offsetWidth - tree.clientWidth + 4);
    if (event.clientX >= treeRect.right - scrollbarHitWidth && event.clientX <= treeRect.right + 2) return;
    selectNode('');
  }

  const selectedIcon = selected.kind === "group" ? DshFolderClosedIcon : nodeIcon(selected.value);
  const SelectedIcon = selectedIcon || FileText;
  const multi = useEditorMultiSelect(selectableTreeIds(nodes), characterId);
  function copySelected() {
    const targets = selectedTreeRootIds(nodes, multi.selected).map(parseNodeKey);
    changeLibrary(current => targets.reduce((next, target) => {
      const value = target.kind === 'group' ? next.groups.find(item => item.id === target.id) : next.entries.find(item => item.id === target.id);
      return copySettingNode(next, target, target.kind === 'group' ? value.parentId : value.groupId).library;
    }, current));
    multi.clear();
  }
  function askDeleteBatch() { setDeleteTarget({ kind: 'batch', ids: selectedTreeRootIds(nodes, multi.selected), title: `删除选中的 ${multi.selected.size} 项？`, message: '所选文件夹及其内容会在保存后删除。' }); }
  const createItems = [{ label: '文件夹', Icon: CreateFolderIcon, run: () => requestAddNode('group') },
    { label: '设定', Icon: CreateEntryIcon, run: () => requestAddNode('entry') },
    { label: 'EJS引用设定', Icon: CreateReferenceIcon, run: () => requestAddNode('reference') }];
  const inspector = !multi.active && selected.value && (!compact || editing) ? (
    <SettingLibraryInspector
      selected={selected}
      library={library}
      variableVersions={variableSnapshot.value?.versions || []}
      variableVersionsError={variableSnapshot.error}
      allowCustomPromptPositions={false}
      nameInputRef={nameInputRef}
      SelectedIcon={SelectedIcon}
      onClose={requestCloseInspector}
      onUpdateGroup={updateGroup}
      onDeleteGroup={() => askDelete("group", selected.value.id)}
      onUpdateEntry={(entry) => updateEntryById(entry.id, entry)}
      onEntriesChange={(entries) => changeLibrary((current) => ({ ...current, entries }))}
      onOpenEntry={(entryId) => openEditor(nodeKey("entry", entryId))}
      onRequestDeleteOpening={askDeleteOpening}
      onPromptPositionsChange={(promptPositions, entries = library.entries) => changeLibrary((current) => ({ ...current, promptPositions, entries }))}
    />
  ) : null;

  return (
    <EditorSidebarLayout
      className={`setting-library-layout${multi.active ? ' is-multiselect' : ''}`}
      inspector={inspector}
      inspectorTitle={selected.kind === 'group' ? '编辑文件夹' : selected.value?.title || '编辑设定'}
      onCloseInspector={requestCloseInspector}
      feedback={<SaveControl dirty={dirty} error={error} notice={saveNotice} saving={saving} onSave={save} />}
      aria-label="设定库"
      onMouseDown={() => setMenuOpen(false)}
    >
      <div className="setting-library-browser editor-collection-browser">
        <EditorCollectionToolbar query={query} onQueryChange={setQuery} placeholder="搜索设定" selection={{ ...multi, toggle: () => { multi.toggle(); selectNode(''); setEditing(false); setContextMenu(null); } }} disabled={saving || !library}
          createItems={createItems}
          onManage={() => setManagerOpen(true)} save={<SaveControl dirty={dirty} error={error} notice={saveNotice} saving={saving} onSave={save} />} />
        <EditorSelectionBar selection={multi} visibleIds={visibleTreeSelectionIds(nodes, query)} disabled={saving} onCopy={copySelected} onDelete={askDeleteBatch} />

        <div className="setting-library-tree editor-sidebar-directory" onMouseDown={handleTreeMouseDown} onContextMenu={openTreeContextMenu}>
          <SettingTreeActionsContext.Provider value={{ openContextMenu, updateEntryById, selection: multi, saving, openEditor: compact && !multi.active ? openEditor : undefined }}>
            <SettingLibraryTree
              key={characterId}
              nodes={nodes}
              touchReorder={compact && !clipboard && !multi.active}
              dragEnabled={!clipboard && !multi.active}
              query={query}
              selectedId={multi.active ? '' : selectedKey}
              expandedIds={expandedKeys}
              onSelectedIdChange={key => { if (multi.active) { if (selectableTreeIds(nodes).includes(key)) multi.check(key, !multi.selected.has(key)); } else selectNode(key); }}
              onExpandedIdsChange={handleExpandedKeysChange}
              onMove={handleMove}
              ariaLabel="设定文件夹树"
            />
          </SettingTreeActionsContext.Provider>
          {!library ? <p className="setting-library-loading" role={error ? 'alert' : 'status'}>{error || '正在读取…'}</p> : !searchHasResults ? <p className="setting-library-empty">没有匹配的设定</p> : null}
        </div>
        {compact && library && !multi.active && <MobileEditorActions label="设定操作" selectionId={selectedKey} busy={saving} createItems={createItems}
          canEdit={Boolean(selected.value)} canModify={Boolean(selected.value) && !PINNED_ENTRY_IDS.has(selected.value.id)}
          clipboard={clipboard} canPaste={Boolean(clipboard && canTransferSettingNode(library, clipboard.target, parentForNewNode()))}
          onEdit={() => openEditor()} onMove={() => startTransfer('cut')} onPaste={pasteSelection} onCancel={() => setClipboard(null)}
          onDelete={() => askDelete(selected.kind, selected.value.id)}
          moreItems={selected.value && !PINNED_ENTRY_IDS.has(selected.value.id) ? [
            { label: '复制', Icon: Copy, run: () => startTransfer('copy') },
            { label: '重命名', Icon: PencilSimple, run: () => { openEditor(); requestAnimationFrame(() => nameInputRef.current?.select()); } },
          ] : []} />}
      </div>

      {managerOpen ? (
        <SettingLibraryManager
          characterId={characterId}
          settingLibraries={settingLibraries}
          library={library}
          onChange={applyManagerChange}
          onClose={() => setManagerOpen(false)}
          onError={setError}
        />
      ) : null}

      {contextMenu ? (
        <div className="setting-library-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onMouseDown={(event) => event.stopPropagation()}>
          {contextMenu.kind === "background" || contextMenu.kind === "group" ? (
            <>
              <button type="button" role="menuitem" onClick={() => requestAddNode("group", contextMenu.parentId)}><CreateFolderIcon size={15} />新建文件夹</button>
              <button type="button" role="menuitem" onClick={() => requestAddNode("entry", contextMenu.parentId)}><CreateEntryIcon size={15} />新建设定</button>
              <button type="button" role="menuitem" onClick={() => requestAddNode("reference", contextMenu.parentId)}><CreateReferenceIcon size={15} />新建 EJS引用设定</button>
            </>
          ) : null}
          {contextMenu.kind === "entry" ? <button type="button" role="menuitem" onClick={() => duplicateEntry(contextMenu.id)}><Copy size={15} />复制</button> : null}
          {contextMenu.kind !== "background" ? <button type="button" role="menuitem" onClick={() => { setContextMenu(null); requestAnimationFrame(() => nameInputRef.current?.select()); }}><PencilSimple size={15} />重命名</button> : null}
          {contextMenu.kind !== "background" ? <button type="button" role="menuitem" className="is-destructive" onClick={() => askDelete(contextMenu.kind, contextMenu.id)}><Trash size={15} />删除</button> : null}
        </div>
      ) : null}
      <ConfirmationDialog target={deleteTarget} confirmLabel="删除" tone="destructive" onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
    </EditorSidebarLayout>
  );
});
