/** Copy dictionaries for the theme store Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '主题商店',
  title: '主题商店',
  subtitle: '安装配色主题与完整界面主题',
  loading: '正在读取主题目录…',
  error: '暂时无法读取主题目录。',
  retry: '重试',
  empty: '目录中还没有主题。',
  author: '作者',
  light: '浅色',
  dark: '深色',
  apply: '应用',
  applied: '已应用',
  install: '安装',
  installing: '正在安装…',
  restarting: '正在重启以应用…',
  reloading: '正在重新加载…',
  installFailed: '安装失败',
  installHint: '在终端运行以下命令安装完整界面：',
  copyCommand: '复制命令',
  copied: '已复制',
  colorTheme: '配色主题',
  shellTheme: '界面主题',
  shellInstallNote: '完整界面需要 pnpm 安装',
  installedBanner: '已安装并重启「{name}」——新的界面外壳已挂载。',
  dismiss: '关闭',
} satisfies Record<string, string>

/** Theme store locale key union. */
export type ThemeStoreLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Theme Store',
  title: 'Theme Store',
  subtitle: 'Install color themes and full UI shells',
  loading: 'Reading the theme catalog…',
  error: 'The theme catalog is temporarily unavailable.',
  retry: 'Retry',
  empty: 'No themes in the catalog yet.',
  author: 'Author',
  light: 'Light',
  dark: 'Dark',
  apply: 'Apply',
  applied: 'Applied',
  install: 'Install',
  installing: 'Installing…',
  restarting: 'Restarting to apply…',
  reloading: 'Reloading…',
  installFailed: 'Install failed',
  installHint: 'Run this command in your terminal to install the full UI:',
  copyCommand: 'Copy command',
  copied: 'Copied',
  colorTheme: 'Color theme',
  shellTheme: 'UI shell',
  shellInstallNote: 'Full UI requires pnpm install',
  installedBanner: 'Installed and restarted “{name}” — the new UI shell is live.',
  dismiss: 'Dismiss',
} satisfies Record<ThemeStoreLocaleKey, string>
