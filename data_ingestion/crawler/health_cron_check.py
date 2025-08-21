#!/usr/bin/env python3
"""
Hourly health check cron job for the website crawler.

This script performs health checks on the crawler and sends email alerts if issues are detected.
It provides comprehensive health monitoring for the website crawler system as a standalone cron job.

Usage:
    python health_cron_check.py --site ananda-public

Cron setup (run every hour):
    0 * * * * cd /path/to/ananda-library-chatbot && python data_ingestion/crawler/health_cron_check.py --site ananda-public
"""

import argparse
import logging
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Add parent directories to path for imports
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)  # data_ingestion
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)  # project root

# No longer importing load_config - we'll construct database path directly

# Import crawler-specific alerts after setting up sys.path
from data_ingestion.crawler.crawler_alerts import (
    send_crawler_process_down_alert,
    send_crawler_wedged_alert,
    send_database_error_alert,
)
from pyutil.email_ops import send_ops_alert_sync
from pyutil.env_utils import load_env
from pyutil.logging_utils import configure_logging

# Alert rate limiting - prevent spam for recurring issues
LAST_ALERT_TIMES: dict[str, datetime] = {}
ALERT_COOLDOWN_MINUTES = 60  # Don't send same alert type more than once per hour


def should_send_alert(alert_type: str) -> bool:
    """Check if we should send an alert based on rate limiting."""
    current_time = datetime.now()

    if alert_type in LAST_ALERT_TIMES:
        time_since_last = current_time - LAST_ALERT_TIMES[alert_type]
        minutes_since_last = time_since_last.total_seconds() / 60

        if minutes_since_last < ALERT_COOLDOWN_MINUTES:
            minutes_left = ALERT_COOLDOWN_MINUTES - minutes_since_last
            logging.info(
                f"Rate limiting alert '{alert_type}' - sent {minutes_since_last:.1f} minutes ago, "
                f"waiting {minutes_left:.1f} more minutes"
            )
            return False

    LAST_ALERT_TIMES[alert_type] = current_time
    return True


def get_database_stats(db_file: Path) -> dict[str, Any]:
    """Get statistics from the crawler database."""
    if not db_file or not db_file.exists():
        return {
            "error": "Database file not found",
            "database_exists": False,
            "database_path": str(db_file) if db_file else "Unknown",
        }

    try:
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Get queue statistics
        cursor.execute("""
            SELECT status, COUNT(*) as count 
            FROM crawl_queue 
            GROUP BY status
        """)
        status_counts = {row["status"]: row["count"] for row in cursor.fetchall()}

        # Get total count
        cursor.execute("SELECT COUNT(*) as total FROM crawl_queue")
        total_count = cursor.fetchone()["total"]

        # Get URLs ready for crawling
        cursor.execute("""
            SELECT COUNT(*) as ready FROM crawl_queue 
            WHERE (
                (status = 'pending' AND (retry_after IS NULL OR retry_after <= datetime('now'))) 
                OR 
                (status = 'visited' AND next_crawl <= datetime('now'))
            )
        """)
        ready_count = cursor.fetchone()["ready"]

        # Get last activity timestamp (use last_crawl as the activity indicator)
        cursor.execute("""
            SELECT last_crawl 
            FROM crawl_queue 
            WHERE last_crawl IS NOT NULL 
            ORDER BY last_crawl DESC 
            LIMIT 1
        """)
        last_activity_row = cursor.fetchone()
        last_activity = last_activity_row["last_crawl"] if last_activity_row else None

        conn.close()

        return {
            "database_exists": True,
            "total_urls": total_count,
            "ready_for_crawling": ready_count,
            "status_breakdown": status_counts,
            "last_activity": last_activity,
        }

    except Exception as e:
        logging.error(f"Database error: {e}")
        return {
            "error": str(e),
            "database_exists": True,
            "database_path": str(db_file),
        }


