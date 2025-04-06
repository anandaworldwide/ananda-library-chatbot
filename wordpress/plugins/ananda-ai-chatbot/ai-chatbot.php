<?php
/*
Plugin Name: Ananda AI Chatbot
Description: Adds an AI chatbot bubble to your WordPress site, connecting to 
             a Vercel backend.
Author:      Michael Olivier
*/

// If this file is called directly, abort.
if (!defined('ABSPATH')) {
    exit;
}

// Define default API URLs
define('AICHATBOT_DEFAULT_PRODUCTION_URL', 'https://chat.ananda.org/api/chat/v1');
define('AICHATBOT_DEFAULT_DEVELOPMENT_URL', 'http://localhost:3000/api/chat/v1');

// Define plugin version at the top with other constants
define('AICHATBOT_VERSION', '1.0.29'); // Increment this when you make CSS or JS changes

// Function to get the API URL - prioritizing user settings
function aichatbot_get_api_url() {
    $configured_url = get_option('aichatbot_vercel_url');
    if (!empty($configured_url)) {
        return $configured_url;
    }
    return AICHATBOT_DEFAULT_PRODUCTION_URL;
}

// Include the secure API client
require_once plugin_dir_path(__FILE__) . 'secure-api-client.php';

// Include the secure API test page
require_once plugin_dir_path(__FILE__) . 'secure-api-test.php';

// Define WordPress API secret if not already defined
if (!defined('ANANDA_WP_API_SECRET')) {
    // Check if the constant is defined in wp-config.php
    if (defined('WP_API_SECRET') && !empty(WP_API_SECRET)) {
        // Use the directly defined secret if available
        define('ANANDA_WP_API_SECRET', WP_API_SECRET);
    } else if (defined('CHATBOT_BACKEND_SECURE_TOKEN') && !empty(CHATBOT_BACKEND_SECURE_TOKEN)) {
        // Derive the WordPress token from CHATBOT_BACKEND_SECURE_TOKEN using the same algorithm as the server
        // This should be the same value as computed in the Vercel backend
        $wp_token = hash('sha256', 'wordpress-' . CHATBOT_BACKEND_SECURE_TOKEN);
        $wp_token = substr($wp_token, 0, 32); // Use first 32 chars of the hash
        define('ANANDA_WP_API_SECRET', $wp_token);
    } else {
        // Use a default value only for development - NOT RECOMMENDED FOR PRODUCTION
        // In production, define either WP_API_SECRET or CHATBOT_BACKEND_SECURE_TOKEN in wp-config.php
        define('ANANDA_WP_API_SECRET', '');
    }
}

// Add settings page in WordPress admin
function aichatbot_register_settings() {
    add_options_page('Ananda AI Chatbot Settings', 'Ananda AI Chatbot', 'manage_options', 'aichatbot-settings', 'aichatbot_settings_page');
}
add_action('admin_menu', 'aichatbot_register_settings');

