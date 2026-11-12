/**
 * The words the people who write to you can say, read from the source: every piece of prose in the files that word
 * letters (`LETTER_FILES` in `src/engine/letterRules.ts`), by file and line, with whatever the sim fills in shown as
 * `{…}`. `npm run letters` lists them for reading and `letterRules.test.ts` holds each to the house rules.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export interface SourceLine {
  file: string;
  line: number;
  /** The text as written, a filled-in part shown as `{…}`. */
  text: string;
}

/** Prose: three words running, opening on a capital, a quote or a filled-in part. Keys, ids and class lists are not. */
const prose = (text: string) =>
  /[A-Za-z’']+ [A-Za-z’']+ [A-Za-z’']+/.test(text.replace(/\{…\}/g, 'x')) && /^[“"'‘(]?([A-Z]|\{…\})/.test(text);

const inType = (node: ts.Node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    if (ts.isStatement(p)) return false;
  }
  return false;
};

/** A template's text with each `${…}` as `{…}`. */
const templateText = (node: ts.TemplateExpression) =>
  node.head.text + node.templateSpans.map((s) => `{…}${s.literal.text}`).join('');

export function sourceLines(file: string): SourceLine[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: SourceLine[] = [];
  const keep = (node: ts.Node, raw: string) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!prose(text) || inType(node)) return;
    out.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) keep(node, node.text);
    else if (ts.isTemplateExpression(node)) keep(node, templateText(node));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}
