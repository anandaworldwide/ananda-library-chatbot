#!/usr/bin/env python3
"""
Google Analytics CLI tool for analyzing answers page usage on Ananda site.

This script connects to Google Analytics 4 and analyzes:
1. Percentage of total page views that go to /answers page
2. Percentage of total users that visit /answers page
3. Detailed breakdown of answers page usage metrics

Usage:
    python bin/analyze_ga_answers_page.py --site ananda
    python bin/analyze_ga_answers_page.py --site ananda --days 30
    python bin/analyze_ga_answers_page.py --site ananda --start-date 2024-01-01 --end-date 2024-01-31

Environment Variables (loaded from .env.{site}):
    GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON file
    NEXT_PUBLIC_GA_MEASUREMENT_ID: Google Analytics 4 measurement ID (G-XXXXXXXXX)

Requirements:
1. Google Analytics 4 property set up for the Ananda site
2. Service account with Analytics Viewer permissions
3. Service account JSON credentials file path in GOOGLE_APPLICATION_CREDENTIALS
4. GA4 measurement ID in NEXT_PUBLIC_GA_MEASUREMENT_ID
"""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import requests
from google.oauth2 import service_account

# Add project root to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from pyutil.env_utils import load_env


class GoogleAnalyticsReporter:
    """Google Analytics 4 reporting client for Ananda site analysis using REST API."""

    def __init__(
        self, measurement_id: str, credentials_path: str, property_id: str = None
    ):
        """
        Initialize the GA4 client.

        Args:
            measurement_id: GA4 measurement ID (G-XXXXXXXXX format)
            credentials_path: Path to service account JSON file
            property_id: Optional direct property ID (properties/123456789 format)
        """
        self.measurement_id = measurement_id

        # Load service account credentials
        self.credentials = service_account.Credentials.from_service_account_file(
            credentials_path,
            scopes=[
                "https://www.googleapis.com/auth/analytics.readonly",
                "https://www.googleapis.com/auth/analytics.manage.users.readonly",
            ],
        )

        # Base URLs for GA4 APIs
        self.data_api_url = "https://analyticsdata.googleapis.com/v1beta"
        self.admin_api_url = "https://analyticsadmin.googleapis.com/v1beta"

        # Use provided property ID or look it up from measurement ID
        if property_id:
            if not property_id.startswith("properties/"):
                property_id = f"properties/{property_id}"
            self.property_id = property_id
            print(f"✅ Using provided property ID: {property_id}")
        else:
            # Get the property ID from measurement ID
            self.property_id = self._get_property_id_from_measurement_id(measurement_id)

    def _get_property_id_from_measurement_id(self, measurement_id: str) -> str:
        """
        Get the property ID from a measurement ID using the Admin API.

        Args:
            measurement_id: GA4 measurement ID (G-XXXXXXXXX)

        Returns:
            Property ID in format properties/123456789
        """
        # Get access token
        from google.auth.transport.requests import Request

        self.credentials.refresh(Request())
        headers = {
            "Authorization": f"Bearer {self.credentials.token}",
            "Content-Type": "application/json",
        }

        # List all accounts to find the property
        accounts_url = f"{self.admin_api_url}/accounts"
        response = requests.get(accounts_url, headers=headers)

        if response.status_code != 200:
            # If we can't access accounts, we need the user to provide the property ID
            print(f"⚠️  Warning: Could not fetch accounts ({response.status_code})")
            print(
                "   This usually means the service account needs additional permissions."
            )
            print("   Please find your numeric Property ID manually:")
            print("   1. Go to Google Analytics → Admin → Property Settings")
            print("   2. Look for 'Property ID' (numeric, like 123456789)")
            print(
                f"   3. Set GOOGLE_ANALYTICS_PROPERTY_ID={measurement_id}_NUMERIC_ID in your .env file"
            )
            print(
                "   4. Or grant 'Analytics Admin API' permissions to your service account"
            )

            # Try a simple fallback that might work
            if measurement_id.startswith("G-"):
                # This is unlikely to work but we'll try
                numeric_id = measurement_id[2:]  # Remove G- prefix
                print(f"   Attempting fallback with property ID: {numeric_id}")
                return f"properties/{numeric_id}"
            return f"properties/{measurement_id}"

        accounts_data = response.json()

        # Search through accounts and properties to find matching measurement ID
        for account in accounts_data.get("accounts", []):
            account_name = account["name"]

            # List properties for this account
            properties_url = f"{self.admin_api_url}/{account_name}/properties"
            prop_response = requests.get(properties_url, headers=headers)

            if prop_response.status_code == 200:
                properties_data = prop_response.json()

                for property_info in properties_data.get("properties", []):
                    # Check if this property has the matching measurement ID
                    property_name = property_info["name"]

                    # Get data streams for this property
                    streams_url = f"{self.admin_api_url}/{property_name}/dataStreams"
                    streams_response = requests.get(streams_url, headers=headers)

                    if streams_response.status_code == 200:
                        streams_data = streams_response.json()

                        for stream in streams_data.get("dataStreams", []):
                            if (
                                stream.get("webStreamData", {}).get("measurementId")
                                == measurement_id
                            ):
                                return property_name

        # If not found, use fallback
        print(
            f"⚠️  Warning: Could not find property for measurement ID {measurement_id}, using fallback"
        )
        if measurement_id.startswith("G-"):
            numeric_id = measurement_id[2:]
            return f"properties/{numeric_id}"
        return f"properties/{measurement_id}"

    def _make_request(self, endpoint: str, data: dict) -> dict:
        """Make authenticated request to GA4 Data API."""
        # Get access token
        from google.auth.transport.requests import Request

        self.credentials.refresh(Request())
        headers = {
            "Authorization": f"Bearer {self.credentials.token}",
            "Content-Type": "application/json",
        }

        url = f"{self.data_api_url}/{endpoint}"
        response = requests.post(url, headers=headers, json=data)

        if response.status_code != 200:
            raise Exception(f"GA4 API error: {response.status_code} - {response.text}")

        return response.json()

    def get_total_metrics(
        self, start_date: str, end_date: str, exclude_admin_pages: bool = False
    ) -> dict[str, int]:
        """
        Get total page views and users for the entire site.

        Args:
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            exclude_admin_pages: If True, exclude login/admin/verification pages

        Returns:
            Dictionary with total_pageviews and total_users
        """
        data = {
            "dateRanges": [{"startDate": start_date, "endDate": end_date}],
            "metrics": [
                {"name": "screenPageViews"},
                {"name": "totalUsers"},
            ],
        }

        # Add filter to exclude admin/auth pages if requested
        if exclude_admin_pages:
            data["dimensionFilter"] = {
                "andGroup": {
                    "expressions": [
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/login",
                                    },
                                }
                            }
                        },
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/verify",
                                    },
                                }
                            }
                        },
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/admin",
                                    },
                                }
                            }
                        },
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/magic-login",
                                    },
                                }
                            }
                        },
                    ]
                }
            }

        response = self._make_request(f"{self.property_id}:runReport", data)

        if response.get("rows"):
            row = response["rows"][0]
            return {
                "total_pageviews": int(row["metricValues"][0]["value"]),
                "total_users": int(row["metricValues"][1]["value"]),
            }

        return {"total_pageviews": 0, "total_users": 0}

    def get_answers_page_metrics(
        self, start_date: str, end_date: str
    ) -> dict[str, int]:
        """
        Get page views and users specifically for the /answers page.

        Args:
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format

        Returns:
            Dictionary with answers_pageviews and answers_users
        """
        data = {
            "dateRanges": [{"startDate": start_date, "endDate": end_date}],
            "dimensions": [{"name": "pagePath"}],
            "metrics": [
                {"name": "screenPageViews"},
                {"name": "totalUsers"},
            ],
            "dimensionFilter": {
                "orGroup": {
                    "expressions": [
                        {
                            "filter": {
                                "fieldName": "pagePath",
                                "stringFilter": {
                                    "matchType": "EXACT",
                                    "value": "/answers",
                                },
                            }
                        },
                        {
                            "filter": {
                                "fieldName": "pagePath",
                                "stringFilter": {
                                    "matchType": "BEGINS_WITH",
                                    "value": "/answers?",
                                },
                            }
                        },
                    ]
                }
            },
        }

        response = self._make_request(f"{self.property_id}:runReport", data)

        total_answers_pageviews = 0
        total_answers_users = 0

        for row in response.get("rows", []):
            total_answers_pageviews += int(row["metricValues"][0]["value"])
            total_answers_users += int(row["metricValues"][1]["value"])

        return {
            "answers_pageviews": total_answers_pageviews,
            "answers_users": total_answers_users,
        }

    def get_top_pages(
        self,
        start_date: str,
        end_date: str,
        limit: int = 10,
        exclude_admin_pages: bool = False,
    ) -> list[dict]:
        """
        Get top pages by page views for context.

        Args:
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            limit: Number of top pages to return
            exclude_admin_pages: If True, exclude login/admin/verification pages

        Returns:
            List of dictionaries with page path, page views, and users
        """
        data = {
            "dateRanges": [{"startDate": start_date, "endDate": end_date}],
            "dimensions": [{"name": "pagePath"}],
            "metrics": [
                {"name": "screenPageViews"},
                {"name": "totalUsers"},
            ],
            "limit": limit,
            "orderBys": [{"metric": {"metricName": "screenPageViews"}, "desc": True}],
        }

        # Add filter to exclude admin/auth pages if requested
        if exclude_admin_pages:
            data["dimensionFilter"] = {
                "andGroup": {
                    "expressions": [
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/login",
                                    },
                                }
                            }
                        },
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/verify",
                                    },
                                }
                            }
                        },
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/admin",
                                    },
                                }
                            }
                        },
                        {
                            "notExpression": {
                                "filter": {
                                    "fieldName": "pagePath",
                                    "stringFilter": {
                                        "matchType": "BEGINS_WITH",
                                        "value": "/magic-login",
                                    },
                                }
                            }
                        },
                    ]
                }
            }

        response = self._make_request(f"{self.property_id}:runReport", data)

        pages = []
        for row in response.get("rows", []):
            pages.append(
                {
                    "page_path": row["dimensionValues"][0]["value"],
                    "pageviews": int(row["metricValues"][0]["value"]),
                    "users": int(row["metricValues"][1]["value"]),
                }
            )

        return pages


