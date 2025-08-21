#!/usr/bin/env python3
"""
Crawler-specific alert functions.

This module contains alert functions specific to the website crawler system.
It uses the generic email_ops.py module for sending alerts.
"""

from pyutil.email_ops import send_ops_alert_sync


def send_crawler_wedged_alert(site_id: str, minutes_since_activity: int) -> bool:
    """Send alert when crawler appears to be wedged."""
    return send_ops_alert_sync(
        subject="🔴 Crawler Wedged",
        message=f"The crawler for site '{site_id}' appears to be wedged with no activity for {minutes_since_activity} minutes.",
        error_details={
            "context": {
                "site_id": site_id,
                "minutes_since_activity": minutes_since_activity,
                "expected_wake_interval": "60 minutes",
                "alert_threshold": "65 minutes",
            }
        },
    )


def send_crawler_process_down_alert(site_id: str) -> bool:
    """Send alert when no crawler processes are detected."""
    return send_ops_alert_sync(
        subject="🔴 Crawler Process Down",
        message=f"No crawler processes detected for site '{site_id}'. The crawler daemon may have stopped or crashed.",
        error_details={
            "context": {
                "site_id": site_id,
                "issue_type": "process_not_running",
                "recommended_action": "Check daemon status and restart if necessary",
            }
        },
    )


def send_database_error_alert(site_id: str, error_message: str) -> bool:
    """Send alert when database errors are detected."""
    return send_ops_alert_sync(
        subject="🔴 Crawler Database Error",
        message=f"Database error detected for site '{site_id}' crawler: {error_message}",
        error_details={
            "context": {
                "site_id": site_id,
                "issue_type": "database_error",
                "error_message": error_message,
            }
        },
    )