def get_crawler_process_info(site_id: str) -> dict[str, Any]:
    """Check if crawler processes are running."""
    try:
        import psutil

        crawler_processes = []
        for proc in psutil.process_iter(["pid", "name", "cmdline", "create_time"]):
            try:
                cmdline = proc.info["cmdline"]
                # Check if this is a crawler process for our site
                if (
                    cmdline
                    and any("website_crawler.py" in arg for arg in cmdline)
                    and any(
                        f"--site {site_id}" in " ".join(cmdline)
                        or f"--site={site_id}" in " ".join(cmdline)
                        for _ in [None]
                    )
                ):
                    crawler_processes.append(
                        {
                            "pid": proc.info["pid"],
                            "name": proc.info["name"],
                            "create_time": proc.info["create_time"],
                        }
                    )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        return {
            "crawler_running": len(crawler_processes) > 0,
            "process_count": len(crawler_processes),
            "processes": crawler_processes,
        }

    except ImportError:
        logging.warning("psutil not available - cannot check process status")
        return {
            "crawler_running": None,
            "process_count": 0,
            "processes": [],
            "error": "psutil not available",
        }
    except Exception as e:
        logging.error(f"Process check error: {e}")
        return {
            "crawler_running": False,
            "process_count": 0,
            "processes": [],
            "error": str(e),
        }


def get_log_activity_status(site_id: str) -> dict[str, Any]:
    """Check log activity to detect if crawler is wedged."""
    try:
        # Check the actual log location used by the crawler
        log_dir = Path.home() / "Library" / "Logs" / "AnandaCrawler"
        log_file = log_dir / f"crawler-{site_id}.log"

        if not log_file.exists():
            return {
                "is_wedged": True,
                "error": f"Log file not found: {log_file}",
                "minutes_since_activity": None,
            }

        # Get the modification time of the log file
        mod_time = datetime.fromtimestamp(log_file.stat().st_mtime)
        current_time = datetime.now()
        time_diff = current_time - mod_time
        minutes_since_activity = int(time_diff.total_seconds() / 60)

        # Consider crawler wedged if no activity for more than 65 minutes
        # (normal wake-up interval is 60 minutes)
        is_wedged = minutes_since_activity > 65

        return {
            "is_wedged": is_wedged,
            "minutes_since_activity": minutes_since_activity,
            "last_log_update": mod_time.isoformat(),
            "error": None,
        }

    except Exception as e:
        logging.error(f"Log activity check error: {e}")
        return {
            "is_wedged": True,
            "error": str(e),
            "minutes_since_activity": None,
        }


def check_database_health(db_stats: dict, site_id: str) -> list[str]:
    """Check database health and send alerts if needed."""
    issues = []

    if not db_stats.get("database_exists", False):
        issues.append("Database file not found")

        # Send email alert for database missing
        if should_send_alert("database_missing"):
            try:
                send_database_error_alert(site_id, "Database file not found")
                logging.info("Sent email alert for missing database file")
            except Exception as e:
                logging.error(f"Failed to send database missing alert: {e}")

    if "error" in db_stats:
        error_msg = db_stats["error"]
        issues.append(f"Database error: {error_msg}")

        # Send email alert for database error
        if should_send_alert("database_error"):
            try:
                send_database_error_alert(site_id, error_msg)
                logging.info(f"Sent email alert for database error: {error_msg}")
            except Exception as e:
                logging.error(f"Failed to send database error alert: {e}")

    return issues


def check_process_health(process_info: dict, site_id: str) -> list[str]:
    """Check process health and send alerts if needed."""
    issues = []

    if not process_info.get("crawler_running"):
        issues.append("No crawler processes detected")

        # Send email alert for process down
        if should_send_alert("process_down"):
            try:
                send_crawler_process_down_alert(site_id)
                logging.info("Sent email alert for crawler process down")
            except Exception as e:
                logging.error(f"Failed to send process down alert: {e}")

    return issues


