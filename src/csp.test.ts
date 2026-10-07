import { describe, expect, it } from 'vitest';
import { CSP, cspPlugin } from '../csp';
import html from '../index.html?raw';

describe('Content Security Policy', () => {
  it('goes into the built index.html, right after the charset, and only in builds', () => {
    const plugin = cspPlugin();
    expect(plugin.apply).toBe('build');
    const built = (plugin.transformIndexHtml as { handler: (html: string) => string }).handler(html);
    expect(built).toContain(`<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    expect(built.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('only lets the app talk to itself and api.github.com', () => {
    expect(CSP).toContain("script-src 'self';");
    expect(CSP).toContain("connect-src 'self' https://api.github.com;");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).not.toMatch(/script-src[^;]*unsafe/);
  });
});
