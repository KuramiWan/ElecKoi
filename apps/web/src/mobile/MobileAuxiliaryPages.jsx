import { useMainPageView } from '../app/windows/MainPageContext.jsx';
export { MobileCreatorStudioPage as MobileCreatorPage } from './MobileCreatorStudioPage.jsx';
import { CommunityDialog } from '../app/windows/shell/components/CommunityDialog.jsx';
import { MobileHeader } from './MobileChrome.jsx';

export function MobileCommunityPage() {
  const view = useMainPageView();
  return <div className="mobile-root-page"><MobileHeader title="社区" /><CommunityDialog open onClose={() => view.selectPanel('messages')} onNotify={view.chat.notify} /></div>;
}
