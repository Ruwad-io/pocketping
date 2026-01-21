/**
 * PocketPing Widget CDN Worker
 *
 * Proxies the widget from jsdelivr with caching and CORS headers.
 * Deploy to: cdn.pocketping.io
 *
 * Routes:
 *   /widget.js       → Latest widget version
 *   /widget@1.0.0.js → Specific version
 */

interface Env {
  // Optional: Add KV binding for analytics
  // ANALYTICS?: KVNamespace;
}

const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/npm/@pocketping/widget';
const CACHE_TTL = 3600; // 1 hour for latest
const CACHE_TTL_VERSIONED = 31536000; // 1 year for specific versions

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // Parse version from path
    let version = 'latest';
    let cacheTtl = CACHE_TTL;

    if (path === '/widget.js' || path === '/') {
      version = 'latest';
      cacheTtl = CACHE_TTL;
    } else {
      // /widget@1.0.0.js → 1.0.0
      const match = path.match(/^\/widget@([\d.]+)\.js$/);
      if (match) {
        version = match[1];
        cacheTtl = CACHE_TTL_VERSIONED;
      } else {
        return new Response('Not Found', { status: 404 });
      }
    }

    const jsdelivrUrl = `${JSDELIVR_BASE}@${version}/dist/pocketping.iife.js`;

    try {
      const response = await fetch(jsdelivrUrl, {
        cf: {
          cacheTtl,
          cacheEverything: true,
        },
      });

      if (!response.ok) {
        return new Response(`Widget version ${version} not found`, {
          status: 404,
          headers: corsHeaders(),
        });
      }

      const body = await response.text();

      return new Response(body, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': `public, max-age=${cacheTtl}`,
          ...corsHeaders(),
        },
      });
    } catch (error) {
      return new Response('Failed to fetch widget', {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
