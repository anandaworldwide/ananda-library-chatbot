import BaseHeader from "./BaseHeader";
import { SiteConfig } from "@/types/siteConfig";
import { getParentSiteUrl, getParentSiteName } from "@/utils/client/siteConfig";

interface JairamHeaderProps {
  siteConfig: SiteConfig;
  constrainWidth?: boolean;
  onNewChat?: () => void;
}

export default function JairamHeader({ siteConfig, constrainWidth, onNewChat }: JairamHeaderProps) {
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
    />
  );
}
