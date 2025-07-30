#!/usr/bin/env python3
"""
Flask-based health check server for the website crawler.

This server provides a `/health` endpoint that returns crawler status and statistics.
It can be run alongside the main crawler process to provide monitoring capabilities.

Usage:
    python health_server.py --site ananda-public --port 8080

The health endpoint returns JSON with:
- Crawler status (running/stopped)
- Queue statistics
- Last activity timestamp
- Database file info
- Configuration summary
"""

import argparse
import logging
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from crawler.website_crawler import load_config

app = Flask(__name__)

# Global variables to store crawler info
SITE_ID = None
SITE_CONFIG = None
DB_FILE = None


def get_database_stats() -> dict[str, Any]:
    """Get statistics from the crawler database."""
    if not DB_FILE or not DB_FILE.exists():
        return {
            "error": "Database file not found",
            "database_exists": False,
            "database_path": str(DB_FILE) if DB_FILE else "Unknown",
        }

    try:
        conn = sqlite3.connect(str(DB_FILE))
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

        # Get high priority URLs
        cursor.execute(
            "SELECT COUNT(*) as high_priority FROM crawl_queue WHERE priority > 0"
        )
        high_priority_count = cursor.fetchone()["high_priority"]

        # Get retry statistics
        cursor.execute("""
            SELECT COUNT(*) as pending_retry FROM crawl_queue 
            WHERE status = 'pending' 
            AND retry_after IS NOT NULL 
            AND retry_after > datetime('now')
        """)
        pending_retry_count = cursor.fetchone()["pending_retry"]

        # Get average retry count
        cursor.execute("""
            SELECT AVG(retry_count) as avg_retries 
            FROM crawl_queue 
            WHERE retry_count > 0
        """)
        avg_retries_result = cursor.fetchone()
        avg_retries = (
            round(avg_retries_result["avg_retries"], 1)
            if avg_retries_result["avg_retries"]
            else 0
        )

        # Get last activity
        cursor.execute("SELECT MAX(last_crawl) as last_activity FROM crawl_queue")
        last_activity_result = cursor.fetchone()
        last_activity = last_activity_result["last_activity"]

        # Get CSV tracking status
        cursor.execute("SELECT initial_crawl_completed FROM csv_tracking LIMIT 1")
        csv_result = cursor.fetchone()
        initial_crawl_completed = (
            bool(csv_result["initial_crawl_completed"]) if csv_result else False
        )

        conn.close()

        return {
            "database_exists": True,
            "database_path": str(DB_FILE),
            "database_size_mb": round(DB_FILE.stat().st_size / (1024 * 1024), 2),
            "total_urls": total_count,
            "ready_for_crawling": ready_count,
            "high_priority_urls": high_priority_count,
            "pending_retry": pending_retry_count,
            "average_retry_count": avg_retries,
            "last_activity": last_activity,
            "initial_crawl_completed": initial_crawl_completed,
            "status_breakdown": {
                "pending": status_counts.get("pending", 0),
                "visited": status_counts.get("visited", 0),
                "failed": status_counts.get("failed", 0),
            },
        }

    except Exception as e:
        logging.error(f"Error getting database stats: {e}")
        return {
            "error": f"Database error: {str(e)}",
            "database_exists": True,
            "database_path": str(DB_FILE),
        }


def get_crawler_process_info() -> dict[str, Any]:
    """Get information about running crawler processes."""
    try:
        import psutil

        # Look for crawler processes
        crawler_processes = []
        for proc in psutil.process_iter(
            ["pid", "name", "cmdline", "create_time", "cpu_percent", "memory_info"]
        ):
            try:
                if (
                    proc.info["cmdline"]
                    and any("website_crawler.py" in arg for arg in proc.info["cmdline"])
                    and SITE_ID
                    and any(
                        f"--site {SITE_ID}" in " ".join(proc.info["cmdline"])
                        or f"--site={SITE_ID}" in " ".join(proc.info["cmdline"])
                        for _ in [1]
                    )
                ):
                    crawler_processes.append(
                        {
                            "pid": proc.info["pid"],
                            "command": " ".join(proc.info["cmdline"]),
                            "started": datetime.fromtimestamp(
                                proc.info["create_time"]
                            ).isoformat(),
                            "cpu_percent": proc.info["cpu_percent"],
                            "memory_mb": round(
                                proc.info["memory_info"].rss / (1024 * 1024), 1
                            ),
                        }
                    )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        return {
            "crawler_processes": crawler_processes,
            "process_count": len(crawler_processes),
            "crawler_running": len(crawler_processes) > 0,
        }

    except ImportError:
        # psutil not available
        return {
            "error": "psutil not available - cannot check process status",
            "crawler_running": "unknown",
        }
    except Exception as e:
        return {"error": f"Process check error: {str(e)}", "crawler_running": "unknown"}


