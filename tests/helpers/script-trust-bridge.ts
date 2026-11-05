/** `window.api.projectTrust` of a project that is not blocked (the common test case). */
export const allowScriptTrustBridge = {
  ensure: async () => ({
    success: true,
    data: { allowed: true, blocked: false, scriptCount: 0 },
  }),
  status: async () => ({ success: true, data: { blocked: false, scriptCount: 0 } }),
  block: async () => ({ success: true, data: true }),
}
