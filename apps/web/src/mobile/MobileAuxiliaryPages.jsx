import { useState } from 'react';
import { useMainPageView } from '../app/windows/MainPageContext.jsx';
import { CreatorStudioProjectHome, CreatorStudioCanvas } from '../modules/creatorStudio/index.js';
import { CommunityDialog } from '../app/windows/shell/components/CommunityDialog.jsx';
import { MobileHeader, useMobileBack } from './MobileChrome.jsx';

export function MobileCreatorPage() {
  const view = useMainPageView();
  const [project, setProject] = useState(null);
  useMobileBack(() => { setProject(null); return true; }, Boolean(project));
  return <div className="mobile-root-page mobile-creator-page"><MobileHeader title={project?.name || 'AI创作工作室'} back={project ? () => setProject(null) : undefined} />
    {project ? <CreatorStudioCanvas project={project} /> : <CreatorStudioProjectHome characterCatalog={view.characters} projectCatalog={view.creatorStudio} onOpenProject={setProject} />}
  </div>;
}
export function MobileCommunityPage() {
  const view = useMainPageView();
  return <div className="mobile-root-page"><MobileHeader title="社区" /><CommunityDialog open onClose={() => view.selectPanel('messages')} onNotify={view.chat.notify} /></div>;
}
