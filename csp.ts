import type { Plugin } from 'vite';

/**
 * The production Content Security Policy. Scripts only from the app itself, and network requests only
 * to the app and api.github.com, so injected code can't send the sync token anywhere else.
 * 'unsafe-inline' styles cover React style attributes, Recharts and Sonner.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CHARSET = '<meta charset="UTF-8" />';

/** Adds the CSP as a meta tag in builds only: the dev server relies on inline scripts for hot reload. */
export function cspPlugin(): Plugin {
  return {
    name: 'groundwork-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes(CHARSET)) throw new Error(`index.html needs ${CHARSET} so the Content Security Policy can follow it.`);
        return html.replace(CHARSET, `${CHARSET}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
  };
}
