/**
 * Host-side shell-theme installer: installs an eDEX variant's packages into
 * the active profile with pnpm and rewrites the profile's `cordis.patch.yml`
 * to mount the variant's rows with VARIANT-SPECIFIC row ids
 * (`<variant>-host-system-metrics`, `<variant>-ui-edex`,
 * `<variant>-ui-theme-terminal`).
 *
 * The profile patch is hot-reloaded by the harness, and a page reload then
 * boots against the new client graph — so "Apply" on a shell theme actually
 * installs and mounts the full UI, not just the color. Switching variants
 * works because each variant owns distinct row ids: the Loader disposes the
 * previous variant's fibers (rows removed) and creates the new one's (rows
 * inserted) — never reusing an id with a different module, which the config
 * hot-reload would not re-fiber.
 *
 * The active profile is discovered by scanning `$DSH_HOME/profiles/*` for the
 * directory whose `node_modules/@danielng23/dsh-client-ui-theme-store`
 * resolves to this package.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as yaml from 'js-yaml'

/** The three base row ids every eDEX variant bundle inserts. */
const VARIANT_BASE_IDS = ['host-system-metrics', 'ui-edex', 'ui-theme-terminal'] as const

/** The three row suffixes every eDEX variant bundle inserts (prefixed form). */
const VARIANT_ROW_SUFFIXES = ['-host-system-metrics', '-ui-edex', '-ui-theme-terminal'] as const

/** The variant id derived from a bundle package name (`@danielng23/dsh-edex-armory-ui` → `armory`). */
export function variantIdOf(bundlePackage: string): string {
  const slug = bundlePackage.slice(bundlePackage.lastIndexOf('/') + 1)
  return slug.replace(/^dsh-edex-/, '').replace(/-ui$/, '')
}

/** Resolve $DSH_HOME (mirrors dsh-home-paths): $DSH_HOME, else ~/.dsh. */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Find the active profile directory: the one whose node_modules contains
 * this package (a `file:` link into the harness profile).
 * @returns the profile directory, or undefined when none matches.
 */
export function resolveActiveProfileDir(): string | undefined {
  const profilesDir = join(dshHome(), 'profiles')
  if (!existsSync(profilesDir)) return undefined
  for (const name of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const dir = join(profilesDir, name.name)
    const marker = join(dir, 'node_modules/@danielng23/dsh-client-ui-theme-store/package.json')
    if (!existsSync(marker)) continue
    // Confirm the linked package is this package (not a stale copy).
    try {
      const manifest = JSON.parse(readFileSync(marker, 'utf8')) as { name?: string }
      if (manifest.name === '@danielng23/dsh-client-ui-theme-store') return dir
    } catch {
      // Unreadable marker — skip.
    }
  }
  return undefined
}

/**
 * The variant's three rows, derived from the bundle's own cordis.patch rows
 * but re-keyed with variant-specific ids. The bundle patch is the
 * authoritative source of the row NAMES, so an install stays correct even
 * when a variant changes its patch; the ids are prefixed so switching
 * variants replaces fibers instead of reusing an id with a new module.
 * @param bundlePackage - the variant bundle package name.
 * @param profileDir - the active profile directory.
 * @returns the {id, name} rows to mount (id prefixed with the variant id).
 */
