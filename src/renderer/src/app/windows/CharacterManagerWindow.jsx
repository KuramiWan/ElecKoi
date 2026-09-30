import { useCallback, useEffect, useState } from "react";
import { applyAppearanceTheme } from "../../modules/appearance/index.js";
import {
  CharacterManager,
  commitCharacterImports,
  deleteCharacters,
  exportCharacterFiles,
  saveCharacterGroups,
} from "../../modules/persona/index.js";
import { showCurrentWindow } from "../services/windowControls.js";
import { TitleBar } from "./shell/components/TitleBar.jsx";

const EMPTY_CHARACTERS = { active_character_id: "", groups: [], items: [] };
const EMPTY_PERSONA = { user_name: "用户", user_avatar: "" };

function normalizeCharacters(collection) {
  return {
    active_character_id: collection?.active_character_id || collection?.items?.[0]?.id || "",
    groups: collection?.groups || [],
    items: collection?.items || [],
  };
}

export function CharacterManagerWindow({ characterCatalog, personaModel, renderCharacterManager }) {
  const [characters, setCharacters] = useState(EMPTY_CHARACTERS);
  const [persona, setPersona] = useState(EMPTY_PERSONA);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextCharacters, nextPersona] = await Promise.all([characterCatalog.refresh(), personaModel.refresh()]);
      setCharacters(normalizeCharacters(nextCharacters));
      setPersona(nextPersona || EMPTY_PERSONA);
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "读取角色卡失败。");
    } finally {
      setLoaded(true);
    }
  }, [characterCatalog, personaModel]);

  useEffect(() => {
    applyAppearanceTheme(null);
    document.title = "角色卡管理器 - ElecKoi";
    showCurrentWindow().catch(() => {});
    const updateCharacters = () => {
      const snapshot = characterCatalog.getSnapshot();
      if (snapshot.status === "ready") {
        setCharacters(normalizeCharacters(snapshot.collection));
        setLoaded(true);
        setLoadError("");
      } else if (snapshot.status === "error") setLoadError(snapshot.error);
    };
    const updatePersona = () => {
      const snapshot = personaModel.getSnapshot();
      if (snapshot.status === "ready") setPersona(snapshot.profile || EMPTY_PERSONA);
      else if (snapshot.status === "error") setLoadError(snapshot.error);
    };
    const stopCharacters = characterCatalog.subscribe(updateCharacters);
    const stopPersona = personaModel.subscribe(updatePersona);
    updateCharacters();
    updatePersona();
    void refresh();
    return () => { stopCharacters(); stopPersona(); };
  }, [characterCatalog, personaModel, refresh]);

  async function persistGroups(groups, assignments = []) {
    const saved = await saveCharacterGroups(groups, assignments);
    characterCatalog.adopt(saved);
    setCharacters(normalizeCharacters(saved));
    return saved;
  }

  async function removeCharacters(characterIds) {
    const saved = await deleteCharacters(characterIds);
    characterCatalog.adopt(saved);
    setCharacters(normalizeCharacters(saved));
    return saved;
  }

  async function importCharacters(token) {
    const result = await commitCharacterImports(token);
    characterCatalog.adopt(result.collection);
    setCharacters(normalizeCharacters(result.collection));
    return result;
  }

  const managerOwner = {
    characters,
    persona,
    onRefresh: refresh,
    onSaveGroups: persistGroups,
    onDeleteCharacters: removeCharacters,
    onImportCharacters: importCharacters,
    onExportCharacters: exportCharacterFiles,
  };
  const managerFallback = <CharacterManager
    characters={characters}
    persona={persona}
    onSaveGroups={persistGroups}
    onDeleteCharacters={removeCharacters}
    onImportCharacters={importCharacters}
    onExportCharacters={exportCharacterFiles}
  />;

  return (
    <main className="qq-shell management-window-shell">
      <TitleBar splitSurface />
      <section className="management-window-content">
        {!loaded ? <p className="management-window-state">正在读取…</p> : loadError ? (
          <div className="management-window-state is-error" role="alert">
            <span>{loadError}</span>
            <button type="button" onClick={() => void refresh()}>重试</button>
          </div>
        ) : (
          renderCharacterManager?.(managerOwner, managerFallback) ?? managerFallback
        )}
      </section>
    </main>
  );
}
