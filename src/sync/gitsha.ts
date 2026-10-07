/** Git object ids, computed with Web Crypto so unchanged files can be recognised without downloading them. */

const encoder = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-1 of `blob ${byteLength}\0` plus the UTF-8 bytes: git's id for a file with this text. */
export async function blobSha(text: string): Promise<string> {
  const body = encoder.encode(text);
  const head = encoder.encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(head.byteLength + body.byteLength);
  bytes.set(head);
  bytes.set(body, head.byteLength);
  return hex(await crypto.subtle.digest('SHA-1', bytes));
}

/** Blob ids for a map of path to text. */
export async function blobShas(files: Map<string, string>): Promise<Map<string, string>> {
  return new Map(await Promise.all([...files].map(async ([path, text]) => [path, await blobSha(text)] as const)));
}

export const byteLength = (text: string) => encoder.encode(text).byteLength;
