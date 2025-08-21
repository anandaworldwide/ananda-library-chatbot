#!/usr/bin/env python3
"""
Daily health report generator for the website crawler.

This script generates and sends a comprehensive daily health report via email,
similar to the dashboard but in email format. It provides a detailed overview
of crawler health, statistics, and recent activity.

Usage:
    python health_daily_report.py --site ananda-public

Cron setup (run daily at 9 AM):
    0 9 * * * cd /path/to/ananda-library-chatbot && python data_ingestion/crawler/health_daily_report.py --site ananda-public
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

from pyutil.email_ops import send_ops_alert_sync
from pyutil.env_utils import load_env
from pyutil.logging_utils import configure_logging


def format_user_friendly_timestamp(iso_timestamp):
    """Convert ISO timestamp to user-friendly format like 'August 20th, 2025 at 2:03 PM'."""
    if not iso_timestamp:
        return "Never"

    try:
        # Handle both full ISO format and truncated format
        if isinstance(iso_timestamp, str):
            # Remove microseconds if present and parse
            if "." in iso_timestamp:
                iso_timestamp = iso_timestamp.split(".")[0]
            if "T" in iso_timestamp:
                dt = datetime.fromisoformat(iso_timestamp.replace("T", " "))
            else:
                dt = datetime.fromisoformat(iso_timestamp)
        elif isinstance(iso_timestamp, datetime):
            dt = iso_timestamp
        else:
            return str(iso_timestamp)

        # Format as "August 20th, 2025 at 2:03 PM"
        day = dt.day
        if 4 <= day <= 20 or 24 <= day <= 30:
            suffix = "th"
        else:
            suffix = ["st", "nd", "rd"][day % 10 - 1]

        formatted_date = dt.strftime(f"%B {day}{suffix}, %Y at %-I:%M %p")
        return formatted_date

    except (ValueError, AttributeError) as e:
        logging.warning(f"Error formatting timestamp {iso_timestamp}: {e}")
        return str(iso_timestamp)


def get_comprehensive_database_stats(db_file: Path) -> dict[str, Any]:
    """Get comprehensive statistics from the crawler database for daily report."""
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
            round(avg_retries_result["avg_retries"], 2)
            if avg_retries_result["avg_retries"]
            else 0
        )

        # Get recent crawling activity (last 24 hours)
        cursor.execute("""
            SELECT COUNT(*) as recent_crawls
            FROM crawl_queue 
            WHERE last_crawl >= datetime('now', '-1 day')
        """)
        recent_crawls = cursor.fetchone()["recent_crawls"]

        # Get crawling activity breakdown by status in last 24 hours
        cursor.execute("""
            SELECT 
                COUNT(*) as total_attempts,
                SUM(CASE WHEN status = 'visited' THEN 1 ELSE 0 END) as successful_crawls,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_crawls,
                SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) as retried_urls
            FROM crawl_queue 
            WHERE last_crawl >= datetime('now', '-1 day')
        """)
        activity_stats = cursor.fetchone()

        # Get hourly activity distribution for last 24 hours
        cursor.execute("""
            SELECT 
                strftime('%H', last_crawl) as hour,
                COUNT(*) as crawl_count
            FROM crawl_queue 
            WHERE last_crawl >= datetime('now', '-1 day')
            GROUP BY strftime('%H', last_crawl)
            ORDER BY hour
        """)
        hourly_activity = {row["hour"]: row["crawl_count"] for row in cursor.fetchall()}

        # Get average crawl time (if we have timing data)
        cursor.execute("""
            SELECT COUNT(*) as has_timing_data
            FROM pragma_table_info('crawl_queue') 
            WHERE name = 'crawl_duration'
        """)
        has_timing = cursor.fetchone()["has_timing_data"] > 0

        avg_crawl_time = None
        if has_timing:
            cursor.execute("""
                SELECT AVG(crawl_duration) as avg_duration
                FROM crawl_queue 
                WHERE last_crawl >= datetime('now', '-1 day') 
                AND crawl_duration IS NOT NULL
            """)
            duration_result = cursor.fetchone()
            if duration_result and duration_result["avg_duration"]:
                avg_crawl_time = round(duration_result["avg_duration"], 2)

        # Get last activity timestamp
        cursor.execute("""
            SELECT last_crawl 
            FROM crawl_queue 
            WHERE last_crawl IS NOT NULL 
            ORDER BY last_crawl DESC 
            LIMIT 1
        """)
        last_activity_row = cursor.fetchone()
        last_activity = last_activity_row["last_crawl"] if last_activity_row else None

        # Get crawl frequency distribution
        cursor.execute("""
            SELECT crawl_frequency, COUNT(*) as count
            FROM crawl_queue 
            GROUP BY crawl_frequency
            ORDER BY crawl_frequency
        """)
        frequency_distribution = {
            row["crawl_frequency"]: row["count"] for row in cursor.fetchall()
        }

        # Get failed URLs count
        failed_count = status_counts.get("failed", 0)

        # Get next crawl distribution (how many URLs are due for crawling)
        cursor.execute("""
            SELECT 
                COUNT(*) as overdue
            FROM crawl_queue 
            WHERE status = 'visited' 
            AND next_crawl <= datetime('now')
        """)
        overdue_count = cursor.fetchone()["overdue"]

        conn.close()

        return {
            "database_exists": True,
            "total_urls": total_count,
            "ready_for_crawling": ready_count,
            "status_breakdown": status_counts,
            "high_priority_count": high_priority_count,
            "pending_retry_count": pending_retry_count,
            "average_retries": avg_retries,
            "recent_updates_24h": recent_crawls,
            "failed_count": failed_count,
            "overdue_count": overdue_count,
            "frequency_distribution": frequency_distribution,
            "last_activity": last_activity,
            # New 24-hour activity statistics
            "activity_24h": {
                "total_attempts": activity_stats["total_attempts"]
                if activity_stats
                else 0,
                "successful_crawls": activity_stats["successful_crawls"]
                if activity_stats
                else 0,
                "failed_crawls": activity_stats["failed_crawls"]
                if activity_stats
                else 0,
                "retried_urls": activity_stats["retried_urls"] if activity_stats else 0,
                "hourly_distribution": hourly_activity,
                "average_crawl_time": avg_crawl_time,
                "success_rate": round(
                    activity_stats["successful_crawls"]
                    / activity_stats["total_attempts"]
                    * 100
                )
                if activity_stats and activity_stats["total_attempts"] > 0
                else 0,
            },
        }

    except Exception as e:
        logging.error(f"Database error: {e}")
        return {
            "error": str(e),
            "database_exists": True,
            "database_path": str(db_file),
        }


def get_process_status(site_id: str) -> dict[str, Any]:
    """Get detailed process status for daily report."""
    try:
        import psutil

        crawler_processes = []
        total_cpu_percent = 0
        total_memory_mb = 0

        for proc in psutil.process_iter(
            ["pid", "name", "cmdline", "create_time", "cpu_percent", "memory_info"]
        ):
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
                    # Get CPU and memory info
                    cpu_percent = proc.cpu_percent()
                    memory_info = proc.memory_info()
                    memory_mb = memory_info.rss / 1024 / 1024

                    total_cpu_percent += cpu_percent
                    total_memory_mb += memory_mb

                    # Calculate uptime
                    create_time = datetime.fromtimestamp(proc.info["create_time"])
                    uptime = datetime.now() - create_time

                    crawler_processes.append(
                        {
                            "pid": proc.info["pid"],
                            "name": proc.info["name"],
                            "create_time": create_time.isoformat(),
                            "uptime_hours": round(uptime.total_seconds() / 3600, 1),
                            "cpu_percent": round(cpu_percent, 1),
                            "memory_mb": round(memory_mb, 1),
                        }
                    )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        return {
            "crawler_running": len(crawler_processes) > 0,
            "process_count": len(crawler_processes),
            "processes": crawler_processes,
            "total_cpu_percent": round(total_cpu_percent, 1),
            "total_memory_mb": round(total_memory_mb, 1),
        }

    except ImportError:
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


def get_log_summary(site_id: str) -> dict[str, Any]:
    """Get log activity summary for the daily report."""
    try:
        # Check the actual log location used by the crawler
        log_dir = Path.home() / "Library" / "Logs" / "AnandaCrawler"
        log_file = log_dir / f"crawler-{site_id}.log"

        if not log_file.exists():
            return {
                "log_file_exists": False,
                "error": f"Log file not found: {log_file}",
            }

        # Get file stats
        stat = log_file.stat()
        mod_time = datetime.fromtimestamp(stat.st_mtime)
        file_size_mb = round(stat.st_size / 1024 / 1024, 2)

        # Calculate time since last update
        current_time = datetime.now()
        time_diff = current_time - mod_time
        minutes_since_update = int(time_diff.total_seconds() / 60)

        # Try to read recent log entries for activity summary
        activity_summary = "Unable to read log contents"
        try:
            with open(log_file, encoding="utf-8", errors="ignore") as f:
                # Read last 50 lines to get recent activity
                lines = f.readlines()
                recent_lines = lines[-50:] if len(lines) > 50 else lines

                # Count different types of log entries in recent activity
                error_count = sum(1 for line in recent_lines if "ERROR" in line)
                warning_count = sum(1 for line in recent_lines if "WARNING" in line)
                info_count = sum(1 for line in recent_lines if "INFO" in line)

                activity_summary = f"{len(recent_lines)} recent log entries: {error_count} errors, {warning_count} warnings, {info_count} info"

        except Exception as e:
            activity_summary = f"Error reading log file: {e}"

        return {
            "log_file_exists": True,
            "last_updated": mod_time.isoformat(),
            "minutes_since_update": minutes_since_update,
            "file_size_mb": file_size_mb,
            "activity_summary": activity_summary,
            "is_recent": minutes_since_update < 70,  # Within expected hourly cycle
        }

    except Exception as e:
        logging.error(f"Log summary error: {e}")
        return {
            "log_file_exists": False,
            "error": str(e),
        }


def generate_subject_line(site_id: str, health_data: dict) -> str:
    """Generate subject line with critical key statistics."""
    db_stats = health_data.get("database", {})
    process_info = health_data.get("processes", {})
    activity_24h = db_stats.get("activity_24h", {})

    # Get key metrics for subject line
    total_urls = db_stats.get("total_urls", 0)
    ready_urls = db_stats.get("ready_for_crawling", 0)
    process_count = process_info.get("process_count", 0)

    # Get 24-hour activity stats
    crawls_24h = activity_24h.get("successful_crawls", 0)
    success_rate = activity_24h.get("success_rate", 0)

    # Determine status indicator
    status = health_data.get("status", "unknown")
    status_emoji = {
        "healthy": "✅",
        "warning": "⚠️",
        "degraded": "❌",
        "error": "💥",
    }.get(status, "❓")

    # Build subject with daily activity first, then totals (remove redundant site name)
    # Only include process count if there are issues
    if status == "healthy":
        if crawls_24h > 0:
            subject = f"{status_emoji} Daily Report: {crawls_24h:,} crawls ({success_rate}% success), {total_urls:,} total URLs, {ready_urls:,} ready"
        else:
            subject = f"{status_emoji} Daily Report: No crawls today, {total_urls:,} total URLs, {ready_urls:,} ready"
    else:
        if crawls_24h > 0:
            subject = f"{status_emoji} Daily Report: {crawls_24h:,} crawls ({success_rate}% success), {total_urls:,} total URLs, {ready_urls:,} ready, {process_count} process{'es' if process_count != 1 else ''}"
        else:
            subject = f"{status_emoji} Daily Report: No crawls today, {total_urls:,} total URLs, {ready_urls:,} ready, {process_count} process{'es' if process_count != 1 else ''}"

    return subject


def generate_html_report(site_id: str, health_data: dict) -> str:
    """Generate HTML email report similar to the dashboard."""
    timestamp = health_data.get("timestamp", datetime.now().isoformat())
    status = health_data.get("status", "unknown")
    db_stats = health_data.get("database", {})
    process_info = health_data.get("processes", {})
    log_info = health_data.get("log_summary", {})

    # Status styling
    status_colors = {
        "healthy": "#48bb78",
        "warning": "#ed8936",
        "degraded": "#f56565",
        "error": "#e53e3e",
    }
    status_color = status_colors.get(status, "#718096")

    # Build status breakdown table
    status_breakdown = db_stats.get("status_breakdown", {})
    status_rows = ""
    for status_name, count in status_breakdown.items():
        status_rows += f"""
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{status_name.title()}</td>
            <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: bold;">{count:,}</td>
        </tr>"""

    # Build process information
    processes = process_info.get("processes", [])
    process_rows = ""
    if processes:
        for proc in processes:
            process_rows += f"""
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">PID {proc["pid"]}</td>
                <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{proc["uptime_hours"]}h</td>
                <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">{proc["cpu_percent"]}%</td>
                <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">{proc["memory_mb"]} MB</td>
            </tr>"""
    else:
        process_rows = '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #f56565;">No crawler processes detected</td></tr>'

    # Format last activity
    last_activity = db_stats.get("last_activity")
    formatted_last_activity = (
        format_user_friendly_timestamp(last_activity) if last_activity else "Never"
    )

    # Format log update time
    log_last_updated = log_info.get("last_updated")
    formatted_log_updated = (
        format_user_friendly_timestamp(log_last_updated)
        if log_last_updated
        else "Unknown"
    )

    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Health Report - {site_id}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f7fafc;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            text-align: center;
            margin-bottom: 30px;
        }}
        .header h1 {{
            margin: 0;
            font-size: 28px;
            font-weight: 600;
        }}
        .status-badge {{
            display: inline-block;
            padding: 8px 16px;
            border-radius: 20px;
            font-weight: bold;
            margin-top: 10px;
            background-color: {status_color};
            color: white;
            text-transform: uppercase;
            font-size: 14px;
        }}
        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }}
        .stat-card {{
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            text-align: center;
        }}
        .stat-value {{
            font-size: 32px;
            font-weight: bold;
            color: #2d3748;
            margin-bottom: 5px;
        }}
        .stat-label {{
            color: #718096;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }}
        .section {{
            background: white;
            margin-bottom: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }}
        .section-header {{
            background: #f7fafc;
            padding: 15px 20px;
            border-bottom: 1px solid #e2e8f0;
            font-weight: 600;
            color: #2d3748;
        }}
        .section-content {{
            padding: 20px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        th {{
            background: #f7fafc;
            padding: 12px 8px;
            text-align: left;
            font-weight: 600;
            color: #4a5568;
            border-bottom: 2px solid #e2e8f0;
        }}
        td {{
            padding: 8px;
            border-bottom: 1px solid #e2e8f0;
        }}
        .footer {{
            text-align: center;
            color: #718096;
            font-size: 12px;
            margin-top: 40px;
            padding: 20px;
        }}
        .alert {{
            background: #fed7d7;
            border: 1px solid #feb2b2;
            color: #c53030;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
        }}
        .success {{
            background: #c6f6d5;
            border: 1px solid #9ae6b4;
            color: #276749;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Daily Health Report</h1>
        <div style="font-size: 18px; opacity: 0.9;">{site_id.upper()}</div>
        <div class="status-badge">{status}</div>
        <div style="margin-top: 15px; font-size: 14px; opacity: 0.8;">
            Generated on {format_user_friendly_timestamp(timestamp)}
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">{db_stats.get("total_urls", 0):,}</div>
            <div class="stat-label">Total URLs</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{db_stats.get("ready_for_crawling", 0):,}</div>
            <div class="stat-label">Ready to Crawl</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{process_info.get("process_count", 0)}</div>
            <div class="stat-label">Active Processes</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{db_stats.get("recent_updates_24h", 0):,}</div>
            <div class="stat-label">24h Updates</div>
        </div>
    </div>

    {"".join([f'<div class="alert">• {issue}</div>' for issue in health_data.get("issues", [])]) if health_data.get("issues") else '<div class="success">✅ All systems healthy - no issues detected</div>'}

    <div class="section">
        <div class="section-header">Queue Status Breakdown</div>
        <div class="section-content">
            <table>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th style="text-align: right;">Count</th>
                    </tr>
                </thead>
                <tbody>
                    {status_rows}
                </tbody>
            </table>
        </div>
    </div>

    <div class="section">
        <div class="section-header">Crawler Processes</div>
        <div class="section-content">
            <table>
                <thead>
                    <tr>
                        <th>Process</th>
                        <th>Uptime</th>
                        <th>CPU</th>
                        <th style="text-align: right;">Memory</th>
                    </tr>
                </thead>
                <tbody>
                    {process_rows}
                </tbody>
            </table>
            {f'<div style="margin-top: 15px; font-size: 14px; color: #718096;">Total Resource Usage: {process_info.get("total_cpu_percent", 0)}% CPU, {process_info.get("total_memory_mb", 0)} MB Memory</div>' if process_info.get("processes") else ""}
        </div>
    </div>

    <div class="section">
        <div class="section-header">24-Hour Crawling Activity</div>
        <div class="section-content">
            <div class="stats-grid" style="margin-bottom: 20px;">
                <div class="stat-card">
                    <div class="stat-value">{db_stats.get("activity_24h", {}).get("total_attempts", 0):,}</div>
                    <div class="stat-label">Total Attempts</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{db_stats.get("activity_24h", {}).get("successful_crawls", 0):,}</div>
                    <div class="stat-label">Successful</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{db_stats.get("activity_24h", {}).get("success_rate", 0)}%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{db_stats.get("activity_24h", {}).get("failed_crawls", 0):,}</div>
                    <div class="stat-label">Failed</div>
                </div>
            </div>
            
            <table>
                <tbody>
                    <tr>
                        <td style="font-weight: 600;">URLs Requiring Retries</td>
                        <td>{db_stats.get("activity_24h", {}).get("retried_urls", 0):,}</td>
                    </tr>
                    {f'<tr><td style="font-weight: 600;">Average Crawl Time</td><td>{db_stats.get("activity_24h", {}).get("average_crawl_time")} seconds</td></tr>' if db_stats.get("activity_24h", {}).get("average_crawl_time") else ""}
                    <tr>
                        <td style="font-weight: 600;">Most Active Hour</td>
                        <td>{max(db_stats.get("activity_24h", {}).get("hourly_distribution", {}).items(), key=lambda x: x[1], default=("No activity", 0))[0]}:00 ({max(db_stats.get("activity_24h", {}).get("hourly_distribution", {}).values(), default=0)} crawls)</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="section">
        <div class="section-header">System Summary</div>
        <div class="section-content">
            <table>
                <tbody>
                    <tr>
                        <td style="font-weight: 600;">Last Database Activity</td>
                        <td>{formatted_last_activity}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 600;">Last Log Update</td>
                        <td>{formatted_log_updated}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 600;">High Priority URLs</td>
                        <td>{db_stats.get("high_priority_count", 0):,}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 600;">Pending Retries</td>
                        <td>{db_stats.get("pending_retry_count", 0):,}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 600;">Average Retries</td>
                        <td>{db_stats.get("average_retries", 0)}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 600;">Overdue for Crawling</td>
                        <td>{db_stats.get("overdue_count", 0):,}</td>
                    </tr>
                    <tr>
                        <td style="font-weight: 600;">Log Activity</td>
                        <td>{log_info.get("activity_summary", "No activity information available")}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div class="footer">
        <p>This automated report was generated by the Ananda Library Chatbot crawler health monitoring system.</p>
        <p>For technical support or questions, please contact the operations team.</p>
    </div>
</body>
</html>"""

    return html_content


