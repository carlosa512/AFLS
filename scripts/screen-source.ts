/**
 * The words a screen can show, read from its source: the text between tags and the strings inside them (button
 * titles, labels, hints), by line, with whatever the app fills in shown as `{…}`. `npm run copy` lists them for
 * reading and `letterRules.test.ts` holds each to the words no text in the game uses.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Every screen file under a folder, tests left out. */
export function screenFiles(dir = 'src/ui'): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.tsx') && !name.includes('.test.')) files.push(path);
    }
  };
  walk(dir);
  return files.sort();
}

const insideTag = (node: ts.Node) => {
  for (let p = node.parent; p; p = p.parent) {
    // A class list is not words.
    if (ts.isJsxAttribute(p) && p.name.getText() === 'className') return false;
    if (ts.isJsxElement(p) || ts.isJsxFragment(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxAttribute(p)) return true;
  }
  return false;
};

/** A screen file's text of `min` characters or more, two words at least. */
export function screenLines(file: string, min = 45): { line: number; text: string }[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: { line: number; text: string }[] = [];
  const keep = (node: ts.Node, raw: string) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    // Two words at least, and not a class list (`btn btn-sm`).
    if (text.length < min || !/[A-Za-z] [A-Za-z]/.test(text) || /^[a-z-]+ [a-z-]+(\{…\}|$)/.test(text)) return;
    out.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) keep(node, node.text);
    else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && insideTag(node))
      keep(node, node.text);
    else if (ts.isTemplateExpression(node) && insideTag(node))
      keep(node, node.head.text + node.templateSpans.map((s) => `{…}${s.literal.text}`).join(''));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}
