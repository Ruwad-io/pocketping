<?php
/**
 * Plugin Name: PocketPing Live Chat
 * Plugin URI: https://pocketping.io
 * Description: Add PocketPing live chat widget to your WordPress site. Chat with visitors via Telegram, Discord, or Slack.
 * Version: 1.0.0
 * Author: PocketPing
 * Author URI: https://pocketping.io
 * License: MIT
 * License URI: https://opensource.org/licenses/MIT
 * Text Domain: pocketping
 * Domain Path: /languages
 * Requires at least: 5.0
 * Requires PHP: 7.4
 */

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

// Plugin constants
define('POCKETPING_VERSION', '1.0.0');
define('POCKETPING_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('POCKETPING_PLUGIN_URL', plugin_dir_url(__FILE__));

/**
 * Main PocketPing class
 */
class PocketPing {
    /**
     * Plugin instance
     */
    private static $instance = null;

    /**
     * Settings option name
     */
    const OPTION_NAME = 'pocketping_settings';

    /**
     * Default settings
     */
    private $defaults = array(
        'project_id'      => '',
        'position'        => 'bottom-right',
        'primary_color'   => '#6366f1',
        'welcome_message' => '',
        'enabled'         => true,
    );

    /**
     * Get plugin instance
     */
    public static function get_instance() {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Constructor
     */
    private function __construct() {
        // Admin hooks
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_enqueue_scripts', array($this, 'admin_enqueue_scripts'));

        // Frontend hooks
        add_action('wp_footer', array($this, 'inject_widget'));

        // Plugin links
        add_filter('plugin_action_links_' . plugin_basename(__FILE__), array($this, 'plugin_action_links'));
    }

    /**
     * Get settings
     */
    public function get_settings() {
        $settings = get_option(self::OPTION_NAME, array());
        return wp_parse_args($settings, $this->defaults);
    }

    /**
     * Add admin menu
     */
    public function add_admin_menu() {
        add_options_page(
            __('PocketPing Settings', 'pocketping'),
            __('PocketPing', 'pocketping'),
            'manage_options',
            'pocketping',
            array($this, 'render_settings_page')
        );
    }

    /**
     * Register settings
     */
    public function register_settings() {
        register_setting(
            'pocketping_settings_group',
            self::OPTION_NAME,
            array($this, 'sanitize_settings')
        );

        // Main section
        add_settings_section(
            'pocketping_main_section',
            __('Widget Configuration', 'pocketping'),
            array($this, 'render_main_section'),
            'pocketping'
        );

        // Project ID field
        add_settings_field(
            'project_id',
            __('Project ID', 'pocketping'),
            array($this, 'render_project_id_field'),
            'pocketping',
            'pocketping_main_section'
        );

        // Enabled field
        add_settings_field(
            'enabled',
            __('Enable Widget', 'pocketping'),
            array($this, 'render_enabled_field'),
            'pocketping',
            'pocketping_main_section'
        );

        // Appearance section
        add_settings_section(
            'pocketping_appearance_section',
            __('Appearance', 'pocketping'),
            null,
            'pocketping'
        );

        // Position field
        add_settings_field(
            'position',
            __('Position', 'pocketping'),
            array($this, 'render_position_field'),
            'pocketping',
            'pocketping_appearance_section'
        );

        // Primary color field
        add_settings_field(
            'primary_color',
            __('Primary Color', 'pocketping'),
            array($this, 'render_primary_color_field'),
            'pocketping',
            'pocketping_appearance_section'
        );

        // Welcome message field
        add_settings_field(
            'welcome_message',
            __('Welcome Message', 'pocketping'),
            array($this, 'render_welcome_message_field'),
            'pocketping',
            'pocketping_appearance_section'
        );
    }

    /**
     * Sanitize settings
     */
    public function sanitize_settings($input) {
        $sanitized = array();

        // Project ID - alphanumeric only
        if (isset($input['project_id'])) {
            $sanitized['project_id'] = sanitize_text_field($input['project_id']);
        }

        // Enabled - boolean
        $sanitized['enabled'] = !empty($input['enabled']);

        // Position - validate against allowed values
        $allowed_positions = array('bottom-right', 'bottom-left');
        if (isset($input['position']) && in_array($input['position'], $allowed_positions)) {
            $sanitized['position'] = $input['position'];
        } else {
            $sanitized['position'] = 'bottom-right';
        }

        // Primary color - validate hex color
        if (isset($input['primary_color'])) {
            $color = sanitize_hex_color($input['primary_color']);
            $sanitized['primary_color'] = $color ? $color : '#6366f1';
        }

        // Welcome message - sanitize text
        if (isset($input['welcome_message'])) {
            $sanitized['welcome_message'] = sanitize_textarea_field($input['welcome_message']);
        }

        return $sanitized;
    }

    /**
     * Enqueue admin scripts
     */
    public function admin_enqueue_scripts($hook) {
        if ('settings_page_pocketping' !== $hook) {
            return;
        }

        wp_enqueue_style('wp-color-picker');
        wp_enqueue_script('wp-color-picker');

        // Inline script for color picker
        wp_add_inline_script('wp-color-picker', '
            jQuery(document).ready(function($) {
                $(".pocketping-color-picker").wpColorPicker();
            });
        ');
    }

    /**
     * Render main section description
     */
    public function render_main_section() {
        echo '<p>' . esc_html__('Connect your PocketPing project to enable live chat on your site.', 'pocketping') . '</p>';
        echo '<p><a href="https://app.pocketping.io" target="_blank">' . esc_html__('Get your Project ID from the PocketPing dashboard', 'pocketping') . ' &rarr;</a></p>';
    }

    /**
     * Render project ID field
     */
    public function render_project_id_field() {
        $settings = $this->get_settings();
        ?>
        <input type="text"
               name="<?php echo esc_attr(self::OPTION_NAME); ?>[project_id]"
               value="<?php echo esc_attr($settings['project_id']); ?>"
               class="regular-text"
               placeholder="proj_xxxxxxxxxxxxx"
        />
        <p class="description">
            <?php esc_html_e('Your PocketPing Project ID. Find it in Settings > Installation.', 'pocketping'); ?>
        </p>
        <?php
    }

    /**
     * Render enabled field
     */
    public function render_enabled_field() {
        $settings = $this->get_settings();
        ?>
        <label>
            <input type="checkbox"
                   name="<?php echo esc_attr(self::OPTION_NAME); ?>[enabled]"
                   value="1"
                   <?php checked($settings['enabled']); ?>
            />
            <?php esc_html_e('Show chat widget on your site', 'pocketping'); ?>
        </label>
        <?php
    }

    /**
     * Render position field
     */
    public function render_position_field() {
        $settings = $this->get_settings();
        ?>
        <select name="<?php echo esc_attr(self::OPTION_NAME); ?>[position]">
            <option value="bottom-right" <?php selected($settings['position'], 'bottom-right'); ?>>
                <?php esc_html_e('Bottom Right', 'pocketping'); ?>
            </option>
            <option value="bottom-left" <?php selected($settings['position'], 'bottom-left'); ?>>
                <?php esc_html_e('Bottom Left', 'pocketping'); ?>
            </option>
        </select>
        <?php
    }

    /**
     * Render primary color field
     */
    public function render_primary_color_field() {
        $settings = $this->get_settings();
        ?>
        <input type="text"
               name="<?php echo esc_attr(self::OPTION_NAME); ?>[primary_color]"
               value="<?php echo esc_attr($settings['primary_color']); ?>"
               class="pocketping-color-picker"
               data-default-color="#6366f1"
        />
        <p class="description">
            <?php esc_html_e('Main color for the chat widget button and header.', 'pocketping'); ?>
        </p>
        <?php
    }

    /**
     * Render welcome message field
     */
    public function render_welcome_message_field() {
        $settings = $this->get_settings();
        ?>
        <textarea name="<?php echo esc_attr(self::OPTION_NAME); ?>[welcome_message]"
                  rows="3"
                  class="large-text"
                  placeholder="<?php esc_attr_e('Hi! How can we help you today?', 'pocketping'); ?>"
        ><?php echo esc_textarea($settings['welcome_message']); ?></textarea>
        <p class="description">
            <?php esc_html_e('Optional message shown when visitors first open the chat.', 'pocketping'); ?>
        </p>
        <?php
    }

    /**
     * Render settings page
     */
    public function render_settings_page() {
        if (!current_user_can('manage_options')) {
            return;
        }

        // Show success message after save
        if (isset($_GET['settings-updated'])) {
            add_settings_error(
                'pocketping_messages',
                'pocketping_message',
                __('Settings saved.', 'pocketping'),
                'updated'
            );
        }
        ?>
        <div class="wrap">
            <h1><?php echo esc_html(get_admin_page_title()); ?></h1>

            <?php settings_errors('pocketping_messages'); ?>

            <div style="display: flex; gap: 30px; margin-top: 20px;">
                <div style="flex: 1;">
                    <form action="options.php" method="post">
                        <?php
                        settings_fields('pocketping_settings_group');
                        do_settings_sections('pocketping');
                        submit_button(__('Save Settings', 'pocketping'));
                        ?>
                    </form>
                </div>

                <div style="width: 300px;">
                    <div style="background: #fff; border: 1px solid #ccd0d4; border-radius: 4px; padding: 20px;">
                        <h3 style="margin-top: 0;">
                            <span style="color: #6366f1;">&#9679;</span>
                            <?php esc_html_e('Need Help?', 'pocketping'); ?>
                        </h3>
                        <p><?php esc_html_e('Check out our documentation for setup guides and troubleshooting.', 'pocketping'); ?></p>
                        <p>
                            <a href="https://pocketping.io/docs" target="_blank" class="button">
                                <?php esc_html_e('View Documentation', 'pocketping'); ?>
                            </a>
                        </p>
                        <hr style="margin: 20px 0;">
                        <h4 style="margin-bottom: 10px;"><?php esc_html_e('Quick Links', 'pocketping'); ?></h4>
                        <ul style="margin: 0; padding-left: 20px;">
                            <li><a href="https://app.pocketping.io" target="_blank"><?php esc_html_e('Dashboard', 'pocketping'); ?></a></li>
                            <li><a href="https://pocketping.io/docs/widget" target="_blank"><?php esc_html_e('Widget Customization', 'pocketping'); ?></a></li>
                            <li><a href="https://pocketping.io/docs/bridges" target="_blank"><?php esc_html_e('Setup Telegram/Discord/Slack', 'pocketping'); ?></a></li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }

    /**
     * Inject widget in footer
     */
    public function inject_widget() {
        // Don't show in admin
        if (is_admin()) {
            return;
        }

        $settings = $this->get_settings();

        // Check if enabled and has project ID
        if (!$settings['enabled'] || empty($settings['project_id'])) {
            return;
        }

        // Build config object
        $config = array(
            'position' => $settings['position'],
        );

        if (!empty($settings['primary_color']) && $settings['primary_color'] !== '#6366f1') {
            $config['primaryColor'] = $settings['primary_color'];
        }

        if (!empty($settings['welcome_message'])) {
            $config['welcomeMessage'] = $settings['welcome_message'];
        }

        // Output widget script
        ?>
        <script>
            (function() {
                var config = <?php echo wp_json_encode($config); ?>;
                var script = document.createElement('script');
                script.src = 'https://widget.pocketping.io/widget.js';
                script.setAttribute('data-project-id', <?php echo wp_json_encode($settings['project_id']); ?>);

                // Apply config
                if (config.position) script.setAttribute('data-position', config.position);
                if (config.primaryColor) script.setAttribute('data-primary-color', config.primaryColor);
                if (config.welcomeMessage) script.setAttribute('data-welcome-message', config.welcomeMessage);

                document.head.appendChild(script);
            })();
        </script>
        <?php
    }

    /**
     * Add plugin action links
     */
    public function plugin_action_links($links) {
        $settings_link = '<a href="' . admin_url('options-general.php?page=pocketping') . '">' . __('Settings', 'pocketping') . '</a>';
        array_unshift($links, $settings_link);
        return $links;
    }
}

// Initialize plugin
PocketPing::get_instance();
