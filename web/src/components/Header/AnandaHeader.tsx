import BaseHeader from "./BaseHeader";
import { SiteConfig } from "@/types/siteConfig";
import { getParentSiteUrl, getParentSiteName } from "@/utils/client/siteConfig";

interface AnandaHeaderProps {
  siteConfig: SiteConfig;
  onNewChat?: () => void;
  temporarySession?: boolean;
  onTemporarySessionChange?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  isChatEmpty?: boolean;
}

export default function AnandaHeader({
  siteConfig,
  onNewChat,
  temporarySession,
  onTemporarySessionChange,
  isChatEmpty,
}: AnandaHeaderProps) {
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
        temporarySession={temporarySession}
        onTemporarySessionChange={onTemporarySessionChange}
        isChatEmpty={isChatEmpty}
        allowTemporarySessions={siteConfig.allowTemporarySessions}
      />
    </>
  );
}
