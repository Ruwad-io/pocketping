# PocketPing Widget CDN

Cloudflare Worker that proxies the PocketPing widget from jsdelivr.

## URLs

- `https://cdn.pocketping.io/widget.js` → Latest version
- `https://cdn.pocketping.io/widget@1.0.0.js` → Specific version

## Setup

1. Install dependencies:
   ```bash
   cd cloudflare-workers/widget-cdn
   pnpm install
   ```

2. Login to Cloudflare:
   ```bash
   npx wrangler login
   ```

3. Deploy:
   ```bash
   pnpm deploy
   ```

4. Configure custom domain in Cloudflare dashboard:
   - Go to Workers & Pages → pocketping-widget-cdn
   - Settings → Triggers → Custom Domains
   - Add `cdn.pocketping.io`

## Development

```bash
pnpm dev
```

Opens local server at `http://localhost:8787`

## Usage

```html
<script src="https://cdn.pocketping.io/widget.js"></script>
<script>
  PocketPing.init({ endpoint: 'https://your-backend.com/pocketping' });
</script>
```
