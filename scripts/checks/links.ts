// Link check (spec 10, M17 gate "links checked"): every relative Markdown link and anchor in README*.md, docs/**
// and spec/** must resolve to a file of the repository (tracked, or new and not ignored) and, for a Markdown
// target, to a heading or an explicit id in it. External links (any URL scheme) are not fetched.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Link {
  target: string;
  line: number;
}

/** GitHub's heading anchor: the rendered text, lowercased, punctuation dropped, each space a hyphen. */
export function slugify(heading: string): string {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/(\*\*|__|\*)/g, '');
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Lines outside fenced code blocks, with inline code spans blanked (line numbers are kept). */
function proseLines(markdown: string): string[] {
  let fence: string | null = null;
  return markdown.split('\n').map((line) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (m && m[1]!.startsWith(fence)) fence = null;
      return '';
    }
    if (m) {
      fence = m[1]!;
      return '';
    }
    return line.replace(/(`+)[^`]*?\1/g, (s) => ' '.repeat(s.length));
  });
}

export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const add = (slug: string) => {
    const n = seen.get(slug);
    seen.set(slug, (n ?? -1) + 1);
    anchors.add(n === undefined ? slug : `${slug}-${n + 1}`);
  };
  const lines = proseLines(markdown);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/<[a-z][^>]*\s(?:id|name)="([^"]+)"/gi)) anchors.add(m[1]!);
    const atx = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) return add(slugify(atx[1]!));
    const next = lines[i + 1];
    if (line.trim() && !/^\s{0,3}[-*>|]/.test(line) && next !== undefined && /^\s{0,3}(=+|-+)\s*$/.test(next)) {
      add(slugify(line));
    }
  });
  return anchors;
}

export function linksOf(markdown: string): Link[] {
  const links: Link[] = [];
  proseLines(markdown).forEach((line, i) => {
    const ref = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(line);
    if (ref) {
      links.push({ target: ref[1]!, line: i + 1 });
      return;
    }
    for (const m of line.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g)) {
      links.push({ target: (m[1] ?? m[2])!, line: i + 1 });
    }
  });
  return links;
}

/**
 * Problems as `file:line: target: reason`. `files` holds the Markdown sources (anchors are read from any of them),
 * `paths` every file of the repository, `inScope` which sources have their links checked.
 */
export function checkLinks(files: Map<string, string>, paths: Set<string>, inScope: (file: string) => boolean = () => true): string[] {
  const dirs = new Set<string>();
  for (const f of paths) for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) dirs.add(d);
  const problems: string[] = [];
  const anchorCache = new Map<string, Set<string>>();
  const anchors = (file: string) => {
    let a = anchorCache.get(file);
    if (!a) anchorCache.set(file, (a = anchorsOf(files.get(file) ?? '')));
    return a;
  };
  for (const [file, content] of files) {
    if (!inScope(file)) continue;
    for (const { target, line } of linksOf(content)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const hash = target.indexOf('#');
      const rawPath = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? '' : decode(target.slice(hash + 1));
      const decoded = decode(rawPath);
      const resolved = decoded === ''
        ? file
        : posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(file), decoded)).replace(/\/$/, '');
      if (resolved !== '.' && !paths.has(resolved) && !dirs.has(resolved)) {
        problems.push(`${file}:${line}: ${target}: no such file`);
        continue;
      }
      if (anchor && resolved.endsWith('.md') && files.has(resolved) && !anchors(resolved).has(anchor)) {
        problems.push(`${file}:${line}: ${target}: no heading or id "${anchor}" in ${resolved}`);
      }
    }
  }
  return problems;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function main(): void {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((p) => p && existsSync(root + p));
  const paths = new Set(listed);
  const scope = (p: string) => p.endsWith('.md') && (/^README[^/]*\.md$/.test(p) || p.startsWith('docs/') || p.startsWith('spec/'));
  const markdown = new Map<string, string>();
  for (const p of listed) if (p.endsWith('.md')) markdown.set(p, readFileSync(root + p, 'utf8'));
  const problems = checkLinks(markdown, paths, scope);
  if (problems.length) {
    console.error('links: broken relative links (fix the path or the anchor):');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const checked = [...markdown].filter(([p]) => scope(p));
  const count = checked.reduce((n, [, c]) => n + linksOf(c).length, 0);
  console.log(`links: ok (${count} links in ${checked.length} files)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
