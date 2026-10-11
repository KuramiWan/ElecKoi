import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clipboard, List, PencilSimple, Plus, Trash, X } from '../icons/interfaceIcons.jsx';

export function MobileEditorActions({ label, selectionId, canEdit, canModify, clipboard, canPaste = true,
  onEdit, onMove, onPaste, onCancel, onDelete, createItems, moreItems, moveItems }) {
  const [menu, setMenu] = useState('');
  const barRef = useRef(null);
  useEffect(() => { setMenu(''); }, [selectionId, clipboard]);
  useEffect(() => {
    if (!menu) return undefined;
    const dismiss = event => { if (!barRef.current?.contains(event.target)) setMenu(''); };
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(''); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [menu]);
  const items = { create: createItems, more: moreItems, move: moveItems }[menu];
  const action = (title, Icon, enabled, run, destructive = false, popup = '') => <button type="button"
    disabled={!enabled} className={destructive ? 'is-destructive' : undefined}
    aria-expanded={popup ? menu === popup : undefined} aria-haspopup={popup ? 'menu' : undefined}
    onClick={() => popup ? setMenu(current => current === popup ? '' : popup) : run?.()}>
    <Icon size={22} aria-hidden="true" /><span>{title}</span>
  </button>;
  return <div ref={barRef} className="mobile-editor-actions" onMouseDown={event => event.stopPropagation()}>
    {items && <div className={`mobile-editor-action-menu is-${menu}`} role="menu">
      {items.map(({ label: title, Icon, disabled, run }) => <button type="button" role="menuitem" key={title} disabled={disabled}
        onClick={() => { setMenu(''); run(); }}>{Icon && <Icon size={18} aria-hidden="true" />}{title}</button>)}
    </div>}
    <div role="toolbar" aria-label={label}>
      {action('新建', Plus, true, null, false, 'create')}
      {action(clipboard ? '粘贴' : '编辑', clipboard ? Clipboard : PencilSimple, clipboard ? canPaste : canEdit, clipboard ? onPaste : onEdit)}
      {action(clipboard ? '取消' : '移动', clipboard ? X : ArrowRight, Boolean(clipboard) || canModify,
        clipboard ? onCancel : onMove, false, !clipboard && moveItems ? 'move' : '')}
      {action('删除', Trash, canModify && !clipboard, onDelete, true)}
      {action('更多', List, Boolean(selectionId) && !clipboard && Boolean(moreItems?.length), null, false, 'more')}
    </div>
  </div>;
}