def generate_daily_report(site_id: str) -> dict[str, Any]:
    """Generate comprehensive daily health report."""
    timestamp = datetime.now().isoformat()

    # Construct database path directly
    script_dir = Path(__file__).parent
    db_dir = script_dir / "db"
    db_file = db_dir / f"crawler_queue_{site_id}.db"

    # Get comprehensive health data
    db_stats = get_comprehensive_database_stats(db_file)
    process_info = get_process_status(site_id)
    log_summary = get_log_summary(site_id)

    # Determine overall status and collect issues
    status = "healthy"
    issues = []

    # Check for issues (but don't send individual alerts - this is just reporting)
    if not db_stats.get("database_exists", False):
        issues.append("Database file not found")
        status = "degraded"

    if "error" in db_stats:
        issues.append(f"Database error: {db_stats['error']}")
        status = "degraded"

    if not process_info.get("crawler_running"):
        issues.append("No crawler processes detected")
        if status == "healthy":
            status = "warning"

    if not log_summary.get("is_recent", True) and log_summary.get("log_file_exists"):
        minutes = log_summary.get("minutes_since_update", 0)
        if minutes > 70:  # More than 70 minutes since last log update
            issues.append(f"Log not recently updated ({minutes} minutes ago)")
            if status == "healthy":
                status = "warning"

    return {
        "timestamp": timestamp,
        "site_id": site_id,
        "status": status,
        "issues": issues,
        "database": db_stats,
        "processes": process_info,
        "log_summary": log_summary,
    }