@app.route("/health")
def health_check():
    """Main health check endpoint."""
    timestamp = datetime.now().isoformat()

    # Get database statistics
    db_stats = get_database_stats()

    # Get process information
    process_info = get_crawler_process_info()

    # Determine overall health status
    health_status = "healthy"
    issues = []

    if not db_stats.get("database_exists", False):
        health_status = "degraded"
        issues.append("Database file not found")

    if "error" in db_stats:
        health_status = "degraded"
        issues.append(f"Database error: {db_stats['error']}")

    if not process_info.get("crawler_running"):
        health_status = "warning"
        issues.append("No crawler processes detected")

    response = {
        "timestamp": timestamp,
        "site_id": SITE_ID,
        "status": health_status,
        "issues": issues,
        "database": db_stats,
        "processes": process_info,
        "configuration": {
            "domain": SITE_CONFIG.get("domain") if SITE_CONFIG else "Unknown",
            "csv_mode_enabled": bool(SITE_CONFIG.get("csv_export_url"))
            if SITE_CONFIG
            else False,
            "crawl_frequency_days": SITE_CONFIG.get("crawl_frequency_days", "Unknown")
            if SITE_CONFIG
            else "Unknown",
        }
        if SITE_CONFIG
        else {"error": "Configuration not loaded"},
    }

    # Set appropriate HTTP status code
    status_code = 200
    if health_status == "degraded":
        status_code = 503  # Service Unavailable
    elif health_status == "warning":
        status_code = 200  # Still OK, just a warning

    return jsonify(response), status_code


@app.route("/stats")
def stats_endpoint():
    """Simplified stats endpoint for quick monitoring."""
    db_stats = get_database_stats()

    if not db_stats.get("database_exists", False):
        return jsonify({"error": "Database not available"}), 503

    return jsonify(
        {
            "timestamp": datetime.now().isoformat(),
            "site_id": SITE_ID,
            "total_urls": db_stats.get("total_urls", 0),
            "ready_for_crawling": db_stats.get("ready_for_crawling", 0),
            "status_breakdown": db_stats.get("status_breakdown", {}),
            "last_activity": db_stats.get("last_activity"),
        }
    )


@app.route("/")
def root():
    """Root endpoint with basic info."""
    return jsonify(
        {
            "service": "Website Crawler Health Check",
            "site_id": SITE_ID,
            "endpoints": {
                "/health": "Full health check with detailed statistics",
                "/stats": "Quick statistics summary",
                "/": "This information",
            },
            "timestamp": datetime.now().isoformat(),
        }
    )


def setup_logging(debug: bool = False):
    """Set up logging configuration."""
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    # Suppress Flask's default logging in production
    if not debug:
        logging.getLogger("werkzeug").setLevel(logging.WARNING)


def initialize_globals(site_id: str) -> bool:
    """Initialize global variables with site configuration."""
    global SITE_ID, SITE_CONFIG, DB_FILE

    SITE_ID = site_id

    # Load site configuration
    SITE_CONFIG = load_config(site_id)
    if not SITE_CONFIG:
        logging.error(f"Failed to load configuration for site '{site_id}'")
        return False

    # Set up database file path
    script_dir = Path(__file__).parent
    db_dir = script_dir / "db"
    DB_FILE = db_dir / f"crawler_queue_{site_id}.db"

    # Load environment variables
    project_root = script_dir.parent.parent
    env_file = project_root / f".env.{site_id}"

    if env_file.exists():
        load_dotenv(str(env_file))
        logging.info(f"Loaded environment from: {env_file}")
    else:
        logging.warning(f"Environment file not found: {env_file}")

    return True


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Health check server for website crawler"
    )
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID (e.g., ananda-public). Must match crawler configuration.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Port to run health check server on (default: 8080)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind server to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode with detailed logging"
    )
    return parser.parse_args()


def main():
    """Main entry point."""
    args = parse_arguments()

    setup_logging(args.debug)

    if not initialize_globals(args.site):
        sys.exit(1)

    logging.info(f"Starting health check server for site '{args.site}'")
    logging.info(f"Server will be available at http://{args.host}:{args.port}")
    logging.info(f"Health endpoint: http://{args.host}:{args.port}/health")

    try:
        app.run(
            host=args.host,
            port=args.port,
            debug=args.debug,
            use_reloader=False,  # Disable reloader to avoid issues with global state
        )
    except KeyboardInterrupt:
        logging.info("Health check server stopped by user")
    except Exception as e:
        logging.error(f"Health check server error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
