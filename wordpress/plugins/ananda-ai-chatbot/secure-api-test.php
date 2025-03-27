<?php
/**
 * Secure API Test Page
 * 
 * This file provides an administrative interface for testing the secure API connection
 * between the WordPress plugin and the Vercel backend. It helps administrators:
 * 
 * 1. Verify proper API configuration
 * 2. Test token acquisition
 * 3. Test secure API communication
 * 4. Diagnose connection issues
 * 
 * The test page is accessible only to administrators with 'manage_options' capability
 * and provides clear feedback on the status of each test step.
 */

// If this file is called directly, abort.
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Register the API test page in the WordPress admin menu
 * 
 * Adds a submenu item under Settings to access the secure API test page.
 * The page is restricted to users with manage_options capability (admins).
 */
function ananda_register_api_test_page() {
    add_submenu_page(
        'options-general.php',           // Parent slug (Settings)
        'Secure API Test',               // Page title
        'Ananda AI Chatbot Security Test',  // Menu title
        'manage_options',                // Required capability
        'ananda-secure-api-test',        // Menu slug (unique identifier)
        'ananda_secure_api_test_page'    // Callback function to render the page
    );
}
add_action('admin_menu', 'ananda_register_api_test_page');

/**
 * Render the API test page content
 * 
 * This function performs the following:
 * 1. Verifies user permissions
 * 2. Checks API configuration
 * 3. Runs API tests if requested
 * 4. Displays test results and configuration status
 * 
 * The page includes a form to trigger tests and displays results in a user-friendly format.
 */
