import { PresetListPanel, PresetProvider, PresetWorkspace } from "../../../src/renderer/src/modules/presets/index.js";

export function PresetsPage({ view }) {
  const { chat, presets, presetNavigationGuardRef, presetRequestedTab, setPresetRequestedTab, renderLayout } = view;
  return <PresetProvider catalogModel={presets} navigationGuardRef={presetNavigationGuardRef}>
    {renderLayout({
      sidePanel: <PresetListPanel />,
      mainPanel: <PresetWorkspace
        modelConfigs={chat.chatModelConfigs}
        modelOptionsByKey={chat.modelOptionsByKey}
        onLoadModels={chat.loadModelOptions}
        onSaveModelConfig={chat.saveModelConfig}
        onNotify={chat.notify}
        requestedTab={presetRequestedTab}
        onRequestedTabHandled={() => setPresetRequestedTab("")}
      />,
    })}
  </PresetProvider>;
}