def check_log_activity_health(log_activity: dict, site_id: str) -> list[str]:
    """Check log activity health and send alerts if needed."""
    issues = []

    if not log_activity.get("is_wedged", False):
        return issues

    if log_activity.get("error"):
        issues.append(f"Log activity check failed: {log_activity['error']}")
    elif log_activity.get("minutes_since_activity") is not None:
        minutes = log_activity["minutes_since_activity"]
        issues.append(
            f"Crawler appears wedged - no activity for {minutes} minutes (expected: hourly wake-ups)"
        )

        # Send email alert for wedged crawler
        if should_send_alert("wedged"):
            try:
                send_crawler_wedged_alert(site_id, minutes)
                logging.info(f"Sent email alert for wedged crawler ({minutes} minutes)")
            except Exception as e:
                logging.error(f"Failed to send wedged crawler alert: {e}")
    else:
        issues.append("Crawler appears wedged - no recent activity detected")

        # Send email alert for wedged crawler (unknown duration)
        if should_send_alert("wedged"):
            try:
                send_crawler_wedged_alert(
                    site_id, 999
                )  # Use 999 to indicate unknown duration
                logging.info("Sent email alert for wedged crawler (unknown duration)")
            except Exception as e:
                logging.error(f"Failed to send wedged crawler alert: {e}")

    return issues


def perform_health_check(site_id: str) -> dict[str, Any]:
    """Perform complete health check and return results."""
    timestamp = datetime.now().isoformat()

    # Construct database path directly
    script_dir = Path(__file__).parent
    db_dir = script_dir / "db"
    db_file = db_dir / f"crawler_queue_{site_id}.db"

    # Get health data
    db_stats = get_database_stats(db_file)
    process_info = get_crawler_process_info(site_id)
    log_activity = get_log_activity_status(site_id)

    # Check for issues and send alerts
    all_issues = []
    all_issues.extend(check_database_health(db_stats, site_id))
    all_issues.extend(check_process_health(process_info, site_id))
    all_issues.extend(check_log_activity_health(log_activity, site_id))

    # Determine overall status
    if all_issues:
        if any("Database" in issue for issue in all_issues):
            status = "degraded"
        else:
            status = "warning"
    else:
        status = "healthy"

    return {
        "timestamp": timestamp,
        "site_id": site_id,
        "status": status,
        "issues": all_issues,
        "database": db_stats,
        "processes": process_info,
        "log_activity": log_activity,
    }


def main():
    """Main entry point for the health check cron job."""
    parser = argparse.ArgumentParser(description="Crawler health check cron job")
    parser.add_argument(
        "--site", required=True, help="Site ID to check (e.g., ananda-public)"
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    # Configure logging
    configure_logging(debug=args.debug)

    # Load environment for the site
    try:
        load_env(args.site)
        logging.info(f"Loaded environment for site: {args.site}")
    except Exception as e:
        logging.error(f"Failed to load environment for site {args.site}: {e}")
        sys.exit(1)

    # Perform health check
    try:
        logging.info(f"Starting health check for site: {args.site}")
        health_data = perform_health_check(args.site)

        # Log results
        status = health_data["status"]
        issues_count = len(health_data["issues"])

        if status == "healthy":
            logging.info(f"Health check completed: {status} (no issues)")
        else:
            logging.warning(f"Health check completed: {status} ({issues_count} issues)")
            for issue in health_data["issues"]:
                logging.warning(f"  - {issue}")

        # Log key statistics
        db_stats = health_data.get("database", {})
        if db_stats.get("database_exists"):
            total_urls = db_stats.get("total_urls", 0)
            ready_urls = db_stats.get("ready_for_crawling", 0)
            logging.info(
                f"Database stats: {total_urls} total URLs, {ready_urls} ready for crawling"
            )

        process_info = health_data.get("processes", {})
        if process_info.get("crawler_running"):
            logging.info(
                f"Crawler process: running ({process_info.get('process_count', 0)} processes)"
            )

        # Exit with appropriate code
        if status == "error":
            sys.exit(2)
        elif status in ["degraded", "warning"]:
            sys.exit(1)
        else:
            sys.exit(0)

    except Exception as e:
        logging.error(f"Health check failed: {e}")

        # Send critical error alert
        try:
            send_ops_alert_sync(
                subject="🔴 Health Check Script Failure",
                message=f"The health check cron job for site '{args.site}' encountered a critical error.",
                error_details={
                    "error": e,
                    "context": {
                        "site_id": args.site,
                        "script": "health_cron_check.py",
                    },
                },
            )
        except Exception as alert_error:
            logging.error(f"Failed to send critical error alert: {alert_error}")

        sys.exit(2)


if __name__ == "__main__":
    main()