function ananda_secure_api_test_page() {
    // Verify user has sufficient permissions to access this page
    if (!current_user_can('manage_options')) {
        return; // Silently exit if unauthorized
    }
    
    // Initialize arrays and flags to track test results
    $test_results = [];
    $has_error = false;
    
    // First test: Check if the API secret is properly configured
    // This is a prerequisite for all other tests
    if (!defined('ANANDA_WP_API_SECRET') || empty(ANANDA_WP_API_SECRET)) {
        $test_results[] = [
            'name' => 'API Secret',
            'status' => 'error',
            'message' => 'API secret is not configured. Add either <code>define(\'WP_API_SECRET\', \'your-secret-here\');</code> or <code>define(\'CHATBOT_BACKEND_SECURE_TOKEN\', \'your-vercel-token\');</code> to your wp-config.php file.'
        ];
        $has_error = true;
    } else {
        $test_results[] = [
            'name' => 'API Secret',
            'status' => 'success',
            'message' => 'API secret is configured.'
        ];
    }
    
    // If form was submitted and we have a valid secret, perform the API tests
    if (isset($_POST['test_api']) && !$has_error) {
        // Test 1: Get a token from the Vercel backend
        $token = ananda_get_api_token();
        if (is_wp_error($token)) {
            $test_results[] = [
                'name' => 'Get Token',
                'status' => 'error',
                'message' => 'Failed to get token: ' . $token->get_error_message()
            ];
            $has_error = true;
        } else {
            $test_results[] = [
                'name' => 'Get Token',
                'status' => 'success',
                'message' => 'Successfully retrieved token.'
            ];
            
            // Test 2: Call a secure API endpoint using the token
            // Only execute this test if token acquisition succeeded
            $data = ananda_get_secure_data();
            if (is_wp_error($data)) {
                $test_results[] = [
                    'name' => 'Secure API Call',
                    'status' => 'error',
                    'message' => 'Failed to call secure API: ' . $data->get_error_message()
                ];
            } else {
                $test_results[] = [
                    'name' => 'Secure API Call',
                    'status' => 'success',
                    'message' => 'Successfully called secure API.'
                ];
                
                // Store the API response for display
                $api_response = $data;
            }
        }
    }
    
    // Begin rendering the page with WordPress admin styling
    ?>
    <div class="wrap">
        <h1><?php echo esc_html(get_admin_page_title()); ?></h1>
        
        <div class="notice notice-info">
            <p>
                This page tests the secure API connection to the Vercel backend using token-based authentication.
                Make sure you have configured one of the following in your wp-config.php file:
            </p>
            <ol>
                <li><code>define('WP_API_SECRET', 'your-secret-here');</code> - Direct API secret value</li>
                <li><code>define('CHATBOT_BACKEND_SECURE_TOKEN', 'your-vercel-token');</code> - Same token used in Vercel's SECURE_TOKEN env var</li>
            </ol>
            <p>
                Using the CHATBOT_BACKEND_SECURE_TOKEN option is recommended as it automatically derives the correct WordPress token
                from the Vercel backend's token.
            </p>
        </div>
        
        <h2>API Configuration</h2>
        <table class="form-table">
            <tr>
                <th scope="row">Vercel API URL</th>
                <td>
                    <?php 
                    $vercel_url = get_option('aichatbot_vercel_url');
                    if (empty($vercel_url)) {
                        if (WP_DEBUG) {
                            echo '<code>' . esc_html(AICHATBOT_DEFAULT_DEVELOPMENT_URL) . '</code> (Development mode)';
                        } else {
                            echo '<code>' . esc_html(AICHATBOT_DEFAULT_PRODUCTION_URL) . '</code> (Production mode)';
                        }
                    } else {
                        echo '<code>' . esc_html($vercel_url) . '</code>';
                    }
                    ?>
                </td>
            </tr>
            <tr>
                <th scope="row">Expected Backend Site</th>
                <td>
                    <?php 
                    $expected_site_id = get_option('aichatbot_expected_site_id', 'ananda-public');
                    echo '<code>' . esc_html($expected_site_id) . '</code>';
                    echo '<p class="description">This is the site ID the plugin expects on the backend. If incorrect, you\'ll get a "Site mismatch" error.</p>';
                    ?>
                </td>
            </tr>
            <tr>
                <th scope="row">Authentication Method</th>
                <td>
                    <?php
                    if (defined('CHATBOT_BACKEND_SECURE_TOKEN') && !empty(CHATBOT_BACKEND_SECURE_TOKEN)) {
                        echo 'Using <code>CHATBOT_BACKEND_SECURE_TOKEN</code> (Recommended)';
                    } elseif (defined('WP_API_SECRET') && !empty(WP_API_SECRET)) {
                        echo 'Using <code>WP_API_SECRET</code>';
                    } else {
                        echo '<span style="color: red;">No API secret configured.</span>';
                    }
                    ?>
                </td>
            </tr>
        </table>
        
        <h2>API Test</h2>
        <p>Click the "Test API Connection" button to verify that your WordPress plugin can communicate with the Vercel backend.</p>
        
        <div id="api-test-results" style="display: none; margin-top: 20px;"></div>
        
        <button id="test-api-connection" class="button button-primary">Test API Connection</button>
        
        <script>
        jQuery(document).ready(function($) {
            $('#test-api-connection').on('click', function() {
                var resultsDiv = $('#api-test-results');
                resultsDiv.html('<div class="notice notice-info"><p>Testing API connection...</p></div>');
                resultsDiv.show();
                
                $.ajax({
                    url: ajaxurl,
                    method: 'POST',
                    data: {
                        action: 'aichatbot_test_api'
                    },
                    success: function(response) {
                        if (response.success) {
                            resultsDiv.html('<div class="notice notice-success"><p><strong>Success!</strong> Connected to the Vercel backend successfully.</p>' +
                                '<p>Token received and validated. Your WordPress plugin is properly configured to communicate with the Vercel backend.</p>' +
                                '<p>Token client type: <code>' + response.data.client + '</code></p>' +
                                '</div>');
                        } else {
                            var errorMessage = response.data.message || 'Unknown error';
                            
                            // Special handling for site mismatch errors
                            if (errorMessage.includes('Site mismatch')) {
                                resultsDiv.html('<div class="notice notice-error"><p><strong>Site Mismatch Error!</strong></p>' +
                                    '<p>' + errorMessage + '</p>' +
                                    '<p><strong>How to fix:</strong></p>' +
                                    '<ol>' +
                                    '<li>Go to <a href="options-general.php?page=aichatbot-settings">Ananda AI Chatbot Settings</a></li>' +
                                    '<li>Update the "Expected Site ID" field to match the actual backend site ID</li>' +
                                    '<li>Or connect to a different backend by changing the Vercel API URL</li>' +
                                    '</ol>' +
                                    '</div>');
                            } else {
                                resultsDiv.html('<div class="notice notice-error"><p><strong>Error!</strong> Failed to connect to the Vercel backend.</p>' +
                                    '<p>Error message: ' + errorMessage + '</p>' +
                                    '</div>');
                            }
                        }
                    },
                    error: function() {
                        resultsDiv.html('<div class="notice notice-error"><p><strong>Error!</strong> AJAX request failed.</p>' +
                            '<p>Check your browser console for more details.</p></div>');
                    }
                });
            });
        });
        </script>
    </div>
    <?php
} 