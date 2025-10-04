import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { SiteConfig } from "@/types/siteConfig";
import AnandaHeader from "./Header/AnandaHeader";
import AnandaPublicHeader from "./Header/AnandaPublicHeader";
import JairamHeader from "./Header/JairamHeader";
import CrystalHeader from "./Header/CrystalHeader";
import PhotoHeader from "./Header/PhotoHeader";

interface AdminLayoutProps {
  siteConfig: SiteConfig | null;
  children: React.ReactNode;
  pageTitle?: string;
}

interface PendingCounts {
  approvals: number;
  invitations: number;
}

export function AdminLayout({ siteConfig, children, pageTitle }: AdminLayoutProps) {
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>({ approvals: 0, invitations: 0 });

  const loginRequired = !!siteConfig?.requireLogin;

  // Fetch pending counts for badges
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        // Try to get JWT for API calls
        const tokenRes = await fetch("/api/web-token");
        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          const token = tokenData.token;

          // Fetch pending approvals count
          const approvalsRes = await fetch("/api/admin/pendingRequests", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (approvalsRes.ok) {
            const approvalsData = await approvalsRes.json();
            const pendingApprovals = approvalsData.requests?.filter((r: any) => r.status === "pending") || [];
            setPendingCounts((prev) => ({ ...prev, approvals: pendingApprovals.length }));
          }

          // Fetch pending invitations count
          const invitesRes = await fetch("/api/admin/pendingUsersCount", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (invitesRes.ok) {
            const invitesData = await invitesRes.json();
            setPendingCounts((prev) => ({ ...prev, invitations: invitesData.count || 0 }));
          }
        }
      } catch (error) {
        console.error("Failed to fetch admin counts:", error);
      }
    };

    fetchCounts();
  }, []);

  // Render the appropriate header based on siteConfig
  const renderHeader = () => {
    if (!siteConfig) return null;

    const headerPropsNoTempSessions = {
      siteConfig,
      onNewChat: undefined,
    };

    switch (siteConfig.siteId) {
      case "ananda":
        return <AnandaHeader {...headerPropsNoTempSessions} />;
      case "ananda-public":
        return <AnandaPublicHeader {...headerPropsNoTempSessions} />;
      case "jairam":
        return <JairamHeader {...headerPropsNoTempSessions} />;
      case "crystal":
        return <CrystalHeader {...headerPropsNoTempSessions} />;
      case "photo":
        return <PhotoHeader {...headerPropsNoTempSessions} />;
      default:
        return null;
    }
  };

  const LeftRail = () => (
    <div className="w-64 bg-gray-50 border-r border-gray-200 p-6 overflow-y-auto">
      <div className="space-y-8">
        {/* USERS Section */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Users</h3>
          <nav className="space-y-1">
            <Link
              href="/admin"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/admin"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">group</span>
              Users List
            </Link>

            <Link
              href="/admin/users/add"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/admin/users/add"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">person_add</span>
              Add Users
            </Link>

            <Link
              href="/admin/approvals"
              className={`flex items-center px-3 py-2 text-sm rounded-md relative ${
                router.pathname === "/admin/approvals"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">pending_actions</span>
              Pending Approvals
              {pendingCounts.approvals > 0 && (
                <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500 text-white">
                  {pendingCounts.approvals}
                </span>
              )}
            </Link>

            <Link
              href="/admin/users/pending"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/admin/users/pending"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">schedule</span>
              Pending Invitations
              {pendingCounts.invitations > 0 && (
                <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500 text-white">
                  {pendingCounts.invitations}
                </span>
              )}
            </Link>

            <Link
              href="/admin/leaderboard"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/admin/leaderboard"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">leaderboard</span>
              Leaderboard
            </Link>
          </nav>
        </div>

        {/* OTHER Section */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Other</h3>
          <nav className="space-y-1">
            <Link
              href="/admin/downvotes"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/admin/downvotes"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">thumb_down</span>
              Review Downvotes
            </Link>

            {loginRequired && (
              <Link
                href="/admin/newsletters"
                className={`flex items-center px-3 py-2 text-sm rounded-md ${
                  router.pathname === "/admin/newsletters"
                    ? "bg-blue-100 text-blue-700 font-semibold"
                    : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span className="material-icons text-sm mr-2">email</span>
                Newsletter Management
              </Link>
            )}
            <Link
              href="/admin/model-stats"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/admin/model-stats"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">insights</span>
              Model Stats
            </Link>
            <Link
              href="/stats"
              className={`flex items-center px-3 py-2 text-sm rounded-md ${
                router.pathname === "/stats"
                  ? "bg-blue-100 text-blue-700 font-semibold"
                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="material-icons text-sm mr-2">trending_up</span>
              Statistics
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Site Header */}
      {renderHeader()}

      {/* Admin Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              aria-label="Toggle navigation menu"
            >
              <span className="material-icons">{isMobileMenuOpen ? "close" : "menu"}</span>
            </button>
            <h1 className="ml-3 text-lg font-semibold text-gray-900">{pageTitle || "Admin Dashboard"}</h1>
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        {isMobileMenuOpen && (
          <div
            className="lg:hidden fixed inset-0 z-50 bg-black bg-opacity-50"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <div
              className="fixed left-0 top-0 bottom-0 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out"
              onClick={(e) => e.stopPropagation()}
            >
              <LeftRail />
            </div>
          </div>
        )}

        {/* Desktop Layout */}
        <div className="flex">
          {/* Desktop Left Rail */}
          <div className="hidden lg:block">
            <LeftRail />
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="max-w-screen-2xl mx-auto p-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
