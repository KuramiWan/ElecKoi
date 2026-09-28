import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatBackgroundModal, ChatWallpaperLayer, HistoryModal } from "../../modules/chat/index.js";
import { resolveChatWallpaper } from "../../modules/appearance/index.js";
import { useChatClient } from "../hooks/useChatClient.js";
import { useWindowAppearance } from "../hooks/useWindowAppearance.js";
import { AppToast } from "../../ui/ui/AppToast.jsx";
import { UnsavedChangesDialog } from "../../ui/ui/UnsavedChangesDialog.jsx";
import { SidebarRail } from "./shell/components/SidebarRail.jsx";
import { CommunityDialog } from "./shell/components/CommunityDialog.jsx";
import { SidePanelShell } from "./shell/components/SidePanelShell.jsx";
import { PluginCenterSurface, PluginListPanel } from "./shell/components/PluginCenter.jsx";
import { SidePanelResizeHandle } from "./shell/components/SidePanelResizeHandle.jsx";
import { TitleBar } from "./shell/components/TitleBar.jsx";
import { useSidePanelLayout } from "./shell/hooks/useSidePanelLayout.js";
import { AppUpdateController, useAppUpdates } from "../../modules/updates/index.js";
import { desktopClient } from "../../bridge/desktopClient.ts";
import { MainPageContext } from "./MainPageContext.jsx";

class MainPageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export function MainWindow({ conversations, characters, models, persona, presets, settingsSections = [], navigation, renderSettingsSection, renderRoleplay, sidebarFooterActions }) {
  const chat = useChatClient({ conversations, characters, models, persona, navigation });
  const appearance = useWindowAppearance({ notify: chat.notify });
  const sidePanelLayout = useSidePanelLayout();
  const appUpdates = useAppUpdates();
  const isPluginPanel = Boolean(navigation && !navigation.productPanelIds?.includes(chat.activeSection) && chat.activeSection !== "plugins");
  const [chatBackgroundOpen, setChatBackgroundOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState("chat");
  const [modelConfigDirty, setModelConfigDirty] = useState(false);
  const [pendingSection, setPendingSection] = useState(null);
  const [savingPendingModelChanges, setSavingPendingModelChanges] = useState(false);
  const [presetRequestedTab, setPresetRequestedTab] = useState("");
  const modelConfigPanelRef = useRef(null);
  const presetNavigationGuardRef = useRef(null);

  useEffect(() => {
    document.title = "ElecKoi";
  }, []);

  useEffect(() => desktopClient.on("plugins.host.failed", ({ message }) => {
    chat.notify("error", message);
  }), [chat.notify]);

  const changeActiveSection = useCallback((section) => {
    if (chat.activeSection === "presets" && section !== "presets" && presetNavigationGuardRef.current) {
      presetNavigationGuardRef.current(() => chat.setActiveSection(section));
      return;
    }
    if (chat.activeSection === "model" && section !== "model" && modelConfigDirty) {
      setPendingSection(section);
      return;
    }
    chat.setActiveSection(section);
  }, [chat, modelConfigDirty]);

  const discardModelChangesAndLeave = useCallback(() => {
    const section = pendingSection;
    setPendingSection(null);
    setModelConfigDirty(false);
    if (section) chat.setActiveSection(section);
  }, [chat, pendingSection]);

  const saveModelChangesAndLeave = useCallback(async () => {
    if (savingPendingModelChanges) return;
    setSavingPendingModelChanges(true);
    try {
      const saved = await modelConfigPanelRef.current?.save();
      if (!saved) return;
      const section = pendingSection;
      setPendingSection(null);
      setModelConfigDirty(false);
      if (section) chat.setActiveSection(section);
    } finally {
      setSavingPendingModelChanges(false);
    }
  }, [chat, pendingSection, savingPendingModelChanges]);

  const chatWallpaper = useMemo(() => resolveChatWallpaper({
    character: chat.chatBackgroundCharacter,
    persona: chat.chatPersona,
    globalWallpaper: appearance.globalChatWallpaper,
  }), [appearance.globalChatWallpaper, chat.chatBackgroundCharacter, chat.chatPersona]);
  const showChatWallpaper = chat.activeSection === "messages" && Boolean(chat.sessionId || chat.chatCharacter?.character_id) && Boolean(chatWallpaper.image);

  function selectConversation(chatId) {
    if (chatId === chat.sessionId) {
      chat.clearActiveChat();
      return;
    }
    chat.loadChat(chatId);
  }

  function renderWindowLayout({ sidePanel, mainPanel, overlays = null }) {
    return (
      <>
        <section className="navigation-rail-shell" aria-label="功能导航栏">
          <div className="navigation-rail-title" data-tauri-drag-region />
          <SidebarRail
            activeSection={chat.activeSection}
            navigationItems={navigation?.items}
            profileActive={chat.activeSection === "settings" && settingsPage === "profile"}
            onSectionChange={changeActiveSection}
            onNavigationAction={(id) => {
              if (id === "community") setCommunityOpen(true);
            }}
            persona={chat.persona}
            onOpenProfile={() => {
              setSettingsPage("profile");
              changeActiveSection("settings");
            }}
            onOpenSettings={() => {
              setSettingsPage("chat");
              changeActiveSection("settings");
            }}
          />
        </section>

        <SidePanelShell collapsed={sidePanelLayout.sidePanelCollapsed || isPluginPanel} onCollapse={sidePanelLayout.collapseSidePanel} footerActions={sidebarFooterActions}>
          {sidePanel}
        </SidePanelShell>

        <section className="main-panel-shell" aria-label="主功能界面">
          <TitleBar
            splitSurface
            sidePanelCollapsed={sidePanelLayout.sidePanelCollapsed && !isPluginPanel}
            onToggleSidePanel={sidePanelLayout.expandSidePanel}
          />
          <div className="main-panel-content">{mainPanel}</div>
        </section>
        {overlays}
      </>
    );
  }

  const pageView = {
    chat,
    appearance,
    appUpdates,
    conversations,
    presets,
    settingsSections,
    renderSettingsSection,
    renderRoleplay,
    settingsPage,
    setSettingsPage,
    modelConfigPanelRef,
    setModelConfigDirty,
    presetNavigationGuardRef,
    presetRequestedTab,
    setPresetRequestedTab,
    changeActiveSection,
    renderLayout: renderWindowLayout,
    selectConversation,
    openChatBackground: () => setChatBackgroundOpen(true),
    openPresetTools: () => {
      setPresetRequestedTab("tools");
      changeActiveSection("presets");
    },
    openCharacterSection: () => chat.setActiveSection("character"),
  };

  let windowLayout;
  if (chat.activeSection === "plugins") {
    windowLayout = renderWindowLayout({
      sidePanel: <PluginListPanel onNotify={chat.notify} />,
      mainPanel: <PluginCenterSurface>{navigation?.renderPanel("plugins")}</PluginCenterSurface>,
    });
  } else if (isPluginPanel) {
    windowLayout = renderWindowLayout({
      sidePanel: null,
      mainPanel: navigation.renderPanel(chat.activeSection),
    });
  } else if (navigation) {
    windowLayout = navigation.renderPanel(chat.activeSection);
  } else {
    windowLayout = renderWindowLayout({
      sidePanel: null,
      mainPanel: <div className="chat-empty-guide" role="alert">客户端插件未加载。</div>,
    });
  }
  return (
    <main
      ref={sidePanelLayout.shellRef}
      className={`qq-shell main-window-shell section-${isPluginPanel ? "plugin" : chat.activeSection}${showChatWallpaper ? " has-chat-wallpaper" : ""}${sidePanelLayout.sidePanelCollapsed || isPluginPanel ? " side-panel-collapsed" : ""}`}
      style={isPluginPanel ? { ...sidePanelLayout.shellStyle, "--side-panel-width": "0px" } : sidePanelLayout.shellStyle}
      data-side-panel-dragging={sidePanelLayout.sidePanelDragging || undefined}
    >
      {showChatWallpaper ? <ChatWallpaperLayer wallpaper={chatWallpaper} /> : null}
      <MainPageContext.Provider value={pageView}>
        <MainPageErrorBoundary
          key={chat.activeSection}
          fallback={(error) => renderWindowLayout({
            sidePanel: null,
            mainPanel: <div className="chat-empty-guide" role="alert">页面加载失败：{error?.message || String(error)}</div>,
          })}
        >
          <Suspense fallback={renderWindowLayout({ sidePanel: null, mainPanel: null })}>
            {windowLayout}
          </Suspense>
        </MainPageErrorBoundary>
      </MainPageContext.Provider>
      {!sidePanelLayout.sidePanelCollapsed && !isPluginPanel ? (
        <SidePanelResizeHandle
          onStart={sidePanelLayout.startSidePanelResize}
          onDrag={sidePanelLayout.resizeSidePanel}
          onEnd={sidePanelLayout.endSidePanelResize}
        />
      ) : null}
      <HistoryModal
        open={chat.historyOpen}
        sessions={chat.sessions}
        sessionId={chat.sessionId}
        chatCharacter={chat.chatCharacter}
        onClose={chat.closeHistory}
        onLoadChat={chat.loadChat}
        onDeleteChat={chat.removeHistoryChat}
        onHistoryPolicyChange={() => chat.refreshSessionsOnly({ keepSection: true })}
      />
      <ChatBackgroundModal
        open={chatBackgroundOpen}
        character={chat.chatBackgroundCharacter}
        persona={chat.chatPersona}
        messages={chat.messages}
        chatDisplay={appearance.chatDisplay}
        globalWallpaper={appearance.globalChatWallpaper}
        newCharacterBackground={appearance.newCharacterBackground}
        onClose={() => setChatBackgroundOpen(false)}
        onSaveCharacter={chat.updateChatBackground}
        onSaveGlobal={appearance.saveGlobalChatWallpaper}
        onSaveNewCharacterBackground={appearance.saveNewCharacterBackground}
        onNotify={chat.notify}
      />
      <CommunityDialog
        open={communityOpen}
        onClose={() => setCommunityOpen(false)}
        onNotify={chat.notify}
      />
      <UnsavedChangesDialog
        open={Boolean(pendingSection)}
        title="保存修改？"
        description="离开前是否保存当前模型配置的修改？"
        saving={savingPendingModelChanges}
        onCancel={() => setPendingSection(null)}
        onSave={saveModelChangesAndLeave}
        onDiscard={discardModelChangesAndLeave}
      />
      <AppToast notice={chat.notice} onDismiss={chat.dismissNotice} />
      <AppUpdateController updates={appUpdates} />
    </main>
  );
}
