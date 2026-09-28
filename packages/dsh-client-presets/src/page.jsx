import { PresetListPanel, PresetProvider, PresetWorkspace } from "../../../src/renderer/src/modules/presets/index.js";
import { useMainPageView } from "../../../src/renderer/src/app/windows/MainPageContext.jsx";

export function PresetsPage() {
  const view = useMainPageView();
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
