/** Shared by the JVM / C-family variants: indent a block, wrap it in boilerplate. */

/** Prefix every non-empty line. */
export function indentBlock(code: string, prefix: string): string {
  return code
    .split('\n')
    .map((l) => (l ? prefix + l : l))
    .join('\n')
}

/** `public class Main { public static void main(...) { … } }` with imports. */
export function javaMain(imports: string[], code: string, ind: string): string {
  return [
    ...imports.map((i) => `import ${i};`),
    '',
    'public class Main {',
    `${ind}public static void main(String[] args) throws Exception {`,
    indentBlock(code, ind + ind),
    `${ind}}`,
    '}',
  ].join('\n')
}