function variantRowsOf(bundlePackage: string, profileDir: string): { id: string; name: string }[] {
  const bundleDir = join(profileDir, 'node_modules', bundlePackage)
  const patchPath = join(bundleDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return []
  const parsed = yaml.load(readFileSync(patchPath, 'utf8')) as
    | { insert?: { id?: string; name?: string }[] }[]
    | undefined
  if (!Array.isArray(parsed)) return []
  const variantId = variantIdOf(bundlePackage)
  const rows: { id: string; name: string }[] = []
  for (const entry of parsed) {
    for (const row of entry.insert ?? []) {
      if (typeof row.id === 'string' && typeof row.name === 'string') {
        rows.push({ id: `${variantId}-${row.id}`, name: row.name })
      }
    }
  }
  return rows
}

/** Whether a row id is one of this plugin's variant-managed rows. */
function isVariantRow(id: string | undefined): boolean {
  if (typeof id !== 'string') return false
  // Match both prefixed (armory-host-system-metrics) and bare (host-system-metrics) forms.
  return VARIANT_BASE_IDS.includes(id as (typeof VARIANT_BASE_IDS)[number])
    || VARIANT_ROW_SUFFIXES.some(suffix => id.endsWith(suffix))
}

/**
 * Rewrite the profile's cordis.patch.yml so the variant rows point at the
 * given packages. Removes every previous variant's rows (any id ending in the
 * variant suffixes), preserves all other rows (the theme-store row, user
 * rows), and appends the new variant's rows. Returns whether the document
 * actually changed (false when the variant was already mounted verbatim).
 * @param profileDir - the active profile directory.
 * @param rows - the variant rows to mount (variant-prefixed id + package name).
 * @returns true when the patch file changed.
 */
export function writeVariantPatch(profileDir: string, rows: { id: string; name: string }[]): boolean {
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const existing = existsSync(patchPath)
    ? yaml.load(readFileSync(patchPath, 'utf8')) as { insert?: { id?: string; name?: string }[] }[]
    : []
  const kept: { insert?: { id?: string; name?: string }[] }[] = []
  for (const entry of Array.isArray(existing) ? existing : []) {
    const inserts = (entry.insert ?? []).filter(row => !isVariantRow(row.id))
    if (inserts.length > 0) kept.push({ ...entry, insert: inserts })
  }
  const next: unknown[] = [...kept, { insert: rows }]
  const content = yaml.dump(next, { noRefs: true, lineWidth: 120 })
  // No-op when the document is already exactly this variant's patch.
  if (existsSync(patchPath) && readFileSync(patchPath, 'utf8') === content) return false
  writeFileSync(patchPath, content)
  return true
}

/** Result of a shell-theme install. */
export interface InstallResult {
  ok: boolean
  /** Whether the profile patch actually changed (false when the variant was already mounted). */
  changed: boolean
  error?: string
}

/**
 * Install a shell theme's variant into the active profile: pnpm-add the
 * bundle's three packages, then point the profile patch's variant rows at
 * them. Returns the install outcome; the browser reloads on success.
 * @param bundlePackage - the variant bundle package (e.g. `@danielng23/dsh-edex-armory-ui`).
 * @returns the install result.
 */
export function installShellTheme(bundlePackage: string): InstallResult {
  const profileDir = resolveActiveProfileDir()
  if (profileDir === undefined) {
    return { ok: false, changed: false, error: 'theme-store: no active dsh profile found (scan $DSH_HOME/profiles)' }
  }
  console.log(`[theme-store] installShellTheme(${bundlePackage}) profileDir=${profileDir}`)
  // If the bundle is already resolvable from the profile, skip the pnpm spawn
  // (the browser then only needs the patch rewrite). This also keeps the
  // route working when pnpm is unavailable to the GUI process.
  const alreadyInstalled = existsSync(join(profileDir, 'node_modules', bundlePackage, 'package.json'))
  console.log(`[theme-store] bundle already installed: ${String(alreadyInstalled)}`)
  if (!alreadyInstalled) {
    const result = spawnSync('pnpm', ['add', bundlePackage], {
      cwd: profileDir,
      encoding: 'utf8',
      timeout: 120_000,
    })
    console.log(`[theme-store] pnpm add exit=${String(result.status)} error=${result.error?.message ?? 'none'}`)
    if (result.error !== undefined) {
      return { ok: false, changed: false, error: `theme-store: pnpm failed: ${result.error.message}` }
    }
    if (result.status !== 0) {
      return { ok: false, changed: false, error: `theme-store: pnpm add ${bundlePackage} exited ${String(result.status)}` }
    }
  }
  const rows = variantRowsOf(bundlePackage, profileDir)
  console.log(`[theme-store] rows read: ${rows.length} (${rows.map(r => r.id).join(', ')})`)
  if (rows.length === 0) {
    return { ok: false, changed: false, error: `theme-store: ${bundlePackage} ships no cordis.patch.yml rows to mount` }
  }
  const changed = writeVariantPatch(profileDir, rows)
  console.log(`[theme-store] patch written, changed=${String(changed)}`)
  return { ok: true, changed }
}

/** Exposed for tests. */
export const internals = {
  dshHome,
  resolveActiveProfileDir,
  variantRowsOf,
  writeVariantPatch,
  variantIdOf,
}
