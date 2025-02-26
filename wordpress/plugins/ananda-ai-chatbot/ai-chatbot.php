<?php
/*
Plugin Name: Ananda AI Chatbot
Description: Adds an AI chatbot bubble to your WordPress site, connecting to 
             a Vercel backend.
Version:     1.0
Author:      Michael Olivier
*/

// If this file is called directly, abort.
if (!defined('ABSPATH')) {
    exit;
}

// Define default API URLs
define('AICHATBOT_DEFAULT_PRODUCTION_URL', 'https://ananda-public-chatbot.vercel.app/api/chat/v1');
define('AICHATBOT_DEFAULT_DEVELOPMENT_URL', 'http://localhost:3000/api/chat/v1');

// Add settings page in WordPress admin
function aichatbot_register_settings() {
    add_options_page('Ananda AI Chatbot Settings', 'Ananda AI Chatbot', 'manage_options', 'aichatbot-settings', 'aichatbot_settings_page');
}
add_action('admin_menu', 'aichatbot_register_settings');

function aichatbot_register_options() {
    register_setting('aichatbot_settings_group', 'aichatbot_vercel_url');
    
    // Register new settings for font size and window dimensions
    register_setting('aichatbot_settings_group', 'aichatbot_font_size', array(
        'type' => 'integer',
        'sanitize_callback' => 'aichatbot_validate_font_size',
        'default' => 16,
    ));
    
    register_setting('aichatbot_settings_group', 'aichatbot_window_width', array(
        'type' => 'integer',
        'sanitize_callback' => 'aichatbot_validate_window_width',
        'default' => 375,
    ));
    
    register_setting('aichatbot_settings_group', 'aichatbot_window_height', array(
        'type' => 'integer',
        'sanitize_callback' => 'aichatbot_validate_window_height',
        'default' => 600,
    ));
    
    // Register setting for full page chat URL
    register_setting('aichatbot_settings_group', 'aichatbot_fullpage_url', array(
        'type' => 'string',
        'default' => '/chat',
    ));
    
    // Register setting for placeholder questions
    register_setting('aichatbot_settings_group', 'aichatbot_placeholder_questions', array(
        'type' => 'string',
        'default' => "Ask me anything about this website",
    ));
}
add_action('admin_init', 'aichatbot_register_options');

// Validation functions for new settings
function aichatbot_validate_font_size($input) {
    $input = intval($input);
    return max(12, min(24, $input)); // Limit font size between 12px and 24px
}

function aichatbot_validate_window_width($input) {
    $input = intval($input);
    return max(300, min(600, $input)); // Limit width between 300px and 600px
}

function aichatbot_validate_window_height($input) {
    $input = intval($input);
    return max(400, min(800, $input)); // Limit height between 400px and 800px
}

