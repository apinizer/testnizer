/**
 * Entry point kept at the original path so every existing import — components,
 * the tools catalog and `tests/renderer/jwk-tool.test.tsx` — is unaffected by
 * the split into `tools/jwk/`.
 */
export { default } from './jwk/JwkTool'
