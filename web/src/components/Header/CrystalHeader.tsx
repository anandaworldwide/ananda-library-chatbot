import React from "react";
import Image from "next/image";
import Link from "next/link";
import { SiteConfig } from "@/types/siteConfig";
import { getParentSiteUrl } from "@/utils/client/siteConfig";

interface CrystalHeaderProps {
  siteConfig: SiteConfig;
  constrainWidth?: boolean;
  onNewChat?: () => void;
}

export default function CrystalHeader({ siteConfig, constrainWidth, onNewChat }: CrystalHeaderProps) {
  const parentSiteUrl = getParentSiteUrl(siteConfig);

  return (
    <header className="sticky top-0 z-40 w-full bg-[#0092e3] text-white">
      <div className={`h-24 ${constrainWidth ? "lg:grid lg:grid-cols-[288px_1fr] lg:px-0" : "px-4"}`}>
        {constrainWidth && <div className="hidden lg:block"></div>}
        <div className={`flex justify-between items-center ${constrainWidth ? "mx-auto w-full max-w-4xl px-4" : ""}`}>
          <div className="flex items-center">
            <Link href="/">
              <Image
                src="https://www.crystalclarity.com/cdn/shop/files/logo-white.png?v=1671755975&width=382"
                alt="Crystal Clarity Publishers"
                width={267}
                height={43}
                sizes="(max-width: 210px) 210px, 267px"
                className="header__logo-image cursor-pointer"
                priority
              />
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            {onNewChat && (
              <button
                onClick={onNewChat}
                aria-label="New Chat"
                className="text-white hover:text-gray-200 p-1 rounded-md hover:bg-white/10 transition-colors"
                title="Start New Chat"
              >
                <span className="material-icons text-xl">edit</span>
              </button>
            )}
            <Link href={parentSiteUrl} className="text-base hover:underline">
              Back to Main Site &gt;
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
