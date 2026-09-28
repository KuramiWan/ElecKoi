import { MessagesPage } from "../../../../../packages/dsh-client-conversations/src/page.jsx";
import { CharacterPage } from "../../../../../packages/dsh-client-characters/src/page.jsx";
import { PresetsPage } from "../../../../../packages/dsh-client-presets/src/page.jsx";
import { ModelPage } from "../../../../../packages/dsh-client-models/src/page.jsx";
import { SettingsPage } from "../../../../../packages/dsh-client-shell/src/settings-page.jsx";

export const productMainPages = {
  messages: MessagesPage,
  character: CharacterPage,
  presets: PresetsPage,
  model: ModelPage,
  settings: SettingsPage,
};
