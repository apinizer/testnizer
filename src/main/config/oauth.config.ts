/**
 * OAuth Provider Credentials
 *
 * Bu dosyaya uygulamayı paketlemeden önce kendi OAuth client bilgilerini yaz.
 * Her provider için ilgili developer console'dan OAuth App oluşturup
 * client ID ve client secret'ı buraya koy.
 *
 * Redirect URI: http://localhost:19284/oauth/callback
 *
 * Google:  https://console.cloud.google.com/apis/credentials
 * GitHub:  https://github.com/settings/developers
 * GitLab:  https://gitlab.com/-/user_settings/applications
 */

export const OAUTH_CREDENTIALS = {
  google: {
    clientId: '441278122173-fkk4j5div9j729oin3ccrqhk2vafot6a.apps.googleusercontent.com',
    clientSecret: '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',
  },
  github: {
    clientId: 'YOUR_GITHUB_CLIENT_ID',
    clientSecret: 'YOUR_GITHUB_CLIENT_SECRET',
  },
  gitlab: {
    clientId: 'YOUR_GITLAB_CLIENT_ID',
    clientSecret: 'YOUR_GITLAB_CLIENT_SECRET',
  },
} as const
