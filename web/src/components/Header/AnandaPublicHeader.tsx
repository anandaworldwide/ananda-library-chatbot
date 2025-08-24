import BaseHeader from "./BaseHeader";
import { SiteConfig } from "@/types/siteConfig";
import { getParentSiteUrl, getParentSiteName } from "@/utils/client/siteConfig";

interface AnandaHeaderProps {
  siteConfig: SiteConfig;
  constrainWidth?: boolean;
  onNewChat?: () => void;
}

export default function AnandaHeader({ siteConfig, constrainWidth, onNewChat }: AnandaHeaderProps) {
  const parentSiteUrl = getParentSiteUrl(siteConfig);
  const parentSiteName = getParentSiteName(siteConfig);

  return (
    <>
      <BaseHeader
        config={siteConfig.header}
        parentSiteUrl={parentSiteUrl}
        parentSiteName={parentSiteName}
        requireLogin={siteConfig.requireLogin}
        constrainWidth={constrainWidth}
        onNewChat={onNewChat}
      />
    </>
  );
}
