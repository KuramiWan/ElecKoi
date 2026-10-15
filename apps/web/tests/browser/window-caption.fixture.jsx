import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarContent } from '../../src/app/windows/shell/components/SidebarContent.jsx';
import { TitleBar, WindowControls } from '../../src/app/windows/shell/components/TitleBar.jsx';
import { SidePanelMotionFixture } from './side-panel-motion.fixture.jsx';
import '../../src/app/windows/styles/tokens.css';
import '../../src/app/windows/styles/base.css';
import '../../src/app/windows/shell/styles/titlebar.css';
import '../../src/app/windows/shell/styles/client-shell.css';
import '../../src/app/windows/shell/styles/sidebar-rail.css';
import '../../src/app/windows/styles/responsive.css';

const query = new URLSearchParams(location.search);
const collapsed = query.has('collapsed');
const rightbar = query.has('rightbar');
createRoot(document.querySelector('#root')).render(
  query.has('motion') ? <SidePanelMotionFixture /> :
  <main className="qq-shell main-window-shell" style={{
    '--side-panel-width': collapsed ? '0px' : '328px',
    '--rightbar-track-width': rightbar ? '300px' : '0px',
  }}>
    <SidebarContent collapsed={collapsed} onCollapse={() => {}}
      navigationItems={[]} sidePanel={<div style={{padding:'12px 10px',color:'var(--muted)'}}>合成会话列表</div>} />
    <section className="main-panel-shell">
      <TitleBar splitSurface showWindowControls={false} sidePanelCollapsed={collapsed} onToggleSidePanel={() => {}} />
      <div className="main-panel-content"><div style={{padding:16}}>合成主界面</div></div>
    </section>
    <div className="dsh-rightbar-column">{rightbar && <div>合成右侧栏</div>}</div>
    <div className="rightbar-resizer" />
    <div className="main-window-controls"><WindowControls /></div>
  </main>,
);
