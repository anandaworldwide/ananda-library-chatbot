# Health Monitoring with LaunchAgents

Automated health monitoring for the website crawler using macOS LaunchAgents with two simple scripts:

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

### 2. Set Up LaunchAgents

**Important**: Due to macOS security restrictions, traditional cron jobs may fail with "Operation not permitted" errors.
Use LaunchAgents instead.

#### Copy Scripts to Accessible Location

```bash
# Copy scripts to ~/bin/ directory (avoids permission issues)
mkdir -p ~/bin
cp data_ingestion/crawler/health_cron_check.py ~/bin/
cp data_ingestion/crawler/health_daily_report.py ~/bin/
chmod +x ~/bin/health_cron_check.py ~/bin/health_daily_report.py
```

#### Create Hourly Health Check LaunchAgent

```bash
cat > ~/Library/LaunchAgents/com.ananda.health-check.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ananda.health-check</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/$(whoami)/bin/health_cron_check.py</string>
        <string>--site</string>
        <string>ananda-public</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/$(whoami)/Library/Logs/AnandaCrawler/health-check.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/$(whoami)/Library/Logs/AnandaCrawler/health-check-error.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/$(whoami)/bin</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

# Load the LaunchAgent
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ananda.health-check.plist
```

#### Create Daily Health Report LaunchAgent

```bash
cat > ~/Library/LaunchAgents/com.ananda.health-report.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ananda.health-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/$(whoami)/bin/health_daily_report.py</string>
        <string>--site</string>
        <string>ananda-public</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/$(whoami)/Library/Logs/AnandaCrawler/health-report.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/$(whoami)/Library/Logs/AnandaCrawler/health-report-error.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/$(whoami)/bin</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOF

# Load the LaunchAgent
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ananda.health-report.plist
```

Replace `ananda-public` with your actual site ID.

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
# Test health check manually
python ~/bin/health_cron_check.py --site ananda-public

# Test daily report manually
python ~/bin/health_daily_report.py --site ananda-public

# Test LaunchAgents
launchctl start com.ananda.health-check
launchctl start com.ananda.health-report

# Check LaunchAgent status
launchctl list | grep com.ananda

# View LaunchAgent logs
tail -f ~/Library/Logs/AnandaCrawler/health-check.log
tail -f ~/Library/Logs/AnandaCrawler/health-report.log

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

**LaunchAgents not running?**

- Check if LaunchAgents are loaded: `launchctl list | grep com.ananda`
- Verify file paths in plist files are correct
- Check Python dependencies: `pip install psutil`
- Ensure scripts are executable: `chmod +x ~/bin/health_*.py`
- Check for permission errors in error logs

**Need help?**

- Check LaunchAgent logs: `tail -f ~/Library/Logs/AnandaCrawler/health-*.log`
- Check error logs: `tail -f ~/Library/Logs/AnandaCrawler/health-*-error.log`
- Run with debug: `--debug` flag
- Verify environment loads: check `.env.{site}` file exists
- Test LaunchAgent syntax: `plutil -lint ~/Library/LaunchAgents/com.ananda.*.plist`

**macOS Security Issues?**

If you get "Operation not permitted" errors:

- LaunchAgents have better permissions than cron jobs
- Ensure scripts are in `~/bin/` not in Documents folder
- Use `/usr/bin/python3` instead of pyenv Python
- Check Console app for detailed error messages

## Integration

These LaunchAgents **complement** the existing health server:

- **Health Server**: Real-time dashboard for interactive monitoring
- **LaunchAgents**: Automated alerts and daily summaries in your inbox

You can run both systems together and consider deprecating the health server later if the LaunchAgents meet your needs.

## LaunchAgent Management

```bash
# List all Ananda LaunchAgents
launchctl list | grep com.ananda

# Unload LaunchAgents (if needed)
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ananda.health-check.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ananda.health-report.plist

# Reload LaunchAgents (after changes)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ananda.health-check.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ananda.health-report.plist
```
