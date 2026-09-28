import { MainWindow } from "./MainWindow.jsx";
import { ChatWindow } from "./ChatWindow.jsx";
import { CharacterEditorWindow } from "./CharacterEditorWindow.jsx";
import { CharacterManagerWindow } from "./CharacterManagerWindow.jsx";
import { PresetManagerWindow } from "./PresetManagerWindow.jsx";

export default function App({ conversations, characters, characterConfiguration, models, persona, presets, settingsSections, navigation, renderSettingsSection, renderRoleplay } = {}) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "chat") {
    return <ChatWindow conversations={conversations} characters={characters} models={models} persona={persona} renderRoleplay={renderRoleplay} />;
  }
  if (params.get("view") === "character-editor") {
    return <CharacterEditorWindow characterCatalog={characters} characterConfiguration={characterConfiguration} />;
  }
  if (params.get("view") === "character-manager") {
    return <CharacterManagerWindow characterCatalog={characters} personaModel={persona} />;
  }
  if (params.get("view") === "preset-manager") {
    return <PresetManagerWindow presetCatalog={presets} />;
  }
  return <MainWindow conversations={conversations} characters={characters} models={models} persona={persona} presets={presets}
    settingsSections={settingsSections} navigation={navigation} renderSettingsSection={renderSettingsSection} renderRoleplay={renderRoleplay} />;
}
