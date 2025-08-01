# Health Server Daemon Setup

This directory contains the daemon management tools for the website crawler health server. The health server provides a
comprehensive dashboard for monitoring crawler status and statistics.

## Overview

The health server daemon automatically starts when you log in and provides:

- Real-time crawler status monitoring
- Queue statistics with visual progress
- Process health and resource usage
- Configuration overview
- Issues and alerts display

## Files

- `com.ananda.health-server.plist.template` - LaunchAgent plist template
- `health_server_daemon_manager.py` - Daemon management script
- `health_server.py` - The health server application
- `install_health_server.sh` - Simple installation script

## Installation

### Prerequisites

1. Ensure the crawler daemon is already set up for your site
2. Verify your site configuration exists in `crawler_config/`
3. Ensure your environment file `.env.{site}` exists

### Install Health Server Daemon

#### Option 1: Simple Installation Script (Recommended)

```bash
# Navigate to the daemon directory
cd data_ingestion/crawler/daemon

# Install health server daemon for your site
./install_health_server.sh ananda-public
```

#### Option 2: Direct Python Command

```bash
# Navigate to the daemon directory
cd data_ingestion/crawler/daemon

# Install health server daemon for your site
python health_server_daemon_manager.py --site ananda-public install
```

The installation will:

- Create a LaunchAgent plist file in `~/Library/LaunchAgents/`
- Configure the health server to start automatically on login
- Set up logging in `~/Library/Logs/AnandaCrawler/`
- Assign a unique port for your site

### Port Assignment

Each site gets a unique port to avoid conflicts:

- `ananda-public`: 8081 (currently the only site with crawler)

## Management Commands

### Check Status

```bash
# Using installation script
./install_health_server.sh ananda-public status

# Or using direct command
python health_server_daemon_manager.py --site ananda-public status
```

This shows:

- Whether the daemon is installed and loaded
- If the health server is listening on its port
- Dashboard URL

### Start/Stop/Restart

```bash
# Using installation script
./install_health_server.sh ananda-public start
./install_health_server.sh ananda-public stop
./install_health_server.sh ananda-public restart

# Or using direct commands
python health_server_daemon_manager.py --site ananda-public start
python health_server_daemon_manager.py --site ananda-public stop
python health_server_daemon_manager.py --site ananda-public restart
```

### View Logs

```bash
# Using installation script
./install_health_server.sh ananda-public logs
./install_health_server.sh ananda-public logs --follow

# Or using direct commands
python health_server_daemon_manager.py --site ananda-public logs
python health_server_daemon_manager.py --site ananda-public logs --follow
```

### Uninstall

```bash
# Using installation script
./install_health_server.sh ananda-public uninstall

# Or using direct command
python health_server_daemon_manager.py --site ananda-public uninstall
```

This removes the LaunchAgent and stops the service.

## Accessing the Dashboard

Once installed, the health server provides:

### Dashboard (HTML)

```
http://127.0.0.1:8081/dashboard  # for ananda-public (currently the only active site)
```

Features:

- Real-time status updates (auto-refreshes every 10 minutes)
- Visual progress bars and metrics
- Process monitoring
- Configuration overview
- Issues and alerts

### API Endpoints

```bash
# JSON health data
curl http://127.0.0.1:8081/api/health

# Quick statistics
curl http://127.0.0.1:8081/stats

# Service information
curl http://127.0.0.1:8081/
```

## Integration with Crawler

The health server automatically:

- Detects running crawler processes for your site
- Monitors the crawler database
- Shows queue statistics and progress
- Displays configuration settings

## Troubleshooting

### Health Server Not Starting

1. Check prerequisites:

   ```bash
   ./install_health_server.sh ananda-public status
   ```

2. Check logs:

   ```bash
   ./install_health_server.sh ananda-public logs
   ```

3. Verify port availability:

   ```bash
   lsof -i :8081  # Replace with your site's port
   ```

### Port Conflicts

If you get port conflicts, you can manually edit the port in the daemon manager:

1. Edit `health_server_daemon_manager.py`
2. Modify the `_get_health_server_port()` method
3. Reinstall the daemon

### Permission Issues

If you get permission errors:

1. Ensure the script is executable: `chmod +x health_server_daemon_manager.py`
2. Check that you have write access to `~/Library/LaunchAgents/`
3. Verify Python path is correct

## Log Files

Health server logs are stored in:

```
~/Library/Logs/AnandaCrawler/health-server-{site}.log
```

The logs include:

- Server startup/shutdown events
- Database connection status
- Process monitoring results
- Error messages and stack traces

## Security Considerations

- The health server only listens on `127.0.0.1` (localhost)
- No authentication is required (intended for local monitoring)
- Logs may contain sensitive information about your crawler configuration
- Consider firewall rules if running on shared systems

## Resource Usage

The health server is designed to be lightweight:

- Memory limit: 512MB
- CPU limit: 24 hours per day
- Auto-restart on crashes
- Low priority (nice level 5)

## Example Workflow

```bash
# 1. Install health server daemon
./install_health_server.sh ananda-public

# 2. Check status
./install_health_server.sh ananda-public status

# 3. Open dashboard in browser
open http://127.0.0.1:8081/dashboard

# 4. Monitor logs during operation
./install_health_server.sh ananda-public logs --follow

# 5. Restart if needed
./install_health_server.sh ananda-public restart
```

## Multiple Sites

You can run health servers for multiple sites when they have crawlers configured:

```bash
# Install for ananda-public (currently the only site with crawler)
./install_health_server.sh ananda-public

# Future sites can be added when crawlers are configured
# ./install_health_server.sh ananda
# ./install_health_server.sh crystal

# Each will run on its own port
# ananda-public: http://127.0.0.1:8081/dashboard (currently active)
# ananda: http://127.0.0.1:8080/dashboard (reserved for future use)
# crystal: http://127.0.0.1:8082/dashboard (reserved for future use)
```
