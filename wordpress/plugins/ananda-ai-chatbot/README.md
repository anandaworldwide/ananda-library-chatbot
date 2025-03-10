# Ananda AI Chatbot WordPress Plugin

A WordPress plugin that adds an AI chatbot bubble to your site, connecting to this repo's
chat backend.

## Installation (Production)

1. Upload the `ananda-ai-chatbot` folder to the `/wp-content/plugins/` directory
2. Activate the plugin through the 'Plugins' menu in WordPress
3. Go to Settings > Ananda AI Chatbot to configure the Vercel API URL and UI settings

## Development Setup

This plugin uses Composer for dependency management and IDE support.

### Prerequisites

- PHP
- Composer

### Setup

1. Clone this repository to your WordPress plugins directory
2. Run `composer install` to install dependencies
3. Configure your IDE to use the WordPress stubs

### IDE Configuration (VS Code with Intelephense)

The plugin includes configuration files for VS Code with the Intelephense extension:

1. Install the Intelephense extension in VS Code
2. Open the plugin folder in VS Code
3. The included `.vscode/settings.json` and `.vscode/intelephense.json` files should configure your environment
   automatically
4. Restart VS Code completely

If you still see "undefined function" errors after restarting VS Code:

1. Open VS Code settings (Cmd+, or Ctrl+,)
2. Search for "intelephense stubs"
3. Make sure "wordpress" is in the list of stubs
4. Search for "intelephense include paths"
5. Make sure the path to the WordPress stubs is included (e.g., "vendor/php-stubs/wordpress-stubs")

## Files

- `ai-chatbot.php` - Main plugin file (Ananda AI Chatbot core)
- `assets/css/chatbot.css` - Styles for the chatbot
- `assets/js/chatbot.js` - JavaScript for the chatbot functionality
- `composer.json` - Composer package definition and dependencies
