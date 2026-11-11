#!/usr/bin/env node
// Import a document, with its suggestions and comments, into CKEditor Cloud Services (real-time collaboration).
// Run it on your server, never in a browser: it signs the request with your API secret.
//
//   CKEDITOR_ENVIRONMENT_ID=… CKEDITOR_API_SECRET=… node scripts/ckeditor-import.mjs brief.ckeditor-import.json
//
// The file is what the CMS's Output node downloads with "Export as: CKEditor 5 (Cloud Services import)".
// Optional: CKEDITOR_API_URL (default https://<environment id>.cke-cs.com/api/v5/<environment id>), and --dry-run to
// print the request without sending it.
//
// Not verified (CKEditor's documentation could not be read when this was written): the signature below follows
// CKEditor's documented "request signature" (HMAC SHA-256 over method, path, timestamp and body, sent in
// X-CS-Signature with X-CS-Timestamp). If Cloud Services refuses the signature, check it against your environment's
// documentation; if it refuses the body, compare the file with an export of a test document (GET /documents/<id>).
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function signature(apiSecret, method, url, timestamp, body) {
  const u = new URL(url);
  const hmac = createHmac('sha256', apiSecret);
  hmac.update(`${method.toUpperCase()}${u.pathname}${u.search}${timestamp}`);
  if (body !== undefined) hmac.update(Buffer.from(JSON.stringify(body)));
  return hmac.digest('hex');
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error('Usage: node scripts/ckeditor-import.mjs <file.ckeditor-import.json> [--dry-run]');
    process.exit(1);
  }
  const body = JSON.parse(readFileSync(file, 'utf8'));
  const env = process.env.CKEDITOR_ENVIRONMENT_ID;
  const secret = process.env.CKEDITOR_API_SECRET;
  if (!env || !secret) {
    console.error('Set CKEDITOR_ENVIRONMENT_ID and CKEDITOR_API_SECRET (from the CKEditor Ecosystem dashboard).');
    process.exit(1);
  }
  const base = process.env.CKEDITOR_API_URL ?? `https://${env}.cke-cs.com/api/v5/${env}`;
  const url = `${base}/documents`;
  const timestamp = Date.now();
  const headers = {
    'Content-Type': 'application/json',
    'X-CS-Timestamp': String(timestamp),
    'X-CS-Signature': signature(secret, 'POST', url, timestamp, body),
  };
  if (flag === '--dry-run') {
    console.log(JSON.stringify({ url, headers: { ...headers, 'X-CS-Signature': '(hidden)' }, documentId: body.id, suggestions: body.suggestions?.length, comments: body.comments?.length }, null, 2));
    return;
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  console.log(`${res.status} ${res.statusText}`);
  if (text) console.log(text);
  if (!res.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