function aichatbot_register_options() {
    register_setting('aichatbot_settings_group', 'aichatbot_vercel_url');
    
    // Register new setting for the expected site ID
    register_setting('aichatbot_settings_group', 'aichatbot_expected_site_id', array(
        'type' => 'string',
        'default' => 'ananda-public',
        'sanitize_callback' => 'sanitize_text_field',
    ));
    
    // Register new settings for font size and window dimensions
    register_setting('aichatbot_settings_group', 'aichatbot_font_size', array(
        'type' => 'integer',
        'sanitize_callback' => 'aichatbot_validate_font_size',
        'default' => 16,
    ));
    
    register_setting('aichatbot_settings_group', 'aichatbot_window_width', array(
        'type' => 'integer',
        'sanitize_callback' => 'aichatbot_validate_window_width',
        'default' => 560,
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
    
    // Register setting for Intercom integration
    register_setting('aichatbot_settings_group', 'aichatbot_enable_intercom', array(
        'type' => 'boolean',
        'default' => false,
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
    return max(300, min(700, $input)); // Increased max width to accommodate 560px
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
                        </p>
                    </td>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_expected_site_id">Expected Site ID</label></th>
                    <td>
                        <input type="text" id="aichatbot_expected_site_id" name="aichatbot_expected_site_id" 
                               value="<?php echo esc_attr(get_option('aichatbot_expected_site_id', 'ananda-public')); ?>" size="30" />
                        <p class="description">
                            The Site ID this plugin expects to connect to. Must match the SITE_ID configured on the Vercel backend.
                            <br>
                            <small>Default: <code>ananda-public</code> - only change this if connecting to a different backend site.</small>
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
                               value="<?php echo esc_attr(get_option('aichatbot_window_width', 560)); ?>" min="300" max="700" step="10" />
                        <p class="description">
                            Set the width of the chat window (300px to 700px).
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
                        <textarea id="aichatbot_placeholder_questions" name="aichatbot_placeholder_questions" rows="5" cols="50">
                            <?php echo htmlspecialchars((string) get_option('aichatbot_placeholder_questions', 'How can I learn to meditate?'), ENT_QUOTES, 'UTF-8'); ?>
                        </textarea>
                        <p class="description">
                            Enter placeholder questions for the chatbot input, one per line. These will be randomly shown in the input field.
                        </p>
                    </td>
                </tr>
                
                <!-- Intercom Integration Settings -->
                <tr>
                    <th colspan="2"><h2 class="title">Intercom Integration</h2></th>
                </tr>
                
                <tr>
                    <th><label for="aichatbot_enable_intercom">Enable Intercom Integration</label></th>
                    <td>
                        <input type="checkbox" id="aichatbot_enable_intercom" name="aichatbot_enable_intercom" value="1" <?php echo (get_option('aichatbot_enable_intercom', false) ? 'checked="checked"' : ''); ?> />
                        <p class="description">
                            Enable integration with Intercom. When enabled, the Intercom widget will be hidden initially
                            and can be triggered by the chatbot when the user clicks on special text in the AI response.
                        </p>
                    </td>
                </tr>
                
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/**
 * Enqueues a style or script in the plugin directory. File last modified time is used as version string.
 * 
 * @param string $type 'style' or 'script'
 * @param string $handle Unique identifier
 * @param string $file Path to file relative to plugin directory
 * @param array $deps Dependencies
 * @param string|bool $media_or_footer For styles: media type, for scripts: whether to load in footer
 * @param bool $defer Whether to defer script loading (scripts only)
 */
function ananda_enqueue_asset($type, $handle, $file, $deps = array(), $media_or_footer = 'all', $defer = false) {
    $file_path = plugin_dir_path(__FILE__) . $file;
    $file_url = plugin_dir_url(__FILE__) . $file;
    $ver = filemtime($file_path);
    
    if ($type === 'style') {
        wp_enqueue_style($handle, $file_url, $deps, $ver, $media_or_footer);
    } else if ($type === 'script') {
        wp_enqueue_script($handle, $file_url, $deps, $ver, $media_or_footer);
        if ($defer) {
            wp_script_add_data($handle, 'defer', true);
        }
    }
}

// Load styles and scripts
function aichatbot_enqueue_assets() {
    // Enqueue Font Awesome from CDN with a reliable approach
    wp_enqueue_style('font-awesome', 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css', array(), null);
    
    // Enqueue plugin assets using the new function
    ananda_enqueue_asset('style', 'aichatbot-css', 'assets/css/chatbot.css', array(), 'all');
    ananda_enqueue_asset('script', 'aichatbot-auth', 'assets/js/chatbot-auth.js', array('jquery'), true);
    ananda_enqueue_asset('script', 'aichatbot-js', 'assets/js/chatbot.js', array('jquery', 'aichatbot-auth'), true);
    
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
    $window_width = get_option('aichatbot_window_width', 560);
    $window_height = get_option('aichatbot_window_height', 600);
    $fullpage_url = get_option('aichatbot_fullpage_url', '/chat');
    
    // Get Intercom integration settings
    $enable_intercom = get_option('aichatbot_enable_intercom', false);
    
    // Pass data to JavaScript - make sure it's available to BOTH scripts
    $data_array = array(
        'vercelUrl' => $vercel_url,
        'fontSizePx' => $font_size,
        'windowWidthPx' => $window_width,
        'windowHeightPx' => $window_height,
        'fullPageUrl' => $fullpage_url,
        'placeholderQuestionsText' => get_option('aichatbot_placeholder_questions', 'How can I learn to meditate?'),
        'enableIntercom' => $enable_intercom ? '1' : '0',
        'ajaxUrl' => admin_url('admin-ajax.php')
    );
    
    // Localize for both scripts to ensure data is available
    wp_localize_script('aichatbot-auth', 'aichatbotData', $data_array);
    wp_localize_script('aichatbot-js', 'aichatbotData', $data_array);
}
add_action('wp_enqueue_scripts', 'aichatbot_enqueue_assets');

// Add custom CSS to head for the chatbot appearance settings
function aichatbot_add_custom_css() {
    // Get appearance settings with defaults
    $font_size = get_option('aichatbot_font_size', 16);
    $window_width = get_option('aichatbot_window_width', 560);
    $window_height = get_option('aichatbot_window_height', 600);
    
    // Add Font Awesome directly to ensure it loads
    echo '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw==" crossorigin="anonymous" referrerpolicy="no-referrer" />';
    
    // Output custom CSS for chatbot appearance
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
    // Get placeholder questions and prepare for random selection
    $placeholder_text = (string) get_option('aichatbot_placeholder_questions', 'How can I learn to meditate?');
    $placeholder_array = array_filter(explode("\n", $placeholder_text));
    $random_placeholder = !empty($placeholder_array) 
                        ? esc_attr(trim($placeholder_array[array_rand($placeholder_array)])) 
                        : 'How can I learn to meditate?';

    echo '<div id="aichatbot-bubble">
            <span class="fa-stack">
                <i class="fas fa-circle fa-stack-2x"></i>
                <i class="fas fa-wand-magic-sparkles fa-stack-1x fa-inverse"></i>
                <!-- Fallback icon if wand-magic-sparkles isn\'t available -->
                <i class="fas fa-magic fa-stack-1x fa-inverse" style="display:none;"></i>
            </span>
          </div>';
    echo '<div id="aichatbot-window" style="display:none;">
            <div id="aichatbot-header">
                <h3>Ananda Intelligence (AI)</h3>
                <div class="aichatbot-header-controls">
                    <div class="aichatbot-language-hint">
                        <span class="hint-icon">🌐</span>
                        <span class="hint-text">Languages</span>
                    </div>
                    <span id="aichatbot-close"><i class="fas fa-chevron-down"></i></span>
                </div>
            </div>
            
            <div class="aichatbot-language-modal" style="display: none;">
                <div class="modal-content">
                    <h3>Chat in Your Language</h3>
                    <p>Feel free to ask questions in any language - I\'ll respond in the same language you use!</p>
                    <button class="modal-close">Got it</button>
                </div>
            </div>

            <div id="aichatbot-messages"></div>
            <div id="aichatbot-disclaimer" style="font-size: 12px; color: #888; text-align: center; padding: 5px 0;">Ananda Intelligence uses AI and may make mistakes.</div>
            <div id="aichatbot-input-container">
                <textarea id="aichatbot-input" placeholder="' . $random_placeholder . '" rows="1"></textarea>
                <button id="aichatbot-send"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>';
}
add_action('wp_footer', 'aichatbot_add_chat_bubble');

// Add this function to handle token requests from the frontend
function aichatbot_ajax_get_token() {
    // Prevent any output before our JSON response
    // This catches PHP notices, warnings, etc. that could break JSON
    ob_start();
    
    // For debugging: Log that the AJAX handler was called
    error_log('aichatbot_ajax_get_token called');
    
    // Security check with nonce would typically go here
    
    try {
        // Get a token using the secure API client
        $token = ananda_get_api_token();
        
        // Check if we got an error instead of a token
        if (is_wp_error($token)) {
            $error_message = $token->get_error_message();
            $error_code = $token->get_error_code();
            $error_data = $token->get_error_data();
            
            // Log the error for debugging
            error_log("WordPress token error: {$error_code} - {$error_message}");
            if ($error_data) {
                error_log("Error data: " . json_encode($error_data));
            }
            
            // Clear any previous output
            ob_clean();
            
            // Format specific error messages for common issues
            if ($error_code === 'site_mismatch') {
                wp_send_json_error(array(
                    'message' => $error_message,
                    'code' => 'site_mismatch',
                    'details' => 'The WordPress plugin is trying to connect to the wrong backend site. Check your Expected Site ID in the plugin settings.'
                ));
                return;
            } else if ($error_code === 'token_fetch_failed') {
                wp_send_json_error(array(
                    'message' => $error_message,
                    'code' => 'token_fetch_failed',
                    'details' => 'Failed to get a token from the backend server. Verify your API URL and security settings.'
                ));
                return;
            } else if ($error_code === 'missing_secret') {
                wp_send_json_error(array(
                    'message' => $error_message,
                    'code' => 'configuration_error',
                    'details' => 'The WordPress API secret is not configured. Please add CHATBOT_BACKEND_SECURE_TOKEN to your wp-config.php file.'
                ));
                return;
            }
            
            // Generic error response for other errors
            wp_send_json_error(array(
                'message' => $error_message,
                'code' => $error_code
            ));
            return;
        }
        
        // Log success for debugging
        error_log("Token successfully retrieved from backend (length: " . strlen($token) . ")");
        
        // Clear any previous output that might corrupt our JSON
        ob_clean();
        
        // Return the token to the frontend
        // The response structure should match what chatbot-auth.js expects:
        // - success: true/false (wp_send_json_success adds this)
        // - data: { token: "..." } (wp_send_json_success wraps in data object)
        wp_send_json_success(array(
            'token' => $token
        ));
    } catch (Exception $e) {
        // Clear any buffered output to ensure clean JSON response
        ob_clean();
        
        // Catch any unexpected PHP exceptions
        error_log("Unexpected exception in token handler: " . $e->getMessage());
        wp_send_json_error(array(
            'message' => 'Internal server error: ' . $e->getMessage(),
            'code' => 'internal_error'
        ));
    }
    
    // Clean up output buffer if we somehow get here
    ob_end_clean();
    exit;
}

// Register the AJAX handler
add_action('wp_ajax_aichatbot_get_token', 'aichatbot_ajax_get_token');         // For logged-in users
add_action('wp_ajax_nopriv_aichatbot_get_token', 'aichatbot_ajax_get_token');  // For non-logged-in users

// Add AJAX handler for API testing
add_action('wp_ajax_aichatbot_test_api', 'aichatbot_ajax_test_api');

/**
 * AJAX handler for testing the secure API connection
 * This handler is used by the admin test page to verify that the WordPress plugin
 * can communicate with the Vercel backend using token-based authentication.
 */
function aichatbot_ajax_test_api() {
    // Security check - only allow admin users
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array(
            'message' => 'Unauthorized access'
        ));
        return;
    }
    
    // Get a token using the secure API client
    $token = ananda_get_api_token();
    
    // Check if we got an error instead of a token
    if (is_wp_error($token)) {
        $error_message = $token->get_error_message();
        
        // Special handling for site mismatch errors
        if (strpos($error_message, 'Site mismatch') !== false) {
            wp_send_json_error(array(
                'message' => $error_message,
                'code' => 'site_mismatch'
            ));
            return;
        }
        
        // General error handling
        wp_send_json_error(array(
            'message' => $error_message
        ));
        return;
    }
    
    // If we get here, we have a valid token - try to decode it to show some info
    $token_parts = explode('.', $token);
    if (count($token_parts) === 3) {
        $payload = json_decode(base64_decode(str_replace(
            array('-', '_'), 
            array('+', '/'), 
            $token_parts[1]
        )), true);
        
        wp_send_json_success(array(
            'token_type' => 'JWT',
            'client' => isset($payload['client']) ? $payload['client'] : 'unknown',
            'expires' => isset($payload['exp']) ? date('Y-m-d H:i:s', $payload['exp']) : 'unknown',
            'message' => 'Successfully authenticated with the Vercel backend'
        ));
    } else {
        // We got a token but it's not in the expected JWT format
        wp_send_json_success(array(
            'token_type' => 'unknown',
            'message' => 'Received a token from the backend, but it\'s not in the expected JWT format'
        ));
    }
}

function aichatbot_chat_window_html() {
    $font_size = get_option('aichatbot_font_size', 16);
    $window_width = get_option('aichatbot_window_width', 560);
    $window_height = get_option('aichatbot_window_height', 600);
    $placeholder = get_option('aichatbot_placeholder_questions', 'Ask me anything about this website');
    
    ob_start();
    ?>
    <div id="aichatbot-window" class="aichatbot-window" style="width: <?php echo esc_attr($window_width); ?>px; height: <?php echo esc_attr($window_height); ?>px; font-size: <?php echo esc_attr($font_size); ?>px;">
        <!-- Language hint and modal -->
        <div class="aichatbot-language-hint" style="display: none;">
            <span class="hint-icon">🌐</span>
            <span class="hint-text">Languages</span>
        </div>
        
        <div class="aichatbot-language-modal" style="display: none;">
            <div class="modal-content">
                <h3>Chat in Your Language</h3>
                <p>Feel free to ask questions in any language - I'll respond in the same language you use!</p>
                <button class="modal-close">Got it</button>
            </div>
        </div>
        
        <!-- Existing chat window content -->
        <div class="aichatbot-header">
            <span class="aichatbot-title">Ananda AI Assistant</span>
            <button class="aichatbot-close">&times;</button>
        </div>
        <div id="aichatbot-messages"></div>
        <div id="aichatbot-disclaimer" style="font-size: 12px; color: #888; text-align: center; padding: 5px 0;">Ananda Intelligence uses AI and may make mistakes.</div>
        <div id="aichatbot-input-container">
            <textarea id="aichatbot-input" placeholder="' . $placeholder . '" rows="1"></textarea>
            <button id="aichatbot-send"><i class="fas fa-paper-plane"></i></button>
        </div>
    </div>
    <?php
    return ob_get_clean();
}