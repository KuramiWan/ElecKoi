import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CharacterManager } from '../../src/modules/persona/components/CharacterManager.jsx';
import { PresetManager } from '../../src/modules/presets/components/PresetManager.jsx';
import '../../src/app/windows/styles/tokens.css';
import '../../src/app/windows/styles/base.css';
import '../../src/modules/persona/styles/character-manager.css';
import '../../src/modules/presets/styles/preset-panel.css';
import '../../src/ui/styles/group-assignment-menu.css';
import '../../src/ui/styles/dsh-search-field.css';
import '../../src/ui/styles/avatar.css';

window.openedEditors = [];
window.open = (...args) => { window.openedEditors.push(args); return null; };
function Fixture() {
  const [copied, setCopied] = useState(0), [selected, setSelected] = useState('synthetic-preset-0');
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode === 'preset') return <PresetManager catalogModel={{}} catalog={{ groups: [], presets: Array.from({ length: 30 }, (_, index) => ({
    id: `synthetic-preset-${index}`, name: `合成预设 ${index}`, libraryGroupId: '', profile: { authorName: '合成作者', authorAvatarPath: '' },
  })) }} purpose="roleplay" selectedGroup="全部预设" selectedPresetId={selected} onSelectGroup={() => {}} onSelectPreset={setSelected} onRefresh={() => {}} />;
  return <><CharacterManager characters={{ active_character_id: 'synthetic-character', groups: Array.from({ length: 18 }, (_, index) => `合成分组 ${index}`),
    items: [{ id: 'synthetic-character', name: '合成角色', group: '' }] }} persona={{ user_name: '合成用户' }}
    onSaveGroups={() => {}} onDuplicateCharacter={async () => setCopied(value => value + 1)} />
    <output id="synthetic-copies" hidden>{copied}</output></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
