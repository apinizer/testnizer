/**
 * OAuth Provider Credentials
 * Redirect URI: http://localhost:19284/oauth/callback
 * Google:  https://console.cloud.google.com/apis/credentials
 * GitHub:  https://github.com/settings/developers
 * GitLab:  https://gitlab.com/-/user_settings/applications
 */

export const OAUTH_CREDENTIALS = {
  google: {
    clientId: '954491461795-v3c2mlmd660jsrc0gg8dg07e6i4k9im1.apps.googleusercontent.com',
    clientSecret: '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',
  },
  github: {
    clientId: 'Ov23li1HrKTXqG1z0lSr',
    clientSecret: '69c84ab8d9b8b1992dfbe21226592fba25b0d6e4',
  },
  gitlab: {
    clientId: 'f2fd3505f566ee127d7f89c89b157ee5eeecbe9f3394bba33a7cdfa8311f2ec9',
    clientSecret: 'gloas-e9e13b55de9ccc96393be522f0d933e5ad155172b3f97f9bf7828c19ae002260',
  },
} as const