def send_daily_report(site_id: str, health_data: dict) -> bool:
    """Send the daily health report via email."""
    try:
        # Generate subject line with key stats
        subject = generate_subject_line(site_id, health_data)

        # Generate HTML email content
        html_content = generate_html_report(site_id, health_data)

        # Create plain text version as fallback
        status = health_data.get("status", "unknown")
        db_stats = health_data.get("database", {})
        process_info = health_data.get("processes", {})
        issues = health_data.get("issues", [])

        # Get 24-hour activity stats for plain text
        activity_24h = db_stats.get("activity_24h", {})

        plain_text = f"""
Daily Health Report for {site_id.upper()}
Status: {status.upper()}

Key Statistics:
- Total URLs: {db_stats.get("total_urls", 0):,}
- Ready for crawling: {db_stats.get("ready_for_crawling", 0):,}
- Active processes: {process_info.get("process_count", 0)}

24-Hour Crawling Activity:
- Total crawl attempts: {activity_24h.get("total_attempts", 0):,}
- Successful crawls: {activity_24h.get("successful_crawls", 0):,}
- Failed crawls: {activity_24h.get("failed_crawls", 0):,}
- Success rate: {activity_24h.get("success_rate", 0)}%
- URLs requiring retries: {activity_24h.get("retried_urls", 0):,}
{f"- Average crawl time: {activity_24h.get('average_crawl_time')} seconds" if activity_24h.get("average_crawl_time") else ""}

"""

        if issues:
            plain_text += "Issues Detected:\n"
            for issue in issues:
                plain_text += f"- {issue}\n"
        else:
            plain_text += "✅ All systems healthy - no issues detected\n"

        plain_text += """
Database Status Breakdown:
"""
        for status_name, count in db_stats.get("status_breakdown", {}).items():
            plain_text += f"- {status_name.title()}: {count:,}\n"

        plain_text += """
This automated report was generated by the Ananda Library Chatbot crawler health monitoring system.
"""

        # Send email using existing email infrastructure
        # We'll use send_ops_alert_sync with custom HTML content
        # Only include error details if there are issues (not healthy status)
        error_details = {"html_content": html_content}  # Always include HTML content

        if status != "healthy":
            # Only add context details for non-healthy status to avoid "Error Details" section
            error_details["context"] = {
                "site_id": site_id,
                "report_type": "daily_health_report",
                "status": status,
                "timestamp": health_data.get("timestamp"),
            }

        success = send_ops_alert_sync(
            subject=subject,
            message=plain_text,
            error_details=error_details,
        )

        return success

    except Exception as e:
        logging.error(f"Failed to send daily report: {e}")
        return False


