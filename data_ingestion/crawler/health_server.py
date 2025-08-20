#!/usr/bin/env python3
"""
Flask-based health check server for the website crawler.

This server provides a comprehensive dashboard for crawler status and statistics.
It can be run alongside the main crawler process to provide monitoring capabilities.

Usage:
    python health_server.py --site ananda-public --port 8080

The dashboard provides:
- Real-time crawler status monitoring
- Queue statistics with visual progress
- Process health and resource usage
- Configuration overview
- Issues and alerts display

Endpoints:
- `/dashboard` - Main HTML dashboard with real-time status
- `/api/health` - JSON health data for dashboard consumption
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
from flask import Flask, jsonify, render_template_string

# Add parent directories to path for imports
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)  # data_ingestion
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)  # project root
from crawler.website_crawler import load_config

from pyutil.email_ops import (
    send_crawler_process_down_alert,
    send_crawler_wedged_alert,
    send_database_error_alert,
)


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


app = Flask(__name__)

# Global variables to store crawler info
SITE_ID = None
SITE_CONFIG = None
DB_FILE = None

# Email alert rate limiting - prevent spam for recurring issues
# Track when each type of alert was last sent to avoid flooding ops team
LAST_ALERT_TIMES: dict[str, datetime] = {}
ALERT_COOLDOWN_MINUTES = 60  # Don't send same alert type more than once per hour

# HTML Dashboard Template
DASHBOARD_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crawler Health Dashboard - {{ site_id }}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fa;
            color: #2d3748;
            line-height: 1.6;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1.5rem 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 2rem;
        }
        
        .header h1 {
            font-size: 2rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
        }
        
        .header .subtitle {
            opacity: 0.9;
            font-size: 1.1rem;
        }
        
        .status-bar {
            background: white;
            padding: 1rem 0;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .status-bar-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .overall-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 1.1rem;
            font-weight: 600;
        }
        
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            display: inline-block;
        }
        
        .status-healthy { background: #48bb78; }
        .status-warning { background: #ed8936; }
        .status-degraded { background: #f56565; }
        
        .last-updated {
            color: #718096;
            font-size: 0.9rem;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 2rem;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            border: 1px solid #e2e8f0;
        }
        
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            padding-bottom: 0.75rem;
            border-bottom: 2px solid #f7fafc;
        }
        
        .card-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #2d3748;
        }
        
        .card-icon {
            font-size: 1.5rem;
            opacity: 0.7;
        }
        
        .metric-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 1rem;
        }
        
        .metric {
            text-align: center;
            padding: 1rem;
            background: #f7fafc;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }
        
        .metric-value {
            font-size: 1.8rem;
            font-weight: 700;
            color: #2d3748;
            margin-bottom: 0.25rem;
        }
        
        .metric-label {
            font-size: 0.85rem;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .progress-bar {
            width: 100%;
            height: 8px;
            background: #e2e8f0;
            border-radius: 4px;
            overflow: hidden;
            margin: 0.5rem 0;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #48bb78, #38a169);
            transition: width 0.3s ease;
        }
        
        .status-list {
            list-style: none;
        }
        
        .status-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 0;
            border-bottom: 1px solid #f7fafc;
        }
        
        .status-item:last-child {
            border-bottom: none;
        }
        
        .status-label {
            font-weight: 500;
        }
        
        .status-value {
            font-weight: 600;
            color: #2d3748;
        }
        
        .issues-list {
            list-style: none;
        }
        
        .issue-item {
            padding: 0.75rem;
            margin: 0.5rem 0;
            background: #fed7d7;
            border: 1px solid #feb2b2;
            border-radius: 6px;
            color: #c53030;
        }
        
        .no-issues {
            color: #48bb78;
            font-style: italic;
            text-align: center;
            padding: 1rem;
        }
        
        .process-item {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 1rem;
            margin: 0.5rem 0;
        }
        
        .process-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
        }
        
        .process-pid {
            font-weight: 600;
            color: #2d3748;
        }
        
        .process-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
            gap: 0.5rem;
            font-size: 0.9rem;
        }
        
        .refresh-info {
            text-align: center;
            color: #718096;
            font-size: 0.9rem;
            margin-top: 2rem;
            padding: 1rem;
            background: white;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }
        
        @media (max-width: 768px) {
            .container { padding: 1rem; }
            .grid { grid-template-columns: 1fr; }
            .metric-grid { grid-template-columns: repeat(2, 1fr); }
            .header-content { padding: 0 1rem; }
            .status-bar-content { flex-direction: column; gap: 1rem; padding: 0 1rem; }
            .alert-banner-content { padding: 0 1rem; }
        }
        
        .loading {
            opacity: 0.6;
            pointer-events: none;
        }
        
        .fade-in {
            animation: fadeIn 0.3s ease-in;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        /* Prominent Alert Banner Styles */
        .alert-banner {
            padding: 1.5rem 0;
            margin: 0;
            font-size: 1.1rem;
            font-weight: 600;
            text-align: center;
            border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: alertPulse 2s ease-in-out infinite alternate;
        }
        
        .alert-banner-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 2rem;
        }
        
        .alert-banner-warning {
            background: linear-gradient(135deg, #f6ad55 0%, #ed8936 100%);
            color: #744210;
            border-bottom: 4px solid #c05621;
        }
        
        .alert-banner-degraded {
            background: linear-gradient(135deg, #fc8181 0%, #f56565 100%);
            color: #742a2a;
            border-bottom: 4px solid #c53030;
        }
        
        .alert-banner-title {
            font-size: 1.4rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .alert-banner-issues {
            list-style: none;
            margin: 0.75rem 0 0 0;
            padding: 0;
        }
        
        .alert-banner-issues li {
            margin: 0.25rem 0;
            padding: 0.5rem 1rem;
            background: rgba(255,255,255,0.2);
            border-radius: 6px;
            font-weight: 500;
        }
        
        @keyframes alertPulse {
            0% { box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
            100% { box-shadow: 0 6px 20px rgba(0,0,0,0.25); }
        }
        
        @media (max-width: 768px) {
            .alert-banner {
                padding: 1rem;
                font-size: 1rem;
            }
            .alert-banner-title {
                font-size: 1.2rem;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>🕷️ Crawler Health Dashboard</h1>
            <div class="subtitle">{{ site_id }} • {{ config.domain }}</div>
        </div>
    </div>
    
    <!-- Prominent Alert Banner for Warning/Error States -->
    {% if status.lower() in ['warning', 'degraded'] %}
    <div class="alert-banner alert-banner-{{ status.lower() }}">
        <div class="alert-banner-content">
            <div class="alert-banner-title">
                {% if status.lower() == 'warning' %}
                    ⚠️ System Warning
                {% elif status.lower() == 'degraded' %}
                    🚨 System Error
                {% endif %}
            </div>
            <div>Immediate attention required - crawler health issues detected</div>
            {% if issues %}
            <ul class="alert-banner-issues">
                {% for issue in issues %}
                <li>{{ issue }}</li>
                {% endfor %}
            </ul>
            {% endif %}
        </div>
    </div>
    {% endif %}
    
    <div class="status-bar">
        <div class="status-bar-content">
            <div class="overall-status">
                <span class="status-indicator status-{{ status.lower() }}"></span>
                Overall Status: <span id="status-text">{{ status.title() }}</span>
            </div>
            <div class="last-updated">
                Last Updated: <span id="last-updated">{{ formatted_timestamp }}</span>
            </div>
        </div>
    </div>
    
    <div class="container">
        <div class="grid">
            <!-- Queue Status Card -->
            <div class="card fade-in">
                <div class="card-header">
                    <div class="card-title">📊 Queue Status</div>
                    <div class="card-icon">📊</div>
                </div>
                <div class="metric-grid">
                    <div class="metric">
                        <div class="metric-value" id="total-urls">{{ database.total_urls }}</div>
                        <div class="metric-label">Total URLs</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="ready-urls">{{ database.ready_for_crawling }}</div>
                        <div class="metric-label">Ready</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="visited-urls">{{ database.status_breakdown.visited }}</div>
                        <div class="metric-label">Visited</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="failed-urls">{{ database.status_breakdown.failed }}</div>
                        <div class="metric-label">Failed</div>
                    </div>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progress-fill" style="width: {{ (database.status_breakdown.visited / database.total_urls * 100) if database.total_urls > 0 else 0 }}%"></div>
                </div>
                <div style="text-align: center; font-size: 0.9rem; color: #718096; margin-top: 0.5rem;">
                    {{ "%.1f"|format(database.status_breakdown.visited / database.total_urls * 100) if database.total_urls > 0 else 0 }}% Complete
                </div>
            </div>
            
            <!-- System Health Card -->
            <div class="card fade-in">
                <div class="card-header">
                    <div class="card-title">⚡ System Health</div>
                    <div class="card-icon">⚡</div>
                </div>
                <div class="metric-grid">
                    <div class="metric">
                        <div class="metric-value" id="db-size">{{ database.database_size_mb }}</div>
                        <div class="metric-label">DB Size (MB)</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="avg-retries">{{ database.average_retry_count }}</div>
                        <div class="metric-label">Avg Retries</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="high-priority">{{ database.high_priority_urls }}</div>
                        <div class="metric-label">High Priority</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value" id="pending-retry">{{ database.pending_retry }}</div>
                        <div class="metric-label">Pending Retry</div>
                    </div>
                </div>
            </div>
            
            <!-- Process Status Card -->
            <div class="card fade-in">
                <div class="card-header">
                    <div class="card-title">🔄 Process Status</div>
                    <div class="card-icon">🔄</div>
                </div>
                <div id="process-content">
                    {% if processes.crawler_running %}
                        <div style="color: #48bb78; font-weight: 600; margin-bottom: 1rem;">
                            ✅ Crawler Running ({{ processes.process_count }} process{{ 'es' if processes.process_count != 1 else '' }})
                        </div>
                        {% for process in processes.crawler_processes %}
                        <div class="process-item">
                            <div class="process-header">
                                <span class="process-pid">PID: {{ process.pid }}</span>
                                <span style="color: #718096; font-size: 0.9rem;">Started: {{ process.started[:19] }}</span>
                            </div>
                            <div class="process-stats">
                                <div>CPU: {{ process.cpu_percent }}%</div>
                                <div>Memory: {{ process.memory_mb }}MB</div>
                            </div>
                        </div>
                        {% endfor %}
                    {% else %}
                        <div style="color: #f56565; font-weight: 600; text-align: center; padding: 2rem;">
                            ❌ No Crawler Processes Detected
                        </div>
                    {% endif %}
                    
                    <!-- Log Activity Section -->
                    <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 2px solid #f7fafc;">
                        <div style="font-weight: 600; color: #2d3748; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                            📋 Log Activity
                        </div>
                        <ul class="status-list">
                            {% if log_activity.last_activity %}
                            <li class="status-item">
                                <span class="status-label">Last Activity</span>
                                <span class="status-value" id="process-last-activity">{{ format_user_friendly_timestamp(log_activity.last_activity) }}</span>
                            </li>
                            <li class="status-item">
                                <span class="status-label">Minutes Since Activity</span>
                                <span class="status-value" id="process-minutes-since" style="color: {{ '#f56565' if log_activity.is_wedged else '#48bb78' }};">
                                    {{ log_activity.minutes_since_activity }} min
                                </span>
                            </li>
                            {% endif %}
                            {% if log_activity.error %}
                            <li class="status-item">
                                <span class="status-label">Error</span>
                                <span class="status-value" id="process-log-error" style="color: #f56565; font-size: 0.8rem;">{{ log_activity.error }}</span>
                            </li>
                            {% endif %}
                        </ul>
                    </div>
                </div>
            </div>
            
            <!-- Configuration Card -->
            <div class="card fade-in">
                <div class="card-header">
                    <div class="card-title">⚙️ Configuration</div>
                    <div class="card-icon">⚙️</div>
                </div>
                <ul class="status-list">
                    <li class="status-item">
                        <span class="status-label">Domain</span>
                        <span class="status-value">{{ config.domain }}</span>
                    </li>
                    <li class="status-item">
                        <span class="status-label">Crawl Frequency</span>
                        <span class="status-value">{{ config.crawl_frequency_days }} days</span>
                    </li>
                    <li class="status-item">
                        <span class="status-label">CSV Mode</span>
                        <span class="status-value">{{ "✅ Enabled" if config.csv_mode_enabled else "❌ Disabled" }}</span>
                    </li>
                    <li class="status-item">
                        <span class="status-label">Initial Crawl</span>
                        <span class="status-value">{{ "✅ Complete" if database.initial_crawl_completed else "⏳ In Progress" }}</span>
                    </li>
                </ul>
            </div>
            
            <!-- Issues Card -->
            <div class="card fade-in">
                <div class="card-header">
                    <div class="card-title">🚨 Issues & Alerts</div>
                    <div class="card-icon">🚨</div>
                </div>
                <div id="issues-content">
                    {% if issues %}
                        <ul class="issues-list">
                            {% for issue in issues %}
                            <li class="issue-item">{{ issue }}</li>
                            {% endfor %}
                        </ul>
                    {% else %}
                        <div class="no-issues">✅ No issues detected</div>
                    {% endif %}
                </div>
            </div>
            
            <!-- Database Info Card -->
            <div class="card fade-in">
                <div class="card-header">
                    <div class="card-title">💾 Database Info</div>
                    <div class="card-icon">💾</div>
                </div>
                <ul class="status-list">
                    <li class="status-item">
                        <span class="status-label">Database Path</span>
                        <span class="status-value" style="font-size: 0.8rem; word-break: break-all;">{{ database.database_path }}</span>
                    </li>
                    <li class="status-item">
                        <span class="status-label">Last Activity</span>
                        <span class="status-value">{{ format_user_friendly_timestamp(database.last_activity) }}</span>
                    </li>
                    <li class="status-item">
                        <span class="status-label">Database Status</span>
                        <span class="status-value">{{ "✅ Available" if database.database_exists else "❌ Missing" }}</span>
                    </li>
                </ul>
            </div>
            

        </div>
        
        <div class="refresh-info">
            <div>🔄 Auto-refreshing every 10 minutes</div>
            <div style="margin-top: 0.5rem; font-size: 0.8rem;">
                Next refresh: <span id="next-refresh"></span>
            </div>
        </div>
    </div>
    
    <script>
        // Auto-refresh functionality
        const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
        let nextRefreshTime = new Date(Date.now() + REFRESH_INTERVAL);
        
        function updateAlertBanner(status, issues) {
            const existingBanner = document.querySelector('.alert-banner');
            const statusBar = document.querySelector('.status-bar');
            
            // Remove existing banner if present
            if (existingBanner) {
                existingBanner.remove();
            }
            
            // Only show banner for warning or degraded states
            if (status.toLowerCase() === 'warning' || status.toLowerCase() === 'degraded') {
                const banner = document.createElement('div');
                banner.className = `alert-banner alert-banner-${status.toLowerCase()}`;
                
                const bannerContent = document.createElement('div');
                bannerContent.className = 'alert-banner-content';
                
                const title = document.createElement('div');
                title.className = 'alert-banner-title';
                title.innerHTML = status.toLowerCase() === 'warning' ? 
                    '⚠️ System Warning' : '🚨 System Error';
                
                const message = document.createElement('div');
                message.textContent = 'Immediate attention required - crawler health issues detected';
                
                bannerContent.appendChild(title);
                bannerContent.appendChild(message);
                
                if (issues && issues.length > 0) {
                    const issuesList = document.createElement('ul');
                    issuesList.className = 'alert-banner-issues';
                    
                    issues.forEach(issue => {
                        const listItem = document.createElement('li');
                        listItem.textContent = issue;
                        issuesList.appendChild(listItem);
                    });
                    
                    bannerContent.appendChild(issuesList);
                }
                
                banner.appendChild(bannerContent);
                
                // Insert banner before status bar
                statusBar.parentNode.insertBefore(banner, statusBar);
            }
        }
        
        function updateNextRefreshTime() {
            const now = new Date();
            const timeLeft = Math.max(0, nextRefreshTime - now);
            const minutes = Math.floor(timeLeft / 60000);
            const seconds = Math.floor((timeLeft % 60000) / 1000);
            document.getElementById('next-refresh').textContent = 
                `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        function refreshDashboard() {
            document.body.classList.add('loading');
            
            fetch('/api/health')
                .then(response => response.json())
                .then(data => {
                    // Update status indicators
                    document.getElementById('status-text').textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
                    // Format timestamp in user-friendly way
                    const date = new Date(data.timestamp);
                    const options = { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric', 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true 
                    };
                    const formatter = new Intl.DateTimeFormat('en-US', options);
                    const formattedDate = formatter.format(date).replace(/(\\d+),/, (match, day) => {
                        const dayNum = parseInt(day);
                        let suffix;
                        if (dayNum >= 11 && dayNum <= 13) {
                            suffix = 'th';
                        } else {
                            switch (dayNum % 10) {
                                case 1: suffix = 'st'; break;
                                case 2: suffix = 'nd'; break;
                                case 3: suffix = 'rd'; break;
                                default: suffix = 'th';
                            }
                        }
                        return `${dayNum}${suffix},`;
                    }).replace(' at ', ' at ');
                    document.getElementById('last-updated').textContent = formattedDate;
                    
                    // Update queue metrics
                    document.getElementById('total-urls').textContent = data.database.total_urls;
                    document.getElementById('ready-urls').textContent = data.database.ready_for_crawling;
                    document.getElementById('visited-urls').textContent = data.database.status_breakdown.visited;
                    document.getElementById('failed-urls').textContent = data.database.status_breakdown.failed;
                    
                    // Update progress bar
                    const progressPercent = data.database.total_urls > 0 ? 
                        (data.database.status_breakdown.visited / data.database.total_urls * 100) : 0;
                    document.getElementById('progress-fill').style.width = progressPercent + '%';
                    
                    // Update system health metrics
                    document.getElementById('db-size').textContent = data.database.database_size_mb;
                    document.getElementById('avg-retries').textContent = data.database.average_retry_count;
                    document.getElementById('high-priority').textContent = data.database.high_priority_urls;
                    document.getElementById('pending-retry').textContent = data.database.pending_retry;
                    
                    // Update log activity metrics (now in process status card)
                    if (data.log_activity) {
                        const processLastActivity = document.getElementById('process-last-activity');
                        if (processLastActivity && data.log_activity.last_activity) {
                            // Format the log activity timestamp
                            const logDate = new Date(data.log_activity.last_activity);
                            const logOptions = { 
                                year: 'numeric', 
                                month: 'long', 
                                day: 'numeric', 
                                hour: 'numeric', 
                                minute: '2-digit',
                                hour12: true 
                            };
                            const logFormatter = new Intl.DateTimeFormat('en-US', logOptions);
                            const formattedLogDate = logFormatter.format(logDate).replace(/(\\d+),/, (match, day) => {
                                const dayNum = parseInt(day);
                                let suffix;
                                if (dayNum >= 11 && dayNum <= 13) {
                                    suffix = 'th';
                                } else {
                                    switch (dayNum % 10) {
                                        case 1: suffix = 'st'; break;
                                        case 2: suffix = 'nd'; break;
                                        case 3: suffix = 'rd'; break;
                                        default: suffix = 'th';
                                    }
                                }
                                return `${dayNum}${suffix},`;
                            });
                            processLastActivity.textContent = formattedLogDate;
                        }
                        
                        const processMinutesSince = document.getElementById('process-minutes-since');
                        if (processMinutesSince && data.log_activity.minutes_since_activity !== null) {
                            processMinutesSince.textContent = data.log_activity.minutes_since_activity + ' min';
                            processMinutesSince.style.color = data.log_activity.is_wedged ? '#f56565' : '#48bb78';
                        }
                        
                        const processLogError = document.getElementById('process-log-error');
                        if (processLogError) {
                            processLogError.textContent = data.log_activity.error || '';
                            processLogError.style.display = data.log_activity.error ? 'inline' : 'none';
                        }
                    }
                    
                    // Update status indicator color
                    const statusIndicator = document.querySelector('.status-indicator');
                    statusIndicator.className = 'status-indicator status-' + data.status.toLowerCase();
                    
                    // Update or show/hide alert banner
                    updateAlertBanner(data.status, data.issues);
                    
                    document.body.classList.remove('loading');
                    nextRefreshTime = new Date(Date.now() + REFRESH_INTERVAL);
                })
                .catch(error => {
                    console.error('Failed to refresh dashboard:', error);
                    document.body.classList.remove('loading');
                });
        }
        
        // Update countdown every second
        setInterval(updateNextRefreshTime, 1000);
        
        // Refresh dashboard every 10 minutes
        setInterval(refreshDashboard, REFRESH_INTERVAL);
        
        // Initial countdown update
        updateNextRefreshTime();
    </script>
</body>
</html>
"""


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


