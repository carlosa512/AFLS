/**
 * Turn the single-file build (dist-single/index.html) into a shareable page
 * body: the host supplies <!doctype>, <html>, <head> and <body>, so keep only
 * the title, meta, font links, inline style, root element and inline script.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-single/index.html', 'utf8');
const grab = (re) => [...html.matchAll(re)].map((m) => m[0]);
const parts = [
  ...grab(/<title>[\s\S]*?<\/title>/g),
  ...grab(/<meta name="claude:[^>]*>/g),
  ...grab(/<link\s[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g).map((tag) => tag.replace(/\s+/g, ' ')),
  ...grab(/<style[^>]*>[\s\S]*?<\/style>/g),
  '<div id="root"></div>',
  ...grab(/<script[^>]*>[\s\S]*?<\/script>/g),
];
writeFileSync('dist-single/afls.html', parts.join('\n'));
console.log(`dist-single/afls.html written (${(Buffer.byteLength(parts.join('\n')) / 1024).toFixed(0)} KB)`);
