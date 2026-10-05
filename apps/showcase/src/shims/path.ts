/** Browser stand-in for `node:path` (POSIX subset used by packages/translate). */
export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? (i === 0 ? '/' : '.') : p.slice(0, i);
}

export function join(...parts: string[]): string {
  const segs: string[] = [];
  for (const s of parts.join('/').split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') segs.pop();
    else segs.push(s);
  }
  return (parts[0]?.startsWith('/') ? '/' : '') + segs.join('/');
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

export const sep = '/';
export default { dirname, join, basename, sep };
