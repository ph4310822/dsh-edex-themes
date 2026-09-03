/**
 * Theme store catalog: types, runtime validation, and remote loading.
 *
 * The catalog is a plain JSON document hosted in this repository (pushed to
 * GitHub) and fetched at runtime by the browser half. It is deliberately
 * category-free: one flat `themes` array whose entries carry the display
 * metadata the store renders — `name`, `author`, `screenshot` — plus the
 * functional fields needed to apply a theme through the harness theme
 * service (`id`, `colorScheme`, `tokens`).
 */

import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'

/**
 * Default catalog URL: the live catalog in this repository, fetched from
 * GitHub raw so themes update by pushing to the repo — no plugin release
 * required. Overridable at build time via DSH_CLIENT_THEME_STORE_CATALOG_URL.
 */
export const DEFAULT_CATALOG_URL =
  'https://raw.githubusercontent.com/ph4310822/dsh-edex-themes/main/catalog/edex-themes.json'

/**
 * Bundled fallback: the catalog shipped with the plugin, served by the node
 * half at the same-origin webserver route. Used when the live GitHub fetch
 * fails (offline / GitHub unreachable), so the store still shows the shipped
 * themes rather than an empty error state.
 */
export const LOCAL_CATALOG_URL = '/catalog/edex-themes.json'

/** Resolve the effective catalog URL (build-time override, else default). */
export function catalogUrl(): string {
  const override = typeof process !== 'undefined' ? process.env.DSH_CLIENT_THEME_STORE_CATALOG_URL : undefined
  return override !== undefined && override !== '' ? override : DEFAULT_CATALOG_URL
}

/**
 * What a theme changes when applied.
 * - `color`: a pure token override layer — applying it recolors the base UI
 *   in-process (the theme store's `register` + `setTheme` path).
 * - `shell`: a full UI shell (eDEX variants) — the color tokens are only the
 *   palette preview; the actual shell must be installed into a profile with
 *   pnpm (`dsh plugin --profile <name> add <bundle>`).
 */
export type CatalogThemeKind = 'color' | 'shell'

/**
 * One catalog theme: display metadata plus the functional {@link ThemeDefinition}.
 * The user-visible card renders `name`, `author`, and `screenshot`; applying
 * the theme hands `id`/`colorScheme`/`tokens` to the theme service.
 */
export interface CatalogTheme extends ThemeDefinition {
  /** Display name (product copy). */
  name: string
  /** Author attribution. */
  author: string
  /**
   * Preview image: an absolute URL, or a path relative to the catalog
   * document's directory (resolved against the catalog URL).
   */
  screenshot: string
  /** What the theme changes; defaults to `color` for backward compatibility. */
  type?: CatalogThemeKind
  /** npm bundle package to install for a `shell` theme (e.g. `@danielng23/dsh-edex-armory-ui`). */
  installPackage?: string
  /** The shell plugin's client package name, used to detect an installed shell (e.g. `@danielng23/dsh-armory-client-ui-edex`). */
  shellPluginId?: string
  /** Copyable `dsh plugin` command that installs this shell theme into a profile. */
  installHint?: string
}

/** Parsed catalog document (flat, category-free). */
export interface ThemeCatalog {
  /** Catalog themes in display order. */
  themes: readonly CatalogTheme[]
}

/**
 * Resolve a screenshot reference against the catalog document URL.
 * @param screenshot - absolute URL or catalog-relative path.
 * @param catalogHref - the catalog document's absolute URL (or an origin-relative path).
 * @returns an absolute, fetchable image URL.
 */
export function resolveScreenshot(screenshot: string, catalogHref: string): string {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(screenshot)) return screenshot
  const dir = catalogHref.slice(0, catalogHref.lastIndexOf('/') + 1)
  const absoluteBase = catalogHref.includes('://')
    ? dir
    : `${typeof location !== 'undefined' ? location.origin : ''}${dir.startsWith('/') ? '' : '/'}${dir}`
  return new URL(screenshot, absoluteBase).href
}

/** Error thrown when the fetched catalog is not a valid theme catalog. */
export class CatalogParseError extends Error {
  override readonly name = 'CatalogParseError'
}

/**
 * Runtime-validate an unknown parsed JSON value as a {@link ThemeCatalog}.
 * Rejects malformed shapes with a teaching error; returns defensive copies so
 * later caller mutation cannot reach the stored catalog.
 * @param value - the parsed JSON document.
 * @returns the validated catalog.
 */
export function parseCatalog(value: unknown): ThemeCatalog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogParseError('theme catalog must be an object with a "themes" array')
  }
  const raw = value as { themes?: unknown }
  if (!Array.isArray(raw.themes)) {
    throw new CatalogParseError('theme catalog is missing a "themes" array')
  }
  const themes: CatalogTheme[] = []
  const seen = new Set<string>()
  for (const entry of raw.themes) {
    if (typeof entry !== 'object' || entry === null) {
      throw new CatalogParseError('each catalog theme must be an object')
    }
    const theme = entry as Record<string, unknown>
    const id = theme.id
    if (typeof id !== 'string' || id.length === 0) {
      throw new CatalogParseError('each catalog theme needs a non-empty string "id"')
    }
    if (seen.has(id)) throw new CatalogParseError(`duplicate catalog theme id "${id}"`)
    seen.add(id)
    for (const field of ['name', 'author', 'screenshot'] as const) {
      if (typeof theme[field] !== 'string' || theme[field].length === 0) {
        throw new CatalogParseError(`catalog theme "${id}" needs a non-empty string "${field}"`)
      }
    }
    const colorScheme = theme.colorScheme
    if (colorScheme !== 'light' && colorScheme !== 'dark') {
      throw new CatalogParseError(`catalog theme "${id}" needs colorScheme "light" or "dark"`)
    }
    const tokens = theme.tokens
    if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
      throw new CatalogParseError(`catalog theme "${id}" needs a "tokens" object of CSS variable overrides`)
    }
    const tokenRecord: Record<string, string> = {}
    for (const [name, value] of Object.entries(tokens as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new CatalogParseError(`catalog theme "${id}" token "${name}" must be a string`)
      }
      tokenRecord[name] = value
    }
    const shellFields: Partial<CatalogTheme> = {}
    if (typeof theme.type === 'string') shellFields.type = theme.type as CatalogThemeKind
    if (typeof theme.installPackage === 'string') shellFields.installPackage = theme.installPackage
    if (typeof theme.shellPluginId === 'string') shellFields.shellPluginId = theme.shellPluginId
    if (typeof theme.installHint === 'string') shellFields.installHint = theme.installHint
    themes.push({
      id,
      colorScheme,
      tokens: tokenRecord,
      name: theme.name as string,
      author: theme.author as string,
      screenshot: theme.screenshot as string,
      ...shellFields,
    })
  }
  return { themes }
}

/**
 * Fetch and parse the theme catalog from a URL.
 * @param href - catalog document URL (defaults to {@link catalogUrl}).
 * @returns the validated catalog.
 */
export async function fetchCatalog(href = catalogUrl()): Promise<ThemeCatalog> {
  let response: Response
  try {
    response = await fetch(href, { headers: { Accept: 'application/json' } })
  } catch (error) {
    throw new Error(`theme catalog unreachable at ${href}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new Error(`theme catalog request failed at ${href}: HTTP ${response.status}`)
  }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch (error) {
    throw new CatalogParseError(`theme catalog at ${href} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseCatalog(parsed)
}