def format_percentage(value: float) -> str:
    """Format percentage with 2 decimal places."""
    return f"{value:.2f}%"


def format_number(value: int) -> str:
    """Format number with thousands separators."""
    return f"{value:,}"


def print_analysis_results(
    total_metrics: dict[str, int],
    answers_metrics: dict[str, int],
    top_pages: list[dict],
    start_date: str,
    end_date: str,
):
    """Print formatted analysis results."""

    print("=" * 80)
    print("GOOGLE ANALYTICS ANALYSIS: ANANDA SITE ANSWERS PAGE USAGE")
    print("=" * 80)
    print(f"Analysis Period: {start_date} to {end_date}")
    print()

    # Calculate percentages
    total_pageviews = total_metrics["total_pageviews"]
    total_users = total_metrics["total_users"]
    answers_pageviews = answers_metrics["answers_pageviews"]
    answers_users = answers_metrics["answers_users"]

    pageview_percentage = (
        (answers_pageviews / total_pageviews * 100) if total_pageviews > 0 else 0
    )
    user_percentage = (answers_users / total_users * 100) if total_users > 0 else 0

    # Main metrics
    print("📊 OVERALL SITE METRICS")
    print("-" * 40)
    print(f"Total Page Views: {format_number(total_pageviews)}")
    print(f"Total Users: {format_number(total_users)}")
    print()

    print("📋 ANSWERS PAGE METRICS")
    print("-" * 40)
    print(f"Answers Page Views: {format_number(answers_pageviews)}")
    print(f"Answers Page Users: {format_number(answers_users)}")
    print()

    print("📈 PERCENTAGE ANALYSIS")
    print("-" * 40)
    print(f"Answers Page Views as % of Total: {format_percentage(pageview_percentage)}")
    print(f"Answers Page Users as % of Total: {format_percentage(user_percentage)}")
    print()

    # Additional insights
    if answers_users > 0:
        pages_per_user = answers_pageviews / answers_users
        print(f"Average Answers Pages per User: {pages_per_user:.2f}")
        print()

    # Top pages for context
    print("🏆 TOP 10 PAGES (for context)")
    print("-" * 60)
    print(f"{'Rank':<4} {'Page Path':<30} {'Views':<10} {'Users':<8} {'% Views':<8}")
    print("-" * 60)

    for i, page in enumerate(top_pages, 1):
        page_percentage = (
            (page["pageviews"] / total_pageviews * 100) if total_pageviews > 0 else 0
        )
        print(
            f"{i:<4} {page['page_path'][:28]:<30} {format_number(page['pageviews']):<10} "
            f"{format_number(page['users']):<8} {format_percentage(page_percentage):<8}"
        )

    print()
    print("=" * 80)