function aichatbot_settings_page() {
    ?>
    <div class="wrap">
        <h1>Ananda AI Chatbot Settings</h1>
        <form method="post" action="options.php">
            <?php settings_fields('aichatbot_settings_group'); ?>
            <table class="form-table">
                <tr>
                    <th><label for="aichatbot_vercel_url">Vercel API URL</label></th>
                    <td>
                        <input type="url" id="aichatbot_vercel_url" name="aichatbot_vercel_url" 
                               value="<?php echo esc_attr(get_option('aichatbot_vercel_url')); ?>" size="50" />
                        <p class="description">
                            Enter the full URL to your Vercel API endpoint. If left empty, the plugin will use
                            <code><?php echo htmlspecialchars(AICHATBOT_DEFAULT_PRODUCTION_URL, ENT_QUOTES, 'UTF-8'); ?></code> by default.
                            <br>
                            <small>In debug mode (WP_DEBUG=true), the local URL 
                            <code><?php echo htmlspecialchars(AICHATBOT_DEFAULT_DEVELOPMENT_URL, ENT_QUOTES, 'UTF-8'); ?></code> will be used.</small>
                        </p>
                    </td>
                </tr>
                
                <!-- Chat Window Appearance Settings -->
                <tr>
                    <th colspan="2"><h2 class="title">Chat Window Appearance</h2></th>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_font_size">Font Size (px)</label></th>
                    <td>
                        <input type="number" id="aichatbot_font_size" name="aichatbot_font_size" 
                               value="<?php echo esc_attr(get_option('aichatbot_font_size', 16)); ?>" min="12" max="24" step="1" />
                        <p class="description">
                            Set the font size for the chat window text (12px to 24px).
                        </p>
                    </td>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_window_width">Window Width (px)</label></th>
                    <td>
                        <input type="number" id="aichatbot_window_width" name="aichatbot_window_width" 
                               value="<?php echo esc_attr(get_option('aichatbot_window_width', 375)); ?>" min="300" max="600" step="10" />
                        <p class="description">
                            Set the width of the chat window (300px to 600px).
                        </p>
                    </td>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_window_height">Window Height (px)</label></th>
                    <td>
                        <input type="number" id="aichatbot_window_height" name="aichatbot_window_height" 
                               value="<?php echo esc_attr(get_option('aichatbot_window_height', 600)); ?>" min="400" max="800" step="10" />
                        <p class="description">
                            Set the height of the chat window (400px to 800px).
                        </p>
                    </td>
                </tr>
                
                <!-- Full Page Chat Settings -->
                <tr>
                    <th colspan="2"><h2 class="title">Full Page Chat Settings</h2></th>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_fullpage_url">Full Page Chat URL</label></th>
                    <td>
                        <input type="text" id="aichatbot_fullpage_url" name="aichatbot_fullpage_url" 
                               value="<?php echo esc_attr(get_option('aichatbot_fullpage_url', '/chat')); ?>" size="50" />
                        <p class="description">
                            Enter the URL for the full page chat experience. This can be a relative URL (e.g., "/chat") 
                            or an absolute URL (e.g., "https://example.com/chat").
                        </p>
                    </td>
                </tr>
                
                <!-- Placeholder Questions Settings -->
                <tr>
                    <th colspan="2"><h2 class="title">Placeholder Questions</h2></th>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_placeholder_questions">Placeholder Questions</label></th>
                    <td>
                        <textarea id="aichatbot_placeholder_questions" name="aichatbot_placeholder_questions" 
                                  rows="10" cols="60"><?php echo esc_attr(get_option('aichatbot_placeholder_questions')); ?></textarea>
                        <p class="description">
                            Enter one question per line. These will be randomly shown as placeholders in the chat input when empty.
                        </p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// Load styles and scripts
function aichatbot_enqueue_assets() {
    // Enqueue Font Awesome from CDN
    wp_enqueue_style('font-awesome', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css');
    wp_enqueue_style('aichatbot-css', plugins_url('assets/css/chatbot.css', __FILE__));
    wp_enqueue_script('aichatbot-js', plugins_url('assets/js/chatbot.js', __FILE__), array(), '1.0', true);
    
    // Get Vercel URL from settings, with fallbacks
    $saved_url = get_option('aichatbot_vercel_url');
    
    // If URL is not set in the settings or is empty
    if (empty($saved_url)) {
        // Use default URL or localhost if in debug mode
        $vercel_url = WP_DEBUG ? AICHATBOT_DEFAULT_DEVELOPMENT_URL : AICHATBOT_DEFAULT_PRODUCTION_URL;
    } else {
        // Use the URL from settings
        $vercel_url = $saved_url;
    }
    
    // Get appearance settings with defaults
    $font_size = get_option('aichatbot_font_size', 16);
    $window_width = get_option('aichatbot_window_width', 375);
    $window_height = get_option('aichatbot_window_height', 600);
    $fullpage_url = get_option('aichatbot_fullpage_url', '/chat');
    
    // Pass data to JavaScript
    wp_localize_script('aichatbot-js', 'aichatbotData', array(
        'vercelUrl' => $vercel_url,
        'fontSizePx' => $font_size,
        'windowWidthPx' => $window_width,
        'windowHeightPx' => $window_height,
        'fullPageUrl' => $fullpage_url,
        'placeholderQuestionsText' => get_option('aichatbot_placeholder_questions', '')
    ));
}
add_action('wp_enqueue_scripts', 'aichatbot_enqueue_assets');

// Add custom CSS to head for the chatbot appearance settings
function aichatbot_add_custom_css() {
    // Get appearance settings with defaults
    $font_size = get_option('aichatbot_font_size', 16);
    $window_width = get_option('aichatbot_window_width', 375);
    $window_height = get_option('aichatbot_window_height', 600);
    
    echo '<style type="text/css">
        #aichatbot-window {
            width: ' . $window_width . 'px;
            height: ' . $window_height . 'px;
            font-size: ' . $font_size . 'px !important;
        }
        #aichatbot-messages, 
        #aichatbot-input,
        .aichatbot-user-message, 
        .aichatbot-bot-message, 
        .aichatbot-error-message, 
        .aichatbot-typing {
            font-size: ' . $font_size . 'px !important;
        }
        
        /* Make sure message content respects font size */
        .aichatbot-message-content {
            font-size: ' . $font_size . 'px !important;
        }
        
        .aichatbot-message-content *,
        .aichatbot-message-content p,
        .aichatbot-message-content li,
        .aichatbot-message-content a {
            font-size: inherit !important;
        }
        
        /* Responsive adjustments for mobile */
        @media (max-width: 480px) {
            #aichatbot-window {
                width: 100%;
                height: 100%;
                bottom: 0;
                left: 0;
                border-radius: 0;
            }
        }
    </style>';
}
add_action('wp_head', 'aichatbot_add_custom_css');

// Add the chat bubble and window to the page
function aichatbot_add_chat_bubble() {
    echo '<div id="aichatbot-bubble">
            <span class="fa-stack">
                <i class="fas fa-circle fa-stack-2x"></i>
                <i class="fas fa-wand-magic-sparkles fa-stack-1x fa-inverse"></i>
            </span>
          </div>';
    echo '<div id="aichatbot-window" style="display:none;">
            <div id="aichatbot-messages"></div>
            <div id="aichatbot-disclaimer" style="font-size: 12px; color: #888; text-align: center; padding: 5px 0;">Ananda Assist uses AI, mistakes may occur.</div>
            <div id="aichatbot-input-container">
                <input type="text" id="aichatbot-input" placeholder="How can I learn to meditate?" />
                <button id="aichatbot-send"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>';
}
add_action('wp_footer', 'aichatbot_add_chat_bubble');
