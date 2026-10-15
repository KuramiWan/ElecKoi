import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScriptLibrariesPanel } from '../../src/modules/scripts/components/ScriptLibrariesPanel.jsx';
import { createScriptItem } from '../../src/modules/scripts/model/scriptEditing.js';
import { EditorPresentationContext } from '../../src/ui/ui/EditorPresentationContext.jsx';
import '../../src/app/windows/styles/tokens.css';
import '../../src/ui/styles/editor-sidebar.css';
import '../../src/modules/settingLibraries/styles/setting-library.css';
import '../../src/modules/scripts/styles/script-libraries.css';

const owners = { global: '', character: 'synthetic-character', preset: 'synthetic-preset' };
const libraries = Object.fromEntries(Object.entries(owners).map(([scope, ownerId]) => [scope, {
  scope, ownerId, enabled: false, revision: 1, variables: {},
  trees: [{ ...createScriptItem('script', `synthetic-${scope}`), name: `Synthetic ${scope} script` }],
}]));
const operations = [];
const service = {
  activePreset: async () => ({ id: owners.preset, name: 'Synthetic preset' }),
  read: async (scope, ownerId) => {
    if (owners[scope] !== ownerId) throw new Error('Unexpected synthetic owner');
    return structuredClone(libraries[scope]);
  },
  subscribe: () => () => {}, subscribeChanges: () => () => {},
  openDirectory: async (scope, ownerId) => { operations.push({ scope, ownerId }); },
  saveAll: async () => { throw new Error('Opening a directory must not save scripts'); },
};

function Fixture() {
  const [compact, setCompact] = useState(window.innerWidth <= 600);
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth <= 600);
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  return <EditorPresentationContext.Provider value={{ compact }}>
    <ScriptLibrariesPanel characterId={owners.character} scriptLibraries={service} />
  </EditorPresentationContext.Provider>;
}
window.mountNativeLibrariesFixture = () => {
  const root = createRoot(document.querySelector('#root')); root.render(<Fixture />);
  return { operations, dispose: () => root.unmount() };
};