def main():
    """Main function to run the Google Analytics analysis."""

    parser = argparse.ArgumentParser(
        description="Analyze Google Analytics data for Ananda site answers page usage",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze last 30 days
  python bin/analyze_ga_answers_page.py --site ananda

  # Analyze specific date range
  python bin/analyze_ga_answers_page.py --site ananda --start-date 2024-01-01 --end-date 2024-01-31

  # Analyze last 7 days
  python bin/analyze_ga_answers_page.py --site ananda --days 7

Environment Variables (from .env.{site}):
  GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON file
  NEXT_PUBLIC_GA_MEASUREMENT_ID: GA4 measurement ID (G-XXXXXXXXX)

Setup Requirements:
1. Create Google Cloud Project and enable Analytics Data API
2. Create service account with Analytics Viewer role
3. Set GOOGLE_APPLICATION_CREDENTIALS in .env.ananda
4. Set NEXT_PUBLIC_GA_MEASUREMENT_ID in .env.ananda
5. Grant service account access to GA4 property
        """,
    )

    # Required arguments
    parser.add_argument(
        "--site",
        "-s",
        required=True,
        help="Site configuration to load (e.g., 'ananda')",
    )

    # Date range options (mutually exclusive)
    date_group = parser.add_mutually_exclusive_group()

    date_group.add_argument(
        "--days",
        "-d",
        type=int,
        default=30,
        help="Number of days to analyze (default: 30)",
    )

    date_group.add_argument(
        "--start-date", help="Start date in YYYY-MM-DD format (requires --end-date)"
    )

    parser.add_argument(
        "--end-date", help="End date in YYYY-MM-DD format (requires --start-date)"
    )

    # Optional arguments
    parser.add_argument(
        "--top-pages",
        type=int,
        default=10,
        help="Number of top pages to show for context (default: 10)",
    )

    parser.add_argument(
        "--json-output",
        action="store_true",
        help="Output results in JSON format instead of formatted text",
    )

    parser.add_argument(
        "--exclude-admin",
        action="store_true",
        help="Exclude admin/login/verification pages from analysis",
    )

    args = parser.parse_args()

    # Validate arguments
    if args.start_date and not args.end_date:
        parser.error("--start-date requires --end-date")
    if args.end_date and not args.start_date:
        parser.error("--end-date requires --start-date")

    # Load site-specific environment
    try:
        load_env(args.site)
        print(f"✅ Loaded environment for site: {args.site}")
    except Exception as e:
        print(f"❌ Error loading environment for site '{args.site}': {e}")
        sys.exit(1)

    # Get environment variables
    credentials_data = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    measurement_id = os.getenv("NEXT_PUBLIC_GA_MEASUREMENT_ID") or os.getenv(
        "NEXT_PUBLIC_GOOGLE_ANALYTICS_ID"
    )
    property_id = os.getenv(
        "GOOGLE_ANALYTICS_PROPERTY_ID"
    )  # Optional: direct property ID

    # Validate environment variables
    if not credentials_data:
        print("❌ GOOGLE_APPLICATION_CREDENTIALS environment variable not set")
        print(
            "   Set this to the path of your service account JSON file in .env.ananda"
        )
        sys.exit(1)

    if not measurement_id:
        print("❌ NEXT_PUBLIC_GA_MEASUREMENT_ID environment variable not set")
        print("   Set this to your GA4 measurement ID (G-XXXXXXXXX) in .env.ananda")
        sys.exit(1)

    # Handle credentials - could be file path or JSON content
    credentials_file = None
    temp_credentials_file = None

    if credentials_data.startswith("{") and credentials_data.endswith("}"):
        # It's JSON content, create a temporary file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as temp_file:
            temp_file.write(credentials_data)
            credentials_file = Path(temp_file.name)
            temp_credentials_file = credentials_file  # Keep reference for cleanup
        print("✅ Using credentials from environment variable (JSON content)")
    else:
        # It's a file path
        credentials_file = Path(credentials_data)
        if not credentials_file.exists():
            print(f"❌ Credentials file not found: {credentials_file}")
            print(f"   Check GOOGLE_APPLICATION_CREDENTIALS path in .env.{args.site}")
            sys.exit(1)
        print(f"✅ Using credentials file: {credentials_file}")

    # Calculate date range
    if args.start_date and args.end_date:
        start_date = args.start_date
        end_date = args.end_date
    else:
        end_date = datetime.now().strftime("%Y-%m-%d")
        start_date = (datetime.now() - timedelta(days=args.days)).strftime("%Y-%m-%d")

    try:
        # Initialize GA client
        if property_id:
            print(f"🔗 Connecting to Google Analytics property ID: {property_id}")
        else:
            print(f"🔗 Connecting to Google Analytics measurement ID: {measurement_id}")
        ga_client = GoogleAnalyticsReporter(
            measurement_id, str(credentials_file), property_id
        )

        # Fetch data
        if args.exclude_admin:
            print(
                f"📊 Fetching analytics data for {start_date} to {end_date} (excluding admin/login pages)..."
            )
        else:
            print(f"📊 Fetching analytics data for {start_date} to {end_date}...")

        total_metrics = ga_client.get_total_metrics(
            start_date, end_date, args.exclude_admin
        )
        answers_metrics = ga_client.get_answers_page_metrics(start_date, end_date)
        top_pages = ga_client.get_top_pages(
            start_date, end_date, args.top_pages, args.exclude_admin
        )

        # Output results
        if args.json_output:
            # JSON output for programmatic use
            results = {
                "analysis_period": {
                    "start_date": start_date,
                    "end_date": end_date,
                    "days": args.days if not args.start_date else None,
                },
                "total_metrics": total_metrics,
                "answers_metrics": answers_metrics,
                "percentages": {
                    "pageview_percentage": (
                        answers_metrics["answers_pageviews"]
                        / total_metrics["total_pageviews"]
                        * 100
                    )
                    if total_metrics["total_pageviews"] > 0
                    else 0,
                    "user_percentage": (
                        answers_metrics["answers_users"]
                        / total_metrics["total_users"]
                        * 100
                    )
                    if total_metrics["total_users"] > 0
                    else 0,
                },
                "top_pages": top_pages,
            }
            print(json.dumps(results, indent=2))
        else:
            # Formatted text output
            print_analysis_results(
                total_metrics, answers_metrics, top_pages, start_date, end_date
            )

    except Exception as e:
        print(f"❌ Error running analysis: {e}")
        print("Make sure:")
        print("  1. Service account has Analytics Viewer permissions")
        print("  2. Property ID is correct (GA4 property)")
        print("  3. Credentials file is valid JSON")
        print("  4. Google Analytics Data API is enabled in your project")
        sys.exit(1)
    finally:
        # Clean up temporary credentials file if created
        if temp_credentials_file and temp_credentials_file.exists():
            try:
                temp_credentials_file.unlink()
            except Exception:
                pass  # Ignore cleanup errors


if __name__ == "__main__":
    main()
