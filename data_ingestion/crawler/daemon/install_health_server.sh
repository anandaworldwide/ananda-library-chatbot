#!/bin/bash
# Health Server Daemon Installation Script
# 
# This script provides a simple way to install the health server daemon for a site.
# It checks prerequisites and guides the user through the installation process.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if Python is available
    if ! command_exists python3; then
        print_error "Python 3 is not installed or not in PATH"
        exit 1
    fi
    
    # Check if we're in the right directory
    if [ ! -f "health_server_daemon_manager.py" ]; then
        print_error "This script must be run from the daemon directory"
        print_error "Please run: cd data_ingestion/crawler/daemon"
        exit 1
    fi
    
    # Check if the daemon manager script is executable
    if [ ! -x "health_server_daemon_manager.py" ]; then
        print_warning "Making daemon manager script executable..."
        chmod +x health_server_daemon_manager.py
    fi
    
    print_success "Prerequisites check passed"
}

# Function to show usage
show_usage() {
    echo "Health Server Daemon Installation Script"
    echo ""
    echo "Usage: $0 <site-name> [action]"
    echo ""
    echo "Arguments:"
    echo "  site-name    The site ID (e.g., ananda-public, ananda, crystal, jairam)"
    echo "  action       Optional action (default: install)"
    echo "               Available actions: install, uninstall, status, start, stop, restart, logs"
    echo ""
    echo "Examples:"
    echo "  $0 ananda-public                    # Install health server for ananda-public"
    echo "  $0 ananda-public status             # Check status"
    echo "  $0 ananda-public logs --follow      # View logs in real-time"
    echo "  $0 ananda-public uninstall          # Uninstall health server"
    echo ""
    echo "Port assignments:"
echo "  ananda-public: 8081 (currently the only site with crawler)"
}

# Function to install the health server
install_health_server() {
    local site_name=$1
    
    print_status "Installing health server daemon for site: $site_name"
    
    # Run the daemon manager
    if python3 health_server_daemon_manager.py --site "$site_name" install; then
        print_success "Health server daemon installed successfully!"
        
        # Get the port for this site
        local port="8080"
        case "$site_name" in
            "ananda") port="8080" ;;
            "ananda-public") port="8081" ;;
            "crystal") port="8082" ;;
            "jairam") port="8083" ;;
        esac
        
        echo ""
        print_success "Health server is now available at:"
        echo "  Dashboard: http://127.0.0.1:$port/dashboard"
        echo "  API: http://127.0.0.1:$port/api/health"
        echo ""
        print_status "The health server will automatically start when you log in"
        print_status "To check status: $0 $site_name status"
        print_status "To view logs: $0 $site_name logs"
        
    else
        print_error "Failed to install health server daemon"
        exit 1
    fi
}

# Function to perform other actions
perform_action() {
    local site_name=$1
    local action=$2
    
    print_status "Performing action '$action' for site: $site_name"
    
    if python3 health_server_daemon_manager.py --site "$site_name" "$action"; then
        print_success "Action '$action' completed successfully"
    else
        print_error "Action '$action' failed"
        exit 1
    fi
}

# Main script logic
main() {
    # Check if help is requested
    if [ "$1" = "-h" ] || [ "$1" = "--help" ] || [ -z "$1" ]; then
        show_usage
        exit 0
    fi
    
    local site_name=$1
    local action=${2:-install}
    
    
    # Validate action
    case "$action" in
        "install"|"uninstall"|"status"|"start"|"stop"|"restart"|"logs")
            ;;
        *)
            print_error "Invalid action: $action"
            print_error "Valid actions: install, uninstall, status, start, stop, restart, logs"
            exit 1
            ;;
    esac
    
    # Check prerequisites
    check_prerequisites
    
    # Perform the requested action
    if [ "$action" = "install" ]; then
        install_health_server "$site_name"
    else
        perform_action "$site_name" "$action"
    fi
}

# Run main function with all arguments
main "$@" 