#!/usr/bin/env python3
"""
Daemon Manager for Website Crawler

This script helps install, uninstall, and manage the website crawler as a macOS LaunchAgent daemon.
The daemon will automatically start when the user logs in and restart if it crashes.

Usage:
    python daemon_manager.py --site ananda-public install
    python daemon_manager.py --site ananda-public uninstall
    python daemon_manager.py --site ananda-public status
    python daemon_manager.py --site ananda-public start
    python daemon_manager.py --site ananda-public stop
    python daemon_manager.py --site ananda-public restart
    python daemon_manager.py --site ananda-public logs
"""

import argparse
import subprocess
import sys
from pathlib import Path


class DaemonManager:
    """Manages the crawler daemon installation and control."""

    def __init__(self, site_id: str):
        self.site_id = site_id
        self.service_name = f"com.ananda.crawler.{site_id}"

        # Paths
        self.script_dir = Path(__file__).parent
        self.project_root = self.script_dir.parent.parent.parent
        self.crawler_script = (
            self.project_root / "data_ingestion" / "crawler" / "website_crawler.py"
        )

        # LaunchAgent paths
        self.launch_agents_dir = Path.home() / "Library" / "LaunchAgents"
        self.plist_file = self.launch_agents_dir / f"{self.service_name}.plist"
        self.plist_template = self.script_dir / "com.ananda.crawler.plist.template"

        # Log directory
        self.log_dir = Path.home() / "Library" / "Logs" / "AnandaCrawler"

        # Python path
        self.python_path = sys.executable

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

        # Check if crawler script exists
        if not self.crawler_script.exists():
            issues.append(f"Crawler script not found: {self.crawler_script}")

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
                plist_content = f.read()

            # Replace placeholders
            replacements = {
                "{{SITE_ID}}": self.site_id,
                "{{PYTHON_PATH}}": self.python_path,
                "{{CRAWLER_SCRIPT_PATH}}": str(self.crawler_script),
                "{{PROJECT_ROOT}}": str(self.project_root),
                "{{LOG_DIR}}": str(self.log_dir),
            }

            for placeholder, value in replacements.items():
                plist_content = plist_content.replace(placeholder, value)

            # Ensure directories exist
            self.launch_agents_dir.mkdir(parents=True, exist_ok=True)
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
        """Install the daemon."""
        print(f"Installing crawler daemon for site '{self.site_id}'...")

        if not self._check_prerequisites():
            return False

        # Check if already installed
        if self.plist_file.exists():
            print("⚠️  Daemon already installed. Use 'uninstall' first to reinstall.")
            return False

        # Create plist file
        if not self._create_plist_file():
            return False

        # Load the service
        returncode, stdout, stderr = self._run_command(
            ["launchctl", "load", str(self.plist_file)]
        )

        if returncode != 0:
            print(f"❌ Failed to load service: {stderr}")
            return False

        print("✅ Daemon installed and loaded successfully")
        print(f"   Service name: {self.service_name}")
        print(f"   Log files: {self.log_dir}/crawler-{self.site_id}*.log")
        print(
            "   The crawler will start automatically on login and restart if it crashes."
        )

        return True

    def uninstall(self) -> bool:
        """Uninstall the daemon."""
        print(f"Uninstalling crawler daemon for site '{self.site_id}'...")

        if not self.plist_file.exists():
            print("⚠️  Daemon not installed (plist file not found)")
            return True

        # Stop the service first
        self.stop()

        # Unload the service
        returncode, stdout, stderr = self._run_command(
            ["launchctl", "unload", str(self.plist_file)]
        )

        if returncode != 0:
            print(f"⚠️  Warning: Failed to unload service: {stderr}")

        # Remove plist file
        try:
            self.plist_file.unlink()
            print(f"✅ Removed plist file: {self.plist_file}")
        except Exception as e:
            print(f"❌ Failed to remove plist file: {e}")
            return False

        print("✅ Daemon uninstalled successfully")
        print(f"   Log files are preserved in: {self.log_dir}")

        return True

    def status(self) -> bool:
        """Check daemon status."""
        print(f"Checking status for crawler daemon '{self.service_name}'...")

        # Check if plist file exists
        if not self.plist_file.exists():
            print("❌ Daemon not installed (plist file not found)")
            return False

        # Check launchctl list
        returncode, stdout, stderr = self._run_command(
            ["launchctl", "list", self.service_name]
        )

        if returncode != 0:
            print("❌ Service not loaded in launchctl")
            return False

        # Parse launchctl output
        lines = stdout.strip().split("\n")
        if len(lines) >= 1:
            # The output format is: PID Status Label
            parts = lines[-1].split("\t")
            if len(parts) >= 3:
                pid = parts[0]
                status = parts[1]

                if pid == "-":
                    print("🟡 Service loaded but not running")
                else:
                    print(f"✅ Service running (PID: {pid})")

                if status != "0":
                    print(f"⚠️  Last exit status: {status}")
            else:
                print("✅ Service loaded")

        # Show log file info
        log_files = list(self.log_dir.glob(f"crawler-{self.site_id}*.log"))
        if log_files:
            print("\n📄 Log files:")
            for log_file in sorted(log_files):
                size_mb = log_file.stat().st_size / (1024 * 1024)
                print(f"   {log_file} ({size_mb:.1f} MB)")

        return True

    def start(self) -> bool:
        """Start the daemon."""
        print(f"Starting crawler daemon '{self.service_name}'...")

        returncode, stdout, stderr = self._run_command(
            ["launchctl", "start", self.service_name]
        )

        if returncode != 0:
            print(f"❌ Failed to start service: {stderr}")
            return False

        print("✅ Service start command sent")
        return True

    def stop(self) -> bool:
        """Stop the daemon."""
        print(f"Stopping crawler daemon '{self.service_name}'...")

        returncode, stdout, stderr = self._run_command(
            ["launchctl", "stop", self.service_name]
        )

        if returncode != 0:
            print(f"⚠️  Stop command failed: {stderr}")
            # This might be normal if the service wasn't running

        print("✅ Service stop command sent")
        return True

    def restart(self) -> bool:
        """Restart the daemon."""
        print(f"Restarting crawler daemon '{self.service_name}'...")

        success = self.stop()
        if success:
            success = self.start()

        return success

    def logs(self, follow: bool = False) -> None:
        """Show daemon logs."""
        log_file = self.log_dir / f"crawler-{self.site_id}.log"
        error_log_file = self.log_dir / f"crawler-{self.site_id}-error.log"

        if not log_file.exists() and not error_log_file.exists():
            print(f"❌ No log files found in {self.log_dir}")
            return

        if follow:
            print(f"Following logs for '{self.service_name}' (Ctrl+C to stop)...")
            print("=" * 60)

            # Use tail -f to follow logs
            try:
                if log_file.exists():
                    subprocess.run(["tail", "-f", str(log_file)])
            except KeyboardInterrupt:
                print("\nStopped following logs")
        else:
            # Show recent logs
            print(f"Recent logs for '{self.service_name}':")
            print("=" * 60)

            if log_file.exists():
                print("\n📄 Standard Output:")
                subprocess.run(["tail", "-50", str(log_file)])

            if error_log_file.exists():
                print("\n📄 Error Output:")
                subprocess.run(["tail", "-20", str(error_log_file)])


def parse_arguments() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Manage website crawler daemon",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python daemon_manager.py --site ananda-public install
    python daemon_manager.py --site ananda-public status
    python daemon_manager.py --site ananda-public logs --follow
    python daemon_manager.py --site ananda-public uninstall
        """,
    )

    parser.add_argument("--site", required=True, help="Site ID (e.g., ananda-public)")

    parser.add_argument(
        "action",
        choices=["install", "uninstall", "status", "start", "stop", "restart", "logs"],
        help="Action to perform",
    )

    parser.add_argument(
        "--follow",
        action="store_true",
        help="Follow logs in real-time (only for 'logs' action)",
    )

    return parser.parse_args()


def _execute_action(manager: DaemonManager, action: str, follow: bool = False) -> bool:
    """Execute the specified daemon action."""
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

    # Check if running on macOS
    if sys.platform != "darwin":
        print("❌ This daemon manager only works on macOS")
        sys.exit(1)

    manager = DaemonManager(args.site)

    try:
        success = _execute_action(manager, args.action, args.follow)
        sys.exit(0 if success else 1)

    except KeyboardInterrupt:
        print("\nOperation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
