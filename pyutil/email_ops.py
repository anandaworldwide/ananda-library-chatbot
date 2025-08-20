#!/usr/bin/env python3
"""
Email operations utilities for sending operational alerts via AWS SES.

This module provides utilities for sending operational alerts via email.
It uses AWS SES for email delivery and supports multiple recipient addresses.

Usage:
    from pyutil.email_ops import send_ops_alert

    await send_ops_alert(
        subject="Crawler Alert",
        message="Crawler has been wedged for 90 minutes",
        error_details={
            "error": exception_object,
            "context": {"site_id": "ananda-public", "minutes_since_activity": 90},
            "stack": traceback_string
        }
    )
"""

import asyncio
import json
import logging
import os
import traceback
from datetime import datetime
from typing import Any

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    AWS_AVAILABLE = True
except ImportError:
    AWS_AVAILABLE = False

logger = logging.getLogger(__name__)


async def send_ops_alert(
    subject: str, message: str, error_details: dict[str, Any] | None = None
) -> bool:
    """
    Sends an operational alert email to the configured ops team.

    Args:
        subject: Email subject line
        message: Email body content
        error_details: Optional error details to include in the email
            - error: Exception object
            - context: Dict with additional context information
            - stack: Stack trace string

    Returns:
        bool: True if email was sent successfully, false otherwise
    """
    try:
        ops_email = os.getenv("OPS_ALERT_EMAIL")
        if not ops_email:
            logger.error("OPS_ALERT_EMAIL environment variable is not set")
            return False

        # Split multiple email addresses by semicolon
        recipient_emails = [
            email.strip() for email in ops_email.split(";") if email.strip()
        ]

        if not recipient_emails:
            logger.error("No valid email addresses found in OPS_ALERT_EMAIL")
            return False

        # Suppress alerts during testing to prevent spam when tests intentionally fail
        if os.getenv("NODE_ENV") == "test" or os.getenv("PYTEST_CURRENT_TEST"):
            logger.info(f"[TEST MODE] Suppressing ops alert: {subject}")
            return True  # Return true to indicate successful "sending" for test compatibility

        if not AWS_AVAILABLE:
            logger.error("boto3 not available - cannot send email alerts")
            return False

        # Build email body with error details if provided
        email_body = message

        if error_details:
            email_body += "\n\n--- Error Details ---\n"

            if error_details.get("error"):
                error = error_details["error"]
                email_body += f"Error: {str(error)}\n"
                email_body += f"Type: {type(error).__name__}\n"

            if error_details.get("stack"):
                email_body += f"Stack Trace:\n{error_details['stack']}\n"

            if error_details.get("context"):
                email_body += (
                    f"Context: {json.dumps(error_details['context'], indent=2)}\n"
                )

        # Add timestamp and environment info
        email_body += "\n\n--- System Info ---\n"
        email_body += f"Timestamp: {datetime.now().isoformat()}\n"
        email_body += f"Environment: {os.getenv('NODE_ENV', 'unknown')}\n"
        email_body += f"Site ID: {os.getenv('SITE_ID', 'unknown')}\n"
        email_body += f"Python Version: {os.sys.version}\n"

        # Determine environment and site for subject line
        environment = "prod" if os.getenv("NODE_ENV") == "production" else "dev"
        site_name = os.getenv("SITE_ID", "unknown")

        # Create SES client
        ses_client = boto3.client(
            "ses",
            region_name=os.getenv("AWS_REGION", "us-east-1"),
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )

        # Send email to all recipients
        response = ses_client.send_email(
            Source=os.getenv("CONTACT_EMAIL", "noreply@ananda.org"),
            Destination={"ToAddresses": recipient_emails},
            Message={
                "Subject": {
                    "Data": f"[{environment.upper()}-{site_name}] {subject}",
                    "Charset": "UTF-8",
                },
                "Body": {"Text": {"Data": email_body, "Charset": "UTF-8"}},
            },
        )

        message_id = response.get("MessageId")
        logger.info(f"Ops alert sent successfully. MessageId: {message_id}")
        logger.info(f"Recipients: {', '.join(recipient_emails)}")

        return True

    except (BotoCoreError, ClientError) as aws_error:
        logger.error(f"AWS SES error sending ops alert: {aws_error}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error sending ops alert: {e}")
        logger.error(f"Stack trace: {traceback.format_exc()}")
        return False


def send_ops_alert_sync(
    subject: str, message: str, error_details: dict[str, Any] | None = None
) -> bool:
    """
    Synchronous wrapper for send_ops_alert.

    This is useful when calling from synchronous code that can't use async/await.

    Args:
        subject: Email subject line
        message: Email body content
        error_details: Optional error details to include in the email

    Returns:
        bool: True if email was sent successfully, false otherwise
    """
    try:
        # Create new event loop if none exists
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        # Run the async function
        return loop.run_until_complete(send_ops_alert(subject, message, error_details))
    except Exception as e:
        logger.error(f"Error in synchronous ops alert wrapper: {e}")
        return False


# Convenience functions for common alert types
def send_crawler_wedged_alert(site_id: str, minutes_since_activity: int) -> bool:
    """Send alert when crawler appears to be wedged."""
    return send_ops_alert_sync(
        subject="Crawler Wedged",
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
        subject="Crawler Process Down",
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
        subject="Crawler Database Error",
        message=f"Database error detected for site '{site_id}' crawler: {error_message}",
        error_details={
            "context": {
                "site_id": site_id,
                "issue_type": "database_error",
                "error_message": error_message,
            }
        },
    )


if __name__ == "__main__":
    # Test script - only runs if executed directly
    import sys

    if len(sys.argv) < 2:
        print("Usage: python email_ops.py <test_message>")
        sys.exit(1)

    test_message = sys.argv[1]

    # Test sending an alert
    success = send_ops_alert_sync(
        subject="Test Alert from Python",
        message=test_message,
        error_details={
            "context": {"test": True, "timestamp": datetime.now().isoformat()}
        },
    )

    if success:
        print("Test alert sent successfully")
    else:
        print("Failed to send test alert")
        sys.exit(1)
