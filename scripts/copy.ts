/**
 * Every sentence a screen can show, in one file, for reading the words on their own (`docs/UI.md`, "Words on a
 * screen"). A preview, not a check: nothing fails.
 *
 *   npm run copy [-- min]
 *
 * Reads the screens' source (`src/ui`, tests left out) and lists the text between tags and the strings inside them
 * (button titles, labels, hints) of `min` characters or more (45 unless given), by file and line, in
 * `.check/copy.txt`. Letters and reports are written in `src/engine` and have their own previews
 * (`npm run mail-preview`, `npm run gm-letters`).
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const min = Number(process.argv[2]) || 45;

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.tsx') && !name.includes('.test.')) files.push(path);
  }
};
walk('src/ui');

const insideTag = (node: ts.Node) => {
  for (let p = node.parent; p; p = p.parent)
    if (ts.isJsxElement(p) || ts.isJsxFragment(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxAttribute(p)) return true;
  return false;
};

const out: string[] = [];
let count = 0;
for (const file of files.sort()) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: string[] = [];
  const keep = (node: ts.Node, raw: string) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    // Two words at least, and not a class list (`btn btn-sm${…}`).
    if (text.length < min || !/[a-z] [a-z]/.test(text) || /^[a-z-]+ [a-z-]+(\$\{|$)/.test(text)) return;
    lines.push(`${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}  ${text}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) keep(node, node.text);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && insideTag(node))
      keep(node, node.text);
    else if (ts.isTemplateExpression(node) && insideTag(node)) keep(node, node.getText().slice(1, -1));
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (lines.length === 0) continue;
  out.push(`\n## ${file}`, ...lines);
  count += lines.length;
}

mkdirSync('.check', { recursive: true });
writeFileSync('.check/copy.txt', `${out.join('\n')}\n`);
console.log(`${count} lines from ${files.length} files in .check/copy.txt`);
