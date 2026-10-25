import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomPositionManager } from '../../src/modules/settingLibraries/components/CustomPositionManager.jsx';
import { PresetIntroductionEditor } from '../../src/modules/presets/components/PresetIntroductionEditor.jsx';
import '../../src/app/windows/styles/tokens.css';
import '../../src/app/windows/styles/base.css';
import '../../src/modules/presets/styles/preset-usage.css';

function Fixture() {
  const [positions, setPositions] = useState(['first', 'second'].map((id, index) => ({
    id, name: id, anchor: 'insert_point_5', side: 'after_setting_position', order: index + 1,
  })));
  const [profile, setProfile] = useState({ usageInstructions: 'Synthetic instructions', timeline: [
    { id: 'update-first', title: 'Synthetic update', note: 'Synthetic body', dateLabel: '2026-10-25' },
  ] });
  const [failSave, setFailSave] = useState(false);
  const [error, setError] = useState('');
  return <main style={{ height: '100vh', padding: 24, display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto' }}>
    <section style={{ minHeight: 0 }}><CustomPositionManager positions={positions} entries={[]} onBack={() => {}}
      onChange={next => setPositions(next)} /></section>
    <button id="fail-save" type="button" onClick={() => setFailSave(value => !value)}>Toggle failed save</button>
    <PresetIntroductionEditor preset={{ profile }} error={error} saving={false} onClearError={() => setError('')}
      onSaveProfile={async patch => { if (failSave) { setError('Synthetic save failed'); return false; }
        setProfile(value => ({ ...value, ...patch })); return true; }} />
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