def main():
    """Main entry point for the daily health report."""
    parser = argparse.ArgumentParser(
        description="Generate and send daily health report"
    )
    parser.add_argument(
        "--site", required=True, help="Site ID to report on (e.g., ananda-public)"
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

    # Generate and send daily report
    try:
        logging.info(f"Generating daily health report for site: {args.site}")
        health_data = generate_daily_report(args.site)

        # Log report summary
        status = health_data["status"]
        issues_count = len(health_data["issues"])

        logging.info(f"Report generated: {status} status with {issues_count} issues")

        # Send the report
        logging.info("Sending daily health report email...")
        success = send_daily_report(args.site, health_data)

        if success:
            logging.info("Daily health report sent successfully")
            sys.exit(0)
        else:
            logging.error("Failed to send daily health report")
            sys.exit(1)

    except Exception as e:
        logging.error(f"Daily report generation failed: {e}")

        # Send critical error alert
        try:
            send_ops_alert_sync(
                subject="Daily Report Script Failure",
                message=f"The daily health report script for site '{args.site}' encountered a critical error.",
                error_details={
                    "error": e,
                    "context": {
                        "site_id": args.site,
                        "script": "health_daily_report.py",
                    },
                },
            )
        except Exception as alert_error:
            logging.error(f"Failed to send critical error alert: {alert_error}")

        sys.exit(2)


if __name__ == "__main__":
    main()
