import BaseHeader from "./BaseHeader";
import { SiteConfig } from "@/types/siteConfig";
import { getParentSiteUrl, getParentSiteName } from "@/utils/client/siteConfig";

interface JairamHeaderProps {
  siteConfig: SiteConfig;
  constrainWidth?: boolean;
  onNewChat?: () => void;
  temporarySession?: boolean;
  onTemporarySessionChange?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  isChatEmpty?: boolean;
}

export default function JairamHeader({
  siteConfig,
  constrainWidth,
  onNewChat,
  temporarySession,
  onTemporarySessionChange,
  isChatEmpty,
}: JairamHeaderProps) {
  const parentSiteUrl = getParentSiteUrl(siteConfig);
  const parentSiteName = getParentSiteName(siteConfig);

  return (
    <BaseHeader
      config={siteConfig.header}
      parentSiteUrl={parentSiteUrl}
      parentSiteName={parentSiteName}
      requireLogin={siteConfig.requireLogin}
      constrainWidth={constrainWidth}
      onNewChat={onNewChat}
      temporarySession={temporarySession}
      onTemporarySessionChange={onTemporarySessionChange}
      isChatEmpty={isChatEmpty}
      allowTemporarySessions={siteConfig.allowTemporarySessions}
    />
  );
}
