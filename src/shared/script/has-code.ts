/**
 * Would this script do anything? Only comments and whitespace do nothing: the project
 * dialog saves `// Runs before every request…` as the default script of every project,
 * and git carries it, so counting that as a script would stop every cloned project.
 *
 * One left-to-right pass, as a tokenizer reads comments. Any other character survives,
 * including those of a string holding comment-like text, so this errs towards "has code".
 */
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n\r\u2028\u2029]*/g

export function scriptHasCode(script: unknown): script is string {
  return typeof script === 'string' && script.replace(COMMENT, '').trim().length > 0
}
