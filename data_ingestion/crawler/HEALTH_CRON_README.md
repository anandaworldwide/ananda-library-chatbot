# Health Monitoring Cron Jobs

Automated health monitoring for the website crawler with two simple scripts:

1. **Hourly Health Check** - Monitors crawler and sends alerts when issues detected
2. **Daily Health Report** - Sends beautiful email summaries with key statistics

## Quick Start

The system sends you emails automatically:

- **Alerts**: When something breaks (database errors, crashed processes, stuck crawler)
- **Daily Reports**: Comprehensive status summary with dashboard-like HTML layout

## Setup

### 1. Configure Email

Add to your `.env.{site}` file:

```bash
# Required: Email addresses for alerts (semicolon-separated)
OPS_ALERT_EMAIL="ops@yourdomain.com;admin@yourdomain.com"

# Required: AWS SES credentials
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your_aws_access_key"
AWS_SECRET_ACCESS_KEY="your_aws_secret_key"
```

### 2. Set Up Cron Jobs

Add to your crontab (`crontab -e`):

```bash
# Hourly health check
0 * * * * cd /path/to/ananda-library-chatbot && python data_ingestion/crawler/health_cron_check.py --site ananda-public

# Daily report at 9 AM
0 9 * * * cd /path/to/ananda-library-chatbot && python data_ingestion/crawler/health_daily_report.py --site ananda-public
```

Replace `/path/to/ananda-library-chatbot` with your actual project path.

## What You Get

### Email Alerts (Hourly)

Sent when problems detected:

- Database missing or errors
- Crawler process not running
- Crawler stuck (no activity > 65 minutes)
- Rate limited (max once per hour per issue)

### Daily Reports (9 AM)

Beautiful HTML emails with:

- **Subject line**: `✅ Daily Health Report - SITE: 25,432 URLs, 1,234 ready, 1 process`
- Dashboard-style layout with key statistics
- Process resource usage and activity summaries
- Issue alerts (if any)

## Testing

Test your setup:

```bash
# Test health check
python data_ingestion/crawler/health_cron_check.py --site ananda-public

# Test daily report
python data_ingestion/crawler/health_daily_report.py --site ananda-public

# Test email configuration
python -c "
from pyutil.env_utils import load_env
from pyutil.email_ops import send_ops_alert_sync
load_env('ananda-public')
print('Success' if send_ops_alert_sync('Test', 'Test message') else 'Failed')
"
```

## Troubleshooting

**Emails not sending?**

- Check AWS SES credentials in `.env.{site}`
- Verify `OPS_ALERT_EMAIL` contains valid addresses
- Test email config with command above

**Scripts not running?**

- Check cron daemon is running
- Verify file paths in crontab entries
- Check Python dependencies: `pip install psutil`

**Need help?**

- Check logs: `tail -f /var/log/cron.log` (Linux) or Console app (macOS)
- Run with debug: `--debug` flag
- Verify environment loads: check `.env.{site}` file exists

## Integration

These cron jobs **complement** the existing health server:

- **Health Server**: Real-time dashboard for interactive monitoring
- **Cron Jobs**: Automated alerts and daily summaries in your inbox

You can run both systems together and consider deprecating the health server later if the cron jobs meet your needs.
