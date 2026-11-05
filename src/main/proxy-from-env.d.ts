/** `proxy-from-env` ships no types. */
declare module 'proxy-from-env' {
  /** The proxy URL for `url` from the environment; `''` for none or a `NO_PROXY` match. */
  export function getProxyForUrl(url: string): string
}
