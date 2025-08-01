#!/usr/bin/env python3
"""
Health Server Daemon Manager

This script helps install, uninstall, and manage the health server as a macOS LaunchAgent daemon.
The daemon will automatically start when the user logs in and restart if it crashes.

Usage:
    python health_server_daemon_manager.py --site ananda-public install
    python health_server_daemon_manager.py --site ananda-public uninstall
    python health_server_daemon_manager.py --site ananda-public status
    python health_server_daemon_manager.py --site ananda-public start
    python health_server_daemon_manager.py --site ananda-public stop
    python health_server_daemon_manager.py --site ananda-public restart
    python health_server_daemon_manager.py --site ananda-public logs
"""

import argparse
import subprocess
import sys
from pathlib import Path


class HealthServerDaemonManager:
    """Manages the health server daemon installation and control."""

    def __init__(self, site_id: str):
        self.site_id = site_id
        self.service_name = f"com.ananda.health-server.{site_id}"

        # Paths
        self.script_dir = Path(__file__).parent
        self.project_root = self.script_dir.parent.parent.parent
        self.health_server_script = (
            self.project_root / "data_ingestion" / "crawler" / "health_server.py"
        )

        # LaunchAgent paths
        self.launch_agents_dir = Path.home() / "Library" / "LaunchAgents"
        self.plist_file = self.launch_agents_dir / f"{self.service_name}.plist"
        self.plist_template = (
            self.script_dir / "com.ananda.health-server.plist.template"
        )

        # Log directory
        self.log_dir = Path.home() / "Library" / "Logs" / "AnandaCrawler"

        # Python path
        self.python_path = sys.executable

        # Health server configuration
        self.health_server_port = self._get_health_server_port()

    def _get_health_server_port(self) -> str:
        """Get the health server port for the site."""
        # Default port mapping - can be customized per site
        port_mapping = {
            "ananda": "8080",
            "ananda-public": "8081",
            "crystal": "8082",
            "jairam": "8083",
        }
        return port_mapping.get(self.site_id, "8080")

    def _run_command(
        self, command: list[str], capture_output: bool = True
    ) -> tuple[int, str, str]:
        """Run a shell command and return (returncode, stdout, stderr)."""
        try:
            result = subprocess.run(
                command, capture_output=capture_output, text=True, check=False
            )
            return result.returncode, result.stdout or "", result.stderr or ""
        except Exception as e:
            return 1, "", str(e)

    def _check_prerequisites(self) -> bool:
        """Check if all prerequisites are met."""
        issues = []

        # Check if health server script exists
        if not self.health_server_script.exists():
            issues.append(
                f"Health server script not found: {self.health_server_script}"
            )

        # Check if plist template exists
        if not self.plist_template.exists():
            issues.append(f"Plist template not found: {self.plist_template}")

        # Check if site config exists
        config_file = (
            self.project_root
            / "data_ingestion"
            / "crawler"
            / "crawler_config"
            / f"{self.site_id}-config.json"
        )
        if not config_file.exists():
            issues.append(f"Site configuration not found: {config_file}")

        # Check if environment file exists
        env_file = self.project_root / f".env.{self.site_id}"
        if not env_file.exists():
            issues.append(f"Environment file not found: {env_file}")

        if issues:
            print("❌ Prerequisites check failed:")
            for issue in issues:
                print(f"   - {issue}")
            return False

        print("✅ Prerequisites check passed")
        return True

    def _create_plist_file(self) -> bool:
        """Create the plist file from template."""
        try:
            # Read template
            with open(self.plist_template) as f:
                template_content = f.read()

            # Replace placeholders
            plist_content = template_content.replace("{{SITE_ID}}", self.site_id)
            plist_content = plist_content.replace("{{PYTHON_PATH}}", self.python_path)
            plist_content = plist_content.replace(
                "{{HEALTH_SERVER_SCRIPT_PATH}}", str(self.health_server_script)
            )
            plist_content = plist_content.replace(
                "{{PROJECT_ROOT}}", str(self.project_root)
            )
            plist_content = plist_content.replace("{{LOG_DIR}}", str(self.log_dir))
            plist_content = plist_content.replace(
                "{{HEALTH_SERVER_PORT}}", self.health_server_port
            )

            # Ensure log directory exists
            self.log_dir.mkdir(parents=True, exist_ok=True)

            # Write plist file
            with open(self.plist_file, "w") as f:
                f.write(plist_content)

            print(f"✅ Created plist file: {self.plist_file}")
            return True

        except Exception as e:
            print(f"❌ Failed to create plist file: {e}")
            return False

    def install(self) -> bool:
        """Install the health server daemon."""
        print(f"Installing health server daemon for site: {self.site_id}")
        print(f"Service name: {self.service_name}")
        print(f"Port: {self.health_server_port}")

        if not self._check_prerequisites():
            return False

        if not self._create_plist_file():
            return False

        # Load the daemon
        returncode, stdout, stderr = self._run_command(
            ["launchctl", "load", str(self.plist_file)]
        )

        if returncode == 0:
            print("✅ Health server daemon installed successfully")
            print(
                f"Dashboard available at: http://127.0.0.1:{self.health_server_port}/dashboard"
            )
            print(
                f"API available at: http://127.0.0.1:{self.health_server_port}/api/health"
            )
            return True
        else:
            print(f"❌ Failed to install daemon: {stderr}")
            return False

    def uninstall(self) -> bool:
        """Uninstall the health server daemon."""
        print(f"Uninstalling health server daemon for site: {self.site_id}")

        # Unload the daemon first
        returncode, stdout, stderr = self._run_command(
            ["launchctl", "unload", str(self.plist_file)]
        )

        if returncode != 0 and "Could not find specified service" not in stderr:
            print(f"⚠️ Warning: Failed to unload daemon: {stderr}")

        # Remove plist file
        if self.plist_file.exists():
            self.plist_file.unlink()
            print(f"✅ Removed plist file: {self.plist_file}")

        print("✅ Health server daemon uninstalled")
        return True

    def status(self) -> bool:
        """Check the status of the health server daemon."""
        print(f"Health server daemon status for site: {self.site_id}")
        print(f"Service name: {self.service_name}")
        print(f"Port: {self.health_server_port}")

        # Check if plist file exists
        if self.plist_file.exists():
            print(f"✅ Plist file exists: {self.plist_file}")
        else:
            print(f"❌ Plist file missing: {self.plist_file}")
            return False

        # Check if daemon is loaded
        returncode, stdout, stderr = self._run_command(
            ["launchctl", "list", self.service_name]
        )

        if returncode == 0:
            print("✅ Daemon is loaded and running")

            # Check if process is actually running
            returncode, stdout, stderr = self._run_command(
                ["lsof", "-i", f":{self.health_server_port}"]
            )

            if returncode == 0:
                print(
                    f"✅ Health server is listening on port {self.health_server_port}"
                )
                print(
                    f"Dashboard: http://127.0.0.1:{self.health_server_port}/dashboard"
                )
            else:
                print(
                    f"⚠️ Health server not listening on port {self.health_server_port}"
                )

            return True
        else:
            print("❌ Daemon is not loaded")
            return False

    def start(self) -> bool:
        """Start the health server daemon."""
        print(f"Starting health server daemon for site: {self.site_id}")

        returncode, stdout, stderr = self._run_command(
            ["launchctl", "start", self.service_name]
        )

        if returncode == 0:
            print("✅ Health server daemon started")
            return True
        else:
            print(f"❌ Failed to start daemon: {stderr}")
            return False

    def stop(self) -> bool:
        """Stop the health server daemon."""
        print(f"Stopping health server daemon for site: {self.site_id}")

        returncode, stdout, stderr = self._run_command(
            ["launchctl", "stop", self.service_name]
        )

        if returncode == 0:
            print("✅ Health server daemon stopped")
            return True
        else:
            print(f"❌ Failed to stop daemon: {stderr}")
            return False

    def restart(self) -> bool:
        """Restart the health server daemon."""
        print(f"Restarting health server daemon for site: {self.site_id}")

        if not self.stop():
            return False

        return self.start()

    def logs(self, follow: bool = False) -> None:
        """Show health server logs."""
        log_file = self.log_dir / f"health-server-{self.site_id}.log"

        if not log_file.exists():
            print(f"❌ Log file not found: {log_file}")
            return

        print(f"Showing logs for health server ({self.site_id}):")
        print(f"Log file: {log_file}")
        print("-" * 80)

        if follow:
            # Follow logs in real-time
            try:
                subprocess.run(["tail", "-f", str(log_file)], check=True)
            except KeyboardInterrupt:
                print("\nStopped following logs")
            except Exception as e:
                print(f"❌ Error following logs: {e}")
        else:
            # Show recent logs
            try:
                subprocess.run(["tail", "-n", "50", str(log_file)], check=True)
            except Exception as e:
                print(f"❌ Error showing logs: {e}")


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Health Server Daemon Manager")
    parser.add_argument(
        "--site",
        required=True,
        help="Site ID (e.g., ananda-public). Must match crawler configuration.",
    )
    parser.add_argument(
        "action",
        choices=["install", "uninstall", "status", "start", "stop", "restart", "logs"],
        help="Action to perform",
    )
    parser.add_argument(
        "--follow",
        "-f",
        action="store_true",
        help="Follow logs in real-time (only for logs action)",
    )
    return parser.parse_args()


def _execute_action(
    manager: HealthServerDaemonManager, action: str, follow: bool = False
) -> bool:
    """Execute the specified action."""
    if action == "install":
        return manager.install()
    elif action == "uninstall":
        return manager.uninstall()
    elif action == "status":
        return manager.status()
    elif action == "start":
        return manager.start()
    elif action == "stop":
        return manager.stop()
    elif action == "restart":
        return manager.restart()
    elif action == "logs":
        manager.logs(follow=follow)
        return True
    else:
        print(f"❌ Unknown action: {action}")
        return False


def main():
    """Main entry point."""
    args = parse_arguments()

    manager = HealthServerDaemonManager(args.site)

    success = _execute_action(manager, args.action, args.follow)

    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
