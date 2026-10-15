import { useEffect, useState } from "react";
import { SidebarContent } from "../../apps/web/src/app/windows/shell/components/SidebarContent.jsx";
import { TitleBar, WindowControls } from "../../apps/web/src/app/windows/shell/components/TitleBar.jsx";
import { useSidePanelLayout } from "../../apps/web/src/app/windows/shell/hooks/useSidePanelLayout.js";
import { useColumnTransition } from "../../apps/web/src/app/windows/shell/hooks/useColumnTransition.js";

export function SidePanelMotionFixture() {
  const layout = useSidePanelLayout();
  const [rightbarTrack, setRightbarTrack] = useState(false);
  const [instant, setInstant] = useState(false);
  const animating = useColumnTransition({ shellRef: layout.shellRef,
    sidebarCollapsed: layout.sidePanelCollapsed, rightbarTrack, viewportWidth: layout.viewportWidth });
  useEffect(() => {
    window.captionMotion = { ...layout, setRightbarTrack, setInstant };
    return () => { delete window.captionMotion; };
  });
  return <main ref={layout.shellRef} className="qq-shell main-window-shell"
    data-columns-animating={animating || undefined}
    data-side-panel-dragging={layout.sidePanelDragging || undefined}
    data-rightbar-instant={instant || undefined}
    style={{ ...layout.shellStyle, "--rightbar-track-width": rightbarTrack ? "300px" : "0px",
      "--rightbar-normal-width": "300px", "--ds-transition-duration-slow": ".3s",
      "--ds-ease-in-out": "cubic-bezier(.4, 0, .2, 1)" }}>
    <SidebarContent collapsed={layout.sidePanelCollapsed} onCollapse={layout.collapseSidePanel}
      sidePanel={<div />} navigationItems={[]} />
    <section className="main-panel-shell">
      <TitleBar splitSurface showWindowControls={false} sidePanelCollapsed={layout.sidePanelCollapsed}
        onToggleSidePanel={layout.expandSidePanel} />
      <div className="main-panel-content" />
    </section>
    <div className="dsh-rightbar-column" />
    <div className="rightbar-resizer" />
    <div className="main-window-controls"><WindowControls /></div>
  </main>;
}
