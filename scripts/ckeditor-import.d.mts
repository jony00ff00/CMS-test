/** The Cloud Services request signature (see ckeditor-import.mjs). */
export function signature(apiSecret: string, method: string, url: string, timestamp: number, body?: unknown): string;