def get_log_activity_status() -> dict[str, Any]:
    """Check the crawler log file for recent activity to detect if crawler is wedged."""
    log_dir = Path.home() / "Library" / "Logs" / "AnandaCrawler"
    log_file = log_dir / f"crawler-{SITE_ID}.log"

    try:
        if not log_file.exists():
            return {
                "log_file_exists": False,
                "error": f"Log file not found: {log_file}",
                "last_activity": None,
                "minutes_since_activity": None,
                "is_wedged": True,
            }

        last_activity_time = None
        last_activity_line = None

        # Read the last few lines of the log file to find the most recent timestamped entry
        try:
            with open(log_file, encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()[-100:]  # Get last 100 lines (reduced from 500)

                for line in reversed(lines):  # Start from the most recent
                    line = line.strip()

                    # Skip empty lines
                    if not line:
                        continue

                    # Look for any line with a timestamp at the beginning
                    # Expected format: "2024-01-15 14:30:25,123 - INFO - message"
                    try:
                        # Check if line starts with timestamp pattern
                        if " - " in line and "," in line:
                            timestamp_str = line.split(" - ")[
                                0
                            ]  # Get the timestamp part
                            if "," in timestamp_str:
                                timestamp_str = timestamp_str.split(",")[
                                    0
                                ]  # Remove milliseconds

                            # Try to parse the timestamp
                            last_activity_time = datetime.strptime(
                                timestamp_str, "%Y-%m-%d %H:%M:%S"
                            )
                            last_activity_line = line
                            break
                    except (ValueError, IndexError):
                        # If we can't parse the timestamp, continue looking
                        continue

        except Exception as e:
            return {
                "log_file_exists": True,
                "error": f"Error reading log file: {str(e)}",
                "last_activity": None,
                "minutes_since_activity": None,
                "is_wedged": True,
            }

        if last_activity_time is None:
            return {
                "log_file_exists": True,
                "error": "No timestamped log entries found",
                "last_activity": None,
                "minutes_since_activity": None,
                "is_wedged": True,
            }

        # Calculate time since last activity
        now = datetime.now()
        time_diff = now - last_activity_time
        minutes_since_activity = int(time_diff.total_seconds() / 60)

        # Consider crawler wedged if no activity for more than 65 minutes
        # This accounts for the fact that when busy, crawler should be logging frequently
        # When idle, it should wake up every 60 minutes, so 65 minutes gives a small buffer
        is_wedged = minutes_since_activity > 65

        return {
            "log_file_exists": True,
            "last_activity": last_activity_time.isoformat(),
            "last_activity_line": last_activity_line,
            "minutes_since_activity": minutes_since_activity,
            "is_wedged": is_wedged,
            "error": None,
        }

    except Exception as e:
        return {
            "log_file_exists": log_file.exists(),
            "error": f"Unexpected error checking log activity: {str(e)}",
            "last_activity": None,
            "minutes_since_activity": None,
            "is_wedged": True,
        }


def should_send_alert(alert_type: str) -> bool:
    """
    Check if we should send an alert of the given type based on rate limiting.

    Args:
        alert_type: Type of alert (e.g., 'wedged', 'process_down', 'database_error')

    Returns:
        bool: True if alert should be sent, False if in cooldown period
    """
    global LAST_ALERT_TIMES

    now = datetime.now()
    last_sent = LAST_ALERT_TIMES.get(alert_type)

    if last_sent is None:
        # Never sent this type of alert before
        LAST_ALERT_TIMES[alert_type] = now
        return True

    # Check if enough time has passed since last alert
    time_since_last = now - last_sent
    if time_since_last.total_seconds() >= (ALERT_COOLDOWN_MINUTES * 60):
        LAST_ALERT_TIMES[alert_type] = now
        return True

    # Still in cooldown period
    minutes_left = ALERT_COOLDOWN_MINUTES - int(time_since_last.total_seconds() / 60)
    logging.info(
        f"Alert type '{alert_type}' is in cooldown for {minutes_left} more minutes"
    )
    return False


def _check_database_health(db_stats, health_status, issues):
    """Check database health and send alerts if needed."""
    if not db_stats.get("database_exists", False):
        health_status = "degraded"
        issues.append("Database file not found")

        # Send email alert for database missing
        if should_send_alert("database_missing"):
            try:
                send_database_error_alert(SITE_ID, "Database file not found")
                logging.info("Sent email alert for missing database file")
            except Exception as e:
                logging.error(f"Failed to send database missing alert: {e}")

    if "error" in db_stats:
        health_status = "degraded"
        error_msg = db_stats["error"]
        issues.append(f"Database error: {error_msg}")

        # Send email alert for database error
        if should_send_alert("database_error"):
            try:
                send_database_error_alert(SITE_ID, error_msg)
                logging.info(f"Sent email alert for database error: {error_msg}")
            except Exception as e:
                logging.error(f"Failed to send database error alert: {e}")

    return health_status, issues


def _check_process_health(process_info, health_status, issues):
    """Check process health and send alerts if needed."""
    if not process_info.get("crawler_running"):
        health_status = "warning"
        issues.append("No crawler processes detected")

        # Send email alert for process down
        if should_send_alert("process_down"):
            try:
                send_crawler_process_down_alert(SITE_ID)
                logging.info("Sent email alert for crawler process down")
            except Exception as e:
                logging.error(f"Failed to send process down alert: {e}")

    return health_status, issues


def _check_log_activity_health(log_activity, health_status, issues):
    """Check log activity health and send alerts if needed."""
    if not log_activity.get("is_wedged", False):
        return health_status, issues

    if health_status == "healthy":
        health_status = "warning"

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
                send_crawler_wedged_alert(SITE_ID, minutes)
                logging.info(f"Sent email alert for wedged crawler ({minutes} minutes)")
            except Exception as e:
                logging.error(f"Failed to send wedged crawler alert: {e}")
    else:
        issues.append("Crawler appears wedged - no recent activity detected")

        # Send email alert for wedged crawler (unknown duration)
        if should_send_alert("wedged"):
            try:
                send_crawler_wedged_alert(
                    SITE_ID, 999
                )  # Use 999 to indicate unknown duration
                logging.info("Sent email alert for wedged crawler (unknown duration)")
            except Exception as e:
                logging.error(f"Failed to send wedged crawler alert: {e}")

    return health_status, issues


def _build_configuration_data():
    """Build configuration data for health response."""
    if not SITE_CONFIG:
        return {"error": "Configuration not loaded"}

    return {
        "domain": SITE_CONFIG.get("domain", "Unknown"),
        "csv_mode_enabled": bool(SITE_CONFIG.get("csv_export_url")),
        "crawl_frequency_days": SITE_CONFIG.get("crawl_frequency_days", "Unknown"),
    }


def get_health_data():
    """Get health data for both API and dashboard."""
    timestamp = datetime.now().isoformat()

    # Get statistics and status information
    db_stats = get_database_stats()
    process_info = get_crawler_process_info()
    log_activity = get_log_activity_status()

    # Check health status and collect issues
    health_status = "healthy"
    issues = []

    health_status, issues = _check_database_health(db_stats, health_status, issues)
    health_status, issues = _check_process_health(process_info, health_status, issues)
    health_status, issues = _check_log_activity_health(
        log_activity, health_status, issues
    )

    response = {
        "timestamp": timestamp,
        "site_id": SITE_ID,
        "status": health_status,
        "issues": issues,
        "database": db_stats,
        "processes": process_info,
        "log_activity": log_activity,
        "configuration": _build_configuration_data(),
    }

    return response, health_status


@app.route("/api/health")
def api_health():
    """API endpoint for dashboard consumption."""
    response, _ = get_health_data()
    return jsonify(response)


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


@app.route("/dashboard")
def dashboard_endpoint():
    """Serve the HTML dashboard."""
    response, health_status = get_health_data()
    return render_template_string(
        DASHBOARD_TEMPLATE,
        site_id=SITE_ID,
        timestamp=response["timestamp"],
        formatted_timestamp=format_user_friendly_timestamp(response["timestamp"]),
        status=health_status,
        issues=response["issues"],
        database=response["database"],
        processes=response["processes"],
        log_activity=response["log_activity"],
        config=response["configuration"],
        format_user_friendly_timestamp=format_user_friendly_timestamp,
    )


@app.route("/")
def root():
    """Root endpoint with basic info."""
    return jsonify(
        {
            "service": "Website Crawler Health Check",
            "site_id": SITE_ID,
            "endpoints": {
                "/dashboard": "HTML dashboard with real-time status",
                "/api/health": "JSON health data for dashboard consumption",
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
    logging.info(f"Dashboard endpoint: http://{args.host}:{args.port}/dashboard")
    logging.info(f"API endpoint: http://{args.host}:{args.port}/api/health")

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
