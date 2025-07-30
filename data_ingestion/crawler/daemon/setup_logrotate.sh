#!/bin/bash

# Setup Log Rotation for Ananda Crawler
# This script configures macOS newsyslog to automatically rotate crawler logs

set -e

SITE_ID="$1"
if [ -z "$SITE_ID" ]; then
    echo "Usage: $0 <site_id>"
    echo "Example: $0 ananda-public"
    exit 1
fi

LOG_DIR="$HOME/Library/Logs/AnandaCrawler"
NEWSYSLOG_CONF="/usr/local/etc/newsyslog.d/ananda-crawler-${SITE_ID}.conf"

echo "Setting up log rotation for site: $SITE_ID"

# Create newsyslog.d directory if it doesn't exist
sudo mkdir -p /usr/local/etc/newsyslog.d

# Create newsyslog configuration
sudo tee "$NEWSYSLOG_CONF" > /dev/null << EOF
# Ananda Crawler Log Rotation Configuration for $SITE_ID
# Format: logfilename [owner:group] mode count size when flags [/pid_file] [sig_num]

# Rotate when logs reach 50MB, keep 5 old files, compress them
$LOG_DIR/crawler-${SITE_ID}.log    644  5     50000  *     GZ
$LOG_DIR/crawler-${SITE_ID}-error.log 644  5     50000  *     GZ
EOF

echo "✅ Created newsyslog configuration: $NEWSYSLOG_CONF"
echo ""
echo "Log rotation is now configured:"
echo "  - Rotates when logs reach 50MB"
echo "  - Keeps 5 old log files"
echo "  - Compresses old logs with gzip"
echo "  - Runs automatically via system cron"
echo ""
echo "To test log rotation manually:"
echo "  sudo newsyslog -v"
echo ""
echo "To remove log rotation:"
echo "  sudo rm '$NEWSYSLOG_CONF'" 