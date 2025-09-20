import BaseHeader from "./BaseHeader";
import { SiteConfig } from "@/types/siteConfig";
import { getParentSiteUrl, getParentSiteName } from "@/utils/client/siteConfig";

interface AnandaHeaderProps {
  siteConfig: SiteConfig;
  onNewChat?: () => void;
}

export default function AnandaHeader({ siteConfig, onNewChat }: AnandaHeaderProps) {
  const parentSiteUrl = getParentSiteUrl(siteConfig);
  const parentSiteName = getParentSiteName(siteConfig);

  return (
    <>
      <BaseHeader
        config={siteConfig.header}
        parentSiteUrl={parentSiteUrl}
        parentSiteName={parentSiteName}
        requireLogin={siteConfig.requireLogin}
        onNewChat={onNewChat}
        temporarySession={false}
        onTemporarySessionChange={undefined}
        isChatEmpty={true}
        allowTemporarySessions={false}
      />
    </>
  );
}
