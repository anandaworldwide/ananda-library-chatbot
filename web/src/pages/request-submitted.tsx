import { useRouter } from "next/router";
import Head from "next/head";
import { GetServerSideProps } from "next";
import Layout from "@/components/layout";
import { loadSiteConfig } from "@/utils/server/loadSiteConfig";
import { SiteConfig } from "@/types/siteConfig";

interface RequestSubmittedPageProps {
  siteConfig: SiteConfig;
}

export default function RequestSubmittedPage({ siteConfig }: RequestSubmittedPageProps) {
  const router = useRouter();

  const handleReturnToLogin = () => {
    router.push("/login");
  };

  return (
    <Layout siteConfig={siteConfig}>
      <Head>
        <title>Request Submitted - {siteConfig.name}</title>
      </Head>

      <div className="max-w-md mx-auto mt-16 px-4">
        <div className="text-center">
          {/* Success Icon */}
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
            <span className="material-icons text-green-600 text-4xl">check_circle</span>
          </div>

          {/* Success Message */}
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Request Submitted!</h2>
          <p className="text-lg text-gray-600 mb-6">
            Your access request has been sent to the selected admin. They will review it and send you an activation
            email if approved.
          </p>

          {/* Return to Login Button */}
          <button
            onClick={handleReturnToLogin}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
          >
            Return to Login
          </button>
        </div>
      </div>
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  const siteConfig = await loadSiteConfig();

  return {
    props: {
      siteConfig,
    },
  };
};
