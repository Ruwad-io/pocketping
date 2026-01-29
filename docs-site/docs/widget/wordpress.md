---
sidebar_position: 4
title: WordPress
description: Install PocketPing on WordPress with our official plugin
---

# WordPress Plugin

Add PocketPing live chat to your WordPress site in under 2 minutes.

## Installation

### Option 1: WordPress Plugin Directory (Recommended)

1. Go to **Plugins > Add New** in your WordPress admin
2. Search for "PocketPing"
3. Click **Install Now**, then **Activate**

### Option 2: Manual Upload

1. [Download the plugin](https://github.com/pocketping/pocketping/releases/latest) (pocketping.zip)
2. Go to **Plugins > Add New > Upload Plugin**
3. Upload the zip file and activate

---

## Configuration

After activation:

1. Go to **Settings > PocketPing**
2. Enter your **Project ID** from [app.pocketping.io](https://app.pocketping.io)
3. Customize appearance (optional)
4. Click **Save Settings**

![WordPress Settings](/img/wordpress-settings.png)

### Settings

| Setting | Description |
|---------|-------------|
| **Project ID** | Your PocketPing project ID (required) |
| **Enable Widget** | Toggle chat on/off without deactivating plugin |
| **Position** | Bottom-right or bottom-left |
| **Primary Color** | Widget button and header color |
| **Welcome Message** | First message shown when chat opens |

---

## Works With

The plugin is compatible with:

- **Page builders**: Elementor, Divi, Beaver Builder, WPBakery
- **E-commerce**: WooCommerce
- **Themes**: All themes
- **Caching plugins**: WP Super Cache, W3 Total Cache, LiteSpeed Cache
- **Multisite**: Yes (configure per site)

---

## Troubleshooting

### Widget not showing

1. Check that **Enable Widget** is checked
2. Verify your **Project ID** is correct
3. Clear your site cache (if using a caching plugin)
4. Check browser console for errors

### Position issues with other plugins

If the widget overlaps with another floating element:

1. Try switching to **Bottom Left** position
2. Or adjust the other element's position

### Caching conflicts

If changes don't appear:

1. Clear your caching plugin's cache
2. Clear browser cache
3. Wait a few minutes for CDN cache to expire

---

## Manual Installation (Without Plugin)

If you prefer not to use the plugin, add this to your theme's `footer.php` before `</body>`:

```html
<script
  src="https://widget.pocketping.io/widget.js"
  data-project-id="proj_xxxxxxxxxxxxx"
></script>
```

Or in your theme's `functions.php`:

```php
add_action('wp_footer', function() {
    ?>
    <script
      src="https://widget.pocketping.io/widget.js"
      data-project-id="<?php echo esc_attr(get_option('pocketping_project_id')); ?>"
    ></script>
    <?php
});
```

---

## Next Steps

- [Widget Configuration](/widget/configuration) - All customization options
- [Telegram Setup](/bridges/telegram) - Reply from Telegram
- [Discord Setup](/bridges/discord) - Reply from Discord
- [Slack Setup](/bridges/slack) - Reply from Slack
