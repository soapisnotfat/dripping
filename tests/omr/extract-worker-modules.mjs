// Read static import bytes without executing the SDK bundle. Vite exposes an
// ESTree parser and is already pinned as a project development dependency.
import { readFileSync } from 'node:fs';
import { parseAst } from 'vite';

const files = new Set([
  'printed_tuplets.py',
  'tuplet_glyphs.py',
  'tuplet_templates.json',
  'tuplet_classifier.json',
]);
const ast = parseAst(readFileSync(process.argv[2], 'utf8'));

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
}

const topLevel = new Map();
for (const statement of ast.body) {
  if (statement.type !== 'VariableDeclaration') continue;
  for (const { id, init } of statement.declarations) {
    if (id.type === 'Identifier') topLevel.set(id.name, staticString(init));
  }
}

const sources = {};
function visit(node) {
  if (
    node.type === 'CallExpression' &&
    node.callee.property?.name === 'writeFile' &&
    node.callee.object?.property?.name === 'FS'
  ) {
    const [destination, value] = node.arguments;
    const path = staticString(destination);
    const name = path?.split('/').at(-1);
    if (files.has(name)) {
      const source = value?.type === 'Identifier' ? topLevel.get(value.name) : staticString(value);
      if (typeof source !== 'string' || Object.hasOwn(sources, name)) {
        throw Error(`Cannot identify a unique static SDK module for ${name}`);
      }
      sources[name] = source;
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) visit(child);
    } else if (value?.type) visit(value);
  }
}
visit(ast);
for (const name of files) {
  if (!Object.hasOwn(sources, name))
    throw Error(`SDK worker does not expose static bytes for ${name}`);
}
process.stdout.write(JSON.stringify(sources));
