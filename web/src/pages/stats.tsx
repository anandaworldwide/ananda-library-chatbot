// This component displays user engagement statistics, including questions per day
// and total questions over various time periods.

import { SiteConfig } from "@/types/siteConfig";
import { useState, useEffect } from "react";
import Head from "next/head";
import type { GetServerSideProps, NextApiRequest } from "next";
import { AdminLayout } from "@/components/AdminLayout";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { isAdminPageAllowed } from "@/utils/server/adminPageGate";

// Structure for the statistics data
interface StatsData {
  questionsPerDay: Record<string, number>;
  totalQuestions: number;
}

// Formats a date string to a more readable format (Today, Yesterday, or MM/DD)
const formatDate = (dateString: string): string => {
  const date = new Date(dateString + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date.getTime() === today.getTime()) {
    return "Today";
  } else if (date.getTime() === today.getTime() - 86400000) {
    return "Yesterday";
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

interface StatsProps {
  siteConfig: SiteConfig | null;
}

const Stats = ({ siteConfig }: StatsProps) => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch statistics data from the API when the component mounts
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetchWithAuth("/api/stats");
        if (!response.ok) {
          throw new Error("Failed to fetch stats");
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching stats:", err);
        setError("Failed to load stats");
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []);

  // Show loading state
  if (isLoading)
    return (
      <>
        <Head>
          <title>Statistics - Admin</title>
        </Head>
        <AdminLayout siteConfig={siteConfig} pageTitle="Statistics">
          <div>Loading stats...</div>
        </AdminLayout>
      </>
    );

  // Show error state
  if (error)
    return (
      <>
        <Head>
          <title>Statistics - Admin</title>
        </Head>
        <AdminLayout siteConfig={siteConfig} pageTitle="Statistics">
          <div>Error: {error}</div>
        </AdminLayout>
      </>
    );

  // Show no data state
  if (!stats)
    return (
      <>
        <Head>
          <title>Statistics - Admin</title>
        </Head>
        <AdminLayout siteConfig={siteConfig} pageTitle="Statistics">
          <div>No data available</div>
        </AdminLayout>
      </>
    );

  // Sort dates in descending order
  const dates = Object.keys(stats.questionsPerDay);
  const sortedDates = dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  // Calculate aggregate statistics for a given number of days
  const calculateAggregateStats = (days: number) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const relevantDates = sortedDates.filter((date) => new Date(date) >= cutoffDate);

    const totalQuestions = relevantDates.reduce((sum, date) => sum + (stats.questionsPerDay[date] || 0), 0);
    const averageQuestions = relevantDates.length > 0 ? (totalQuestions / relevantDates.length).toFixed(1) : "N/A";

    return { averageQuestions, totalQuestions };
  };

  // Calculate statistics for different time periods
  const sevenDayStats = calculateAggregateStats(7);
  const thirtyDayStats = calculateAggregateStats(30);
  const ninetyDayStats = calculateAggregateStats(90);

  return (
    <>
      <Head>
        <title>Statistics - Admin</title>
      </Head>
      <AdminLayout siteConfig={siteConfig} pageTitle="Statistics">
        <div className="bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-semibold text-gray-900 mb-6">User Engagement Statistics</h1>

          {/* Summary Statistics */}
          <div className="mb-8 p-6 bg-gray-50 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{stats.totalQuestions}</div>
                <div className="text-sm text-gray-600">Total Questions (90 days)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{sevenDayStats.averageQuestions}</div>
                <div className="text-sm text-gray-600">Avg Questions/Day (7 days)</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{thirtyDayStats.averageQuestions}</div>
                <div className="text-sm text-gray-600">Avg Questions/Day (30 days)</div>
              </div>
            </div>
          </div>

          {/* Daily Statistics Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  <th className="py-2 px-4 border-b">Date</th>
                  <th className="py-2 px-4 border-b">Questions</th>
                </tr>
              </thead>
              <tbody>
                {sortedDates.slice(0, 30).map((date) => (
                  <tr key={date} className="hover:bg-gray-50">
                    <td className="py-2 px-4 border-b">{formatDate(date)}</td>
                    <td className="py-2 px-4 border-b text-center">{stats.questionsPerDay[date] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Period Statistics */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 border border-gray-300 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">7-Day Statistics</h3>
              <p>
                Average Questions/Day: <strong>{sevenDayStats.averageQuestions}</strong>
              </p>
              <p>
                Total Questions: <strong>{sevenDayStats.totalQuestions}</strong>
              </p>
            </div>

            <div className="bg-white p-6 border border-gray-300 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">30-Day Statistics</h3>
              <p>
                Average Questions/Day: <strong>{thirtyDayStats.averageQuestions}</strong>
              </p>
              <p>
                Total Questions: <strong>{thirtyDayStats.totalQuestions}</strong>
              </p>
            </div>

            <div className="bg-white p-6 border border-gray-300 rounded-lg">
              <h3 className="text-lg font-semibold mb-2">90-Day Statistics</h3>
              <p>
                Average Questions/Day: <strong>{ninetyDayStats.averageQuestions}</strong>
              </p>
              <p>
                Total Questions: <strong>{ninetyDayStats.totalQuestions}</strong>
              </p>
            </div>
          </div>
        </div>
      </AdminLayout>
    </>
  );
};

export const getServerSideProps: GetServerSideProps<StatsProps> = async ({ req }) => {
  const siteConfig = await loadSiteConfig();
  const allowed = await isAdminPageAllowed(req as NextApiRequest, undefined as any, siteConfig);
  if (!allowed) return { notFound: true };
  return { props: { siteConfig } };
};

export default Stats;
