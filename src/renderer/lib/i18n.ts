// src/renderer/lib/i18n.ts
// Lightweight i18n system — no external dependency

import { useUIStore } from '../stores/ui.store'

export type Locale = 'en' | 'tr'

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Header
    'header.apiTester': 'API Tester',
    'header.newProject': 'New Project',

    // Left Panel
    'leftPanel.apis': 'APIs',
    'leftPanel.search': 'Search...',
    'leftPanel.new': 'New',

    // New Dropdown
    'newDropdown.httpEndpoint': 'HTTP Endpoint',
    'newDropdown.quickRequest': 'Quick Request',
    'newDropdown.websocket': 'WebSocket',
    'newDropdown.soap': 'SOAP',
    'newDropdown.graphql': 'GraphQL',
    'newDropdown.grpc': 'gRPC',
    'newDropdown.sse': 'SSE',
    'newDropdown.schema': 'Schema',
    'newDropdown.markdown': 'Markdown',
    'newDropdown.folder': 'Folder',
    'newDropdown.module': 'Module',
    'newDropdown.import': 'Import',
    'newDropdown.importCurl': 'Import cURL',
    'newDropdown.more': 'More...',
    'newDropdown.other': 'Other',

    // URL Bar
    'urlBar.send': 'Send',
    'urlBar.sending': 'Sending...',
    'urlBar.save': 'Save',
    'urlBar.import': 'Import',
    'urlBar.enterUrl': 'Enter URL...',

    // Request tabs
    'request.params': 'Params',
    'request.auth': 'Auth',
    'request.headers': 'Headers',
    'request.body': 'Body',
    'request.preRequest': 'Pre-request',
    'request.tests': 'Tests',

    // Response tabs
    'response.response': 'Response',
    'response.cookie': 'Cookie',
    'response.console': 'Console',
    'response.actualRequest': 'Actual Request',

    // Response meta
    'response.ms': 'ms',
    'response.kb': 'KB',
    'response.tests': 'Tests',
    'response.save': 'Save',
    'response.copy': 'Copy',
    'response.code': 'Code',
    'response.sendingRequest': 'Sending request...',
    'response.requestFailed': 'Request Failed',

    // Body types
    'body.none': 'none',
    'body.json': 'JSON',
    'body.xml': 'XML',
    'body.formData': 'form-data',
    'body.urlencoded': 'urlencoded',
    'body.binary': 'binary',

    // Auth types
    'auth.noAuth': 'No Auth',
    'auth.basicAuth': 'Basic Auth',
    'auth.bearerToken': 'Bearer Token',
    'auth.apiKey': 'API Key',
    'auth.oauth2': 'OAuth 2.0',
    'auth.digest': 'Digest',
    'auth.ntlm': 'NTLM',

    // Tests
    'tests.visualAssertions': 'Visual Assertions',
    'tests.addAssertion': 'Add Assertion',
    'tests.statusCodeEquals': 'Status code equals',
    'tests.responseTimeLessThan': 'Response time less than',
    'tests.bodyContains': 'Body contains',
    'tests.headerExists': 'Header exists',
    'tests.headerEquals': 'Header equals',
    'tests.jsonPathEquals': 'JSON path equals',

    // Footer
    'footer.ready': 'Ready',
    'footer.runner': 'Runner',
    'footer.console': 'Console',
    'footer.cookies': 'Cookies',
    'footer.noEnvironment': 'No Environment',

    // Import Modal
    'import.title': 'Import API Data',
    'import.subtitle': 'Please select the corresponding data source format',
    'import.cancel': 'Cancel',
    'import.next': 'Next',

    // Settings Modal
    'settings.title': 'Settings',
    'settings.theme': 'Theme',
    'settings.language': 'Language',
    'settings.fontSize': 'Font Size',
    'settings.timeout': 'Request Timeout',
    'settings.sslVerification': 'SSL Certificate Verification',
    'settings.proxy': 'Proxy Settings',
    'settings.systemProxy': 'System Proxy',
    'settings.noProxy': 'No Proxy',
    'settings.customProxy': 'Custom Proxy',
    'settings.host': 'Host',
    'settings.port': 'Port',
    'settings.autoUpdate': 'Auto Update',
    'settings.checkForUpdates': 'Check for Updates',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save',
    'settings.light': 'Light',
    'settings.dark': 'Dark',
    'settings.system': 'System',
    'settings.turkish': 'Turkish',
    'settings.english': 'English',

    // Collection Runner
    'runner.title': 'Collection Runner',
    'runner.runCollection': 'Run Collection',
    'runner.stop': 'Stop',
    'runner.exportJson': 'Export JSON',
    'runner.exportHtml': 'Export HTML',

    // Empty states
    'empty.clickSend': 'Click Send to get a response',
    'empty.noResponse': 'No response yet',
    'empty.enterUrl': 'Enter a URL and click Send to see the response here',

    // Icon Sidebar
    'sidebar.apis': 'APIs',
    'sidebar.tests': 'Tests',
    'sidebar.docs': 'Publish Docs',
    'sidebar.history': 'History',
    'sidebar.settings': 'Settings',
    'sidebar.invite': 'Invite',

    // Footer extras
    'footer.online': 'Online',
    'footer.requestProxy': 'Request Proxy',
    'footer.trash': 'Trash',
    'footer.help': 'Help & support',
    'footer.designFirst': 'Design-first Mode',
    'footer.requestFirst': 'Request-first Mode',

    // General
    'general.close': 'Close',
    'general.delete': 'Delete',
    'general.edit': 'Edit',
    'general.duplicate': 'Duplicate',
    'general.move': 'Move',
    'general.add': 'Add',
    'general.remove': 'Remove',
    'general.enable': 'Enable',
    'general.disable': 'Disable',

    // Home / Project selection
    'home.subtitle': 'Select a project or create a new one to get started',
    'home.projects': 'Projects',
    'home.newProject': 'New Project',
    'home.createProject': 'Create New Project',
    'home.projectNamePlaceholder': 'Enter project name...',
    'home.create': 'Create',
    'home.creating': 'Creating...',
    'home.cancel': 'Cancel',
    'home.delete': 'Delete',
    'home.noProjects': 'No projects yet. Create one to get started.',
    'home.tab': 'Home',

    // Project Welcome (empty project)
    'projectWelcome.newHttpEndpoint': 'New HTTP Endpoint',
    'projectWelcome.newSchema': 'New Schema',
    'projectWelcome.newMarkdown': 'New Markdown',
    'projectWelcome.quickRequest': 'Quick Request',
    'projectWelcome.more': 'More',

    // New Project Modal
    'newProject.title': 'New Project',
    'newProject.step.source': 'Project Source',
    'newProject.step.details': 'Details & Appearance',
    'newProject.step.storage': 'Storage Settings',
    'newProject.source.new': 'Create New',
    'newProject.source.newSub': 'Start from scratch',
    'newProject.source.git': 'Clone from Git',
    'newProject.source.gitSub': 'Clone an existing repository',
    'newProject.source.local': 'Open Local',
    'newProject.source.localSub': 'Open a local project file',
    'newProject.git.repoUrl': 'Repository URL',
    'newProject.git.repoUrlPlaceholder': 'https://github.com/user/repo.git',
    'newProject.git.username': 'Username',
    'newProject.git.branch': 'Branch',
    'newProject.git.token': 'Personal Access Token',
    'newProject.git.tokenHint': 'Token is stored encrypted · Settings → Developer settings → PAT',
    'newProject.git.localDir': 'Local Directory',
    'newProject.git.localDirPlaceholder': 'Where to clone the repo...',
    'newProject.git.cloning': 'Cloning...',
    'newProject.git.selectProject': 'Select project file to import',
    'newProject.name': 'Project Name *',
    'newProject.namePlaceholder': 'e.g. Payment Service API',
    'newProject.nameRequired': 'Project name is required',
    'newProject.description': 'Description',
    'newProject.descPlaceholder': 'A brief description about the project...',
    'newProject.type': 'Project Type',
    'newProject.branchName': 'Initial Branch Name',
    'newProject.branchHint': 'You can add more branches later',
    'newProject.icon': 'Icon',
    'newProject.iconAuto': 'Auto',
    'newProject.iconAutoSub': 'Name initials',
    'newProject.iconEmoji': 'Emoji',
    'newProject.iconEmojiSub': 'Pick an emoji',
    'newProject.emojiPaste': 'or paste here:',
    'newProject.color': 'Color',
    'newProject.preview': 'Project preview',
    'newProject.saveMode': 'Save Mode',
    'newProject.modeLocal': 'Local',
    'newProject.modeLocalSub': 'This computer only',
    'newProject.modeGit': 'Git',
    'newProject.modeGitSub': 'GitHub / GitLab',
    'newProject.modeBoth': 'Both',
    'newProject.modeBothSub': 'Local + Git backup',
    'newProject.localFolder': 'Local Folder',
    'newProject.selectFolder': 'Browse...',
    'newProject.folderPlaceholder': 'Select a folder...',
    'newProject.summary': 'Project Summary',
    'newProject.back': 'Back',
    'newProject.next': 'Next',
    'newProject.create': 'Create',
    'newProject.creating': 'Creating...',
    'newProject.done': 'Project Created!',
    'newProject.doneMsg': 'was created successfully',
    'newProject.openProject': 'Open Project',
    'newProject.localSave': 'Local save',
    'newProject.gitSave': 'Git:',
    'newProject.noRepo': 'repo not specified',
    'newProject.bothSave': 'Local + Git backup',

    // Update Modal
    'update.checking': 'Checking for updates...',
    'update.available': 'Update available',
    'update.download': 'Download',
    'update.downloading': 'Downloading...',
    'update.ready': 'Update ready! Restart to apply',
    'update.restartNow': 'Restart Now',
    'update.later': 'Later',
    'update.upToDate': "You're up to date",
    'update.error': 'Update check failed',
    'update.retry': 'Retry',
    'update.releaseNotes': 'Release Notes',
    'update.version': 'Version',
  },

  tr: {
    // Header
    'header.apiTester': 'API Tester',
    'header.newProject': 'Yeni Proje',

    // Left Panel
    'leftPanel.apis': "API'ler",
    'leftPanel.search': 'Ara...',
    'leftPanel.new': 'Yeni',

    // New Dropdown
    'newDropdown.httpEndpoint': 'HTTP Endpoint',
    'newDropdown.quickRequest': 'Hizli Istek',
    'newDropdown.websocket': 'WebSocket',
    'newDropdown.soap': 'SOAP',
    'newDropdown.graphql': 'GraphQL',
    'newDropdown.grpc': 'gRPC',
    'newDropdown.sse': 'SSE',
    'newDropdown.schema': 'Sema',
    'newDropdown.markdown': 'Markdown',
    'newDropdown.folder': 'Klasor',
    'newDropdown.module': 'Modul',
    'newDropdown.import': 'Iceri Aktar',
    'newDropdown.importCurl': 'cURL Iceri Aktar',
    'newDropdown.more': 'Daha fazla...',
    'newDropdown.other': 'Diger',

    // URL Bar
    'urlBar.send': 'Gonder',
    'urlBar.sending': 'Gonderiliyor...',
    'urlBar.save': 'Kaydet',
    'urlBar.import': 'Iceri Aktar',
    'urlBar.enterUrl': 'URL girin...',

    // Request tabs
    'request.params': 'Parametreler',
    'request.auth': 'Kimlik Dogrulama',
    'request.headers': 'Basliklar',
    'request.body': 'Govde',
    'request.preRequest': 'On-istek',
    'request.tests': 'Testler',

    // Response tabs
    'response.response': 'Yanit',
    'response.cookie': 'Cerez',
    'response.console': 'Konsol',
    'response.actualRequest': 'Gercek Istek',

    // Response meta
    'response.ms': 'ms',
    'response.kb': 'KB',
    'response.tests': 'Testler',
    'response.save': 'Kaydet',
    'response.copy': 'Kopyala',
    'response.code': 'Kod',
    'response.sendingRequest': 'Istek gonderiliyor...',
    'response.requestFailed': 'Istek Basarisiz',

    // Body types
    'body.none': 'yok',
    'body.json': 'JSON',
    'body.xml': 'XML',
    'body.formData': 'form-data',
    'body.urlencoded': 'urlencoded',
    'body.binary': 'ikili',

    // Auth types
    'auth.noAuth': 'Kimlik Dogrulama Yok',
    'auth.basicAuth': 'Temel Kimlik Dogrulama',
    'auth.bearerToken': 'Bearer Token',
    'auth.apiKey': 'API Anahtari',
    'auth.oauth2': 'OAuth 2.0',
    'auth.digest': 'Digest',
    'auth.ntlm': 'NTLM',

    // Tests
    'tests.visualAssertions': 'Gorsel Dogrulamalar',
    'tests.addAssertion': 'Dogrulama Ekle',
    'tests.statusCodeEquals': 'Durum kodu esittir',
    'tests.responseTimeLessThan': 'Yanit suresi kucuktur',
    'tests.bodyContains': 'Govde icerir',
    'tests.headerExists': 'Baslik mevcut',
    'tests.headerEquals': 'Baslik esittir',
    'tests.jsonPathEquals': 'JSON yolu esittir',

    // Footer
    'footer.ready': 'Hazir',
    'footer.runner': 'Calistirici',
    'footer.console': 'Konsol',
    'footer.cookies': 'Cerezler',
    'footer.noEnvironment': 'Ortam Yok',

    // Import Modal
    'import.title': 'API Verisini Iceri Aktar',
    'import.subtitle': 'Lutfen ilgili veri kaynagi formatini secin',
    'import.cancel': 'Iptal',
    'import.next': 'Ileri',

    // Settings Modal
    'settings.title': 'Ayarlar',
    'settings.theme': 'Tema',
    'settings.language': 'Dil',
    'settings.fontSize': 'Yazi Boyutu',
    'settings.timeout': 'Istek Zaman Asimi',
    'settings.sslVerification': 'SSL Sertifika Dogrulamasi',
    'settings.proxy': 'Proxy Ayarlari',
    'settings.systemProxy': 'Sistem Proxy',
    'settings.noProxy': 'Proxy Yok',
    'settings.customProxy': 'Ozel Proxy',
    'settings.host': 'Sunucu',
    'settings.port': 'Port',
    'settings.autoUpdate': 'Otomatik Guncelleme',
    'settings.checkForUpdates': 'Guncellemeleri Kontrol Et',
    'settings.cancel': 'Iptal',
    'settings.save': 'Kaydet',
    'settings.light': 'Acik',
    'settings.dark': 'Koyu',
    'settings.system': 'Sistem',
    'settings.turkish': 'Turkce',
    'settings.english': 'Ingilizce',

    // Collection Runner
    'runner.title': 'Koleksiyon Calistiricisi',
    'runner.runCollection': 'Koleksiyonu Calistir',
    'runner.stop': 'Durdur',
    'runner.exportJson': 'JSON Disari Aktar',
    'runner.exportHtml': 'HTML Disari Aktar',

    // Empty states
    'empty.clickSend': 'Yanit almak icin Gonder butonuna tiklayin',
    'empty.noResponse': 'Henuz yanit yok',
    'empty.enterUrl': 'Yaniti burada gormek icin bir URL girin ve Gonder butonuna tiklayin',

    // Icon Sidebar
    'sidebar.apis': "API'ler",
    'sidebar.tests': 'Testler',
    'sidebar.docs': 'Dokumanlar',
    'sidebar.history': 'Gecmis',
    'sidebar.settings': 'Ayarlar',
    'sidebar.invite': 'Davet Et',

    // Footer extras
    'footer.online': 'Cevrimici',
    'footer.requestProxy': 'Istek Proxy',
    'footer.trash': 'Cop Kutusu',
    'footer.help': 'Yardim ve destek',
    'footer.designFirst': 'Tasarim-oncelikli Mod',
    'footer.requestFirst': 'Istek-oncelikli Mod',

    // General
    'general.close': 'Kapat',
    'general.delete': 'Sil',
    'general.edit': 'Duzenle',
    'general.duplicate': 'Cogalt',
    'general.move': 'Tasi',
    'general.add': 'Ekle',
    'general.remove': 'Kaldir',
    'general.enable': 'Etkinlestir',
    'general.disable': 'Devre Disi Birak',

    // Home / Project selection
    'home.subtitle': 'Baslamak icin bir proje secin veya yeni bir proje olusturun',
    'home.projects': 'Projeler',
    'home.newProject': 'Yeni Proje',
    'home.createProject': 'Yeni Proje Olustur',
    'home.projectNamePlaceholder': 'Proje adini girin...',
    'home.create': 'Olustur',
    'home.creating': 'Olusturuluyor...',
    'home.cancel': 'Iptal',
    'home.delete': 'Sil',
    'home.noProjects': 'Henuz proje yok. Baslamak icin bir tane olusturun.',
    'home.tab': 'Ana Sayfa',

    // Project Welcome (empty project)
    'projectWelcome.newHttpEndpoint': 'Yeni HTTP Endpoint',
    'projectWelcome.newSchema': 'Yeni Sema',
    'projectWelcome.newMarkdown': 'Yeni Markdown',
    'projectWelcome.quickRequest': 'Hizli Istek',
    'projectWelcome.more': 'Daha fazla',

    // New Project Modal
    'newProject.title': 'Yeni Proje Olustur',
    'newProject.step.source': 'Proje Kaynagi',
    'newProject.step.details': 'Detaylar & Gorunum',
    'newProject.step.storage': 'Kayit Ayarlari',
    'newProject.source.new': 'Yeni Olustur',
    'newProject.source.newSub': 'Sifirdan basla',
    'newProject.source.git': "Git'ten Klonla",
    'newProject.source.gitSub': 'Mevcut bir repoyu klonla',
    'newProject.source.local': 'Yerel Ac',
    'newProject.source.localSub': 'Yerel bir proje dosyasi ac',
    'newProject.git.repoUrl': 'Repository URL',
    'newProject.git.repoUrlPlaceholder': 'https://github.com/kullanici/repo.git',
    'newProject.git.username': 'Kullanici adi',
    'newProject.git.branch': 'Branch',
    'newProject.git.token': 'Personal Access Token',
    'newProject.git.tokenHint': 'Token sifreli saklanir · Settings → Developer settings → PAT',
    'newProject.git.localDir': 'Yerel Dizin',
    'newProject.git.localDirPlaceholder': 'Repo nereye klonlansin...',
    'newProject.git.cloning': 'Klonlaniyor...',
    'newProject.git.selectProject': 'Iceri aktarilacak proje dosyasini secin',
    'newProject.name': 'Proje Adi *',
    'newProject.namePlaceholder': 'orn: Payment Service API',
    'newProject.nameRequired': 'Proje adi gereklidir',
    'newProject.description': 'Aciklama',
    'newProject.descPlaceholder': 'Proje hakkinda kisa bir aciklama...',
    'newProject.type': 'Proje Tipi',
    'newProject.branchName': 'Ilk Branch Adi',
    'newProject.branchHint': 'Sonradan yeni branchler ekleyebilirsiniz',
    'newProject.icon': 'Ikon',
    'newProject.iconAuto': 'Otomatik',
    'newProject.iconAutoSub': 'Ismin bas harfleri',
    'newProject.iconEmoji': 'Emoji',
    'newProject.iconEmojiSub': 'Bir emoji secin',
    'newProject.emojiPaste': 'ya da buraya yapistir:',
    'newProject.color': 'Renk',
    'newProject.preview': 'Proje gorunumu onizlemesi',
    'newProject.saveMode': 'Kayit Modu',
    'newProject.modeLocal': 'Yerel',
    'newProject.modeLocalSub': 'Sadece bu bilgisayarda',
    'newProject.modeGit': 'Git',
    'newProject.modeGitSub': 'GitHub / GitLab',
    'newProject.modeBoth': 'Her Ikisi',
    'newProject.modeBothSub': 'Yerel + Git yedekli',
    'newProject.localFolder': 'Yerel Kayit Klasoru',
    'newProject.selectFolder': 'Sec...',
    'newProject.folderPlaceholder': 'Klasor secin...',
    'newProject.summary': 'Proje Ozeti',
    'newProject.back': 'Geri',
    'newProject.next': 'Devam',
    'newProject.create': 'Olustur',
    'newProject.creating': 'Olusturuluyor...',
    'newProject.done': 'Proje Olusturuldu!',
    'newProject.doneMsg': 'basariyla olusturuldu',
    'newProject.openProject': 'Projeyi Ac',
    'newProject.localSave': 'Yerel kayit',
    'newProject.gitSave': 'Git:',
    'newProject.noRepo': 'repo belirtilmedi',
    'newProject.bothSave': 'Yerel + Git yedekli kayit',

    // Update Modal
    'update.checking': 'Guncellemeler kontrol ediliyor...',
    'update.available': 'Guncelleme mevcut',
    'update.download': 'Indir',
    'update.downloading': 'Indiriliyor...',
    'update.ready': 'Guncelleme hazir! Uygulamak icin yeniden baslatin',
    'update.restartNow': 'Simdi Yeniden Baslat',
    'update.later': 'Sonra',
    'update.upToDate': 'Guncelsiniz',
    'update.error': 'Guncelleme kontrolu basarisiz',
    'update.retry': 'Tekrar Dene',
    'update.releaseNotes': 'Surum Notlari',
    'update.version': 'Surum',
  },
}

let currentLocale: Locale = 'en'

export function t(key: string): string {
  return translations[currentLocale][key] ?? key
}

export function setLocale(locale: Locale): void {
  currentLocale = locale
}

export function getLocale(): Locale {
  return currentLocale
}

/**
 * Hook that integrates with the UI store for reactive locale changes.
 * Components using this hook will re-render when locale changes.
 */
export function useTranslation(): { t: (key: string) => string; locale: Locale } {
  const locale = useUIStore((s) => s.locale)
  // Keep module-level locale in sync
  if (locale !== currentLocale) {
    currentLocale = locale
  }
  return {
    t: (key: string): string => translations[locale][key] ?? key,
    locale,
  }
}
