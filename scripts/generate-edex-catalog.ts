/**
 * Generate `catalog/edex-themes.json` from the eDEX-UI variant packages in
 * `../dsh-edex/`. Run with the harness's tsx (or any node ESM runtime):
 *
 *   /Users/daniel/workspace/deepseek-harness/node_modules/.bin/tsx scripts/generate-edex-catalog.ts
 *   # or, if tsx IPC is blocked:
 *   node --experimental-strip-types scripts/generate-edex-catalog.ts
 *
 * Reads the variant's `packages/ui-edex/lib/client.js` (where the tsdown
 * build inlines the full `tokenOverridesFor()` function body, the
 * `FIXED_ACCENTS` literal, and the `DEFAULT_THEME_COLOR` constant) instead
 * of importing `packages/ui-edex/src/settings.ts`. This decouples the
 * catalog from the local build environment (no need for a working
 * schemastery symlink in each variant's node_modules) — any variant whose
 * `lib/client.js` exists is catalogable, regardless of its develop-time
 * build state.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const EDEX_ROOT = resolve(__dirname, '../../dsh-edex')
const OUT_PATH = resolve(__dirname, '../catalog/edex-themes.json')
const OWNER = 'ph4310822'
const SCREENSHOTS = ['review-shot.png', 'screenshot.png', 'probe-fullscreen-final.png', 'probe-shot.png']

function variantOf(slug: string): string {
  if (slug === 'dsh-edex-ui') return 'edex'
  return slug.replace(/^dsh-edex-/, '').replace(/-ui$/, '')
}

function displayName(slug: string): string {
  if (slug === 'dsh-edex-ui') return 'eDEX'
  const word = slug.replace(/^dsh-edex-/, '').replace(/-ui$/, '')
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function readPackageName(path: string): string | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).name as string
  } catch {
    return undefined
  }
}

// ---- palette / tone math (replicated from each variant's settings.ts) ----

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const s = hex.replace(/^#/, '').toLowerCase()
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/**
 * Replicates the variant's `tone(color, lightness, saturationScale)` HSL
 * transform. The variant settings.ts uses this to derive `dim` (45, 0.67)
 * and `border` (22, 0.72) from the accent color. The output hex MUST match
 * the variant's own `paletteFor()` so the catalog preview is faithful.
 */
function tone(hex: string, lightness: number, saturationScale: number): string {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  s *= saturationScale
  const target = clamp(lightness) / 100
  function hue2rgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r2: number, g2: number, b2: number
  if (s === 0) {
    r2 = g2 = b2 = target
  } else {
    const q = target < 0.5 ? target * (1 + s) : target + s - target * s
    const p = 2 * target - q
    const hk = h / 360
    r2 = hue2rgb(p, q, hk + 1 / 3)
    g2 = hue2rgb(p, q, hk)
    b2 = hue2rgb(p, q, hk - 1 / 3)
  }
  const toHex = (n: number) => {
    const v = Math.round(Math.max(0, Math.min(1, n)) * 255)
    return v.toString(16).padStart(2, '0')
  }
  return '#' + toHex(r2) + toHex(g2) + toHex(b2)
}

function paletteFor(accent: string): { primary: string; dim: string; border: string } {
  return {
    primary: accent.toLowerCase(),
    dim: tone(accent, 45, 0.67),
    border: tone(accent, 22, 0.72),
  }
}

// ---- bundle extraction ----

/** Pull the `DEFAULT_THEME_COLOR` string literal from the tsdown-emitted bundle. */
function extractDefaultThemeColor(src: string): string | undefined {
  const m = src.match(/DEFAULT_THEME_COLOR\s*=\s*"(#[0-9a-fA-F]{3,6})"/)
  return m ? m[1].toLowerCase() : undefined
}

/**
 * Pull the per-variant `FIXED_ACCENTS = Object.freeze({ amber, red, cyan })`
 * literal from the bundle. The values are string literals preserved verbatim
 * by tsdown (rolldown), so a regex match on the source is enough.
 */
function extractFixedAccents(src: string): { amber?: string; red?: string; cyan?: string } {
  const m = src.match(
    /FIXED_ACCENTS\s*=\s*Object\.freeze\(\{\s*amber:\s*"([^"]+)"\s*,\s*red:\s*"([^"]+)"\s*,\s*cyan:\s*"([^"]+)"\s*\}\)/,
  )
  if (!m) return {}
  return { amber: m[1].toLowerCase(), red: m[2].toLowerCase(), cyan: m[3].toLowerCase() }
}

/**
 * Extract the entire `function tokenOverridesFor(palette) { ... }` body
 * from the bundle. Returns the source between the function's opening
 * brace and its matching closing brace, or undefined if not found.
 */
function extractTokenOverridesFor(src: string): string | undefined {
  const start = src.indexOf('function tokenOverridesFor(')
  if (start < 0) return undefined
  // Find the function's opening brace (skip the parameter list)
  let i = src.indexOf('{', start)
  if (i < 0) return undefined
  let depth = 0
  const startBody = i
  while (i < src.length) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        return src.slice(startBody, i + 1)
      }
    }
    i++
  }
  return undefined
}

/**
 * Resolve one `both(<value>)` expression in the `return { ... }` block to
 * a concrete hex string. Handles:
 *   - Direct hex literal: `"#09cc50"` → `#09cc50`
 *   - palette.primary / palette.dim / palette.border → computed from accent
 *   - FIXED_ACCENTS.{amber,red,cyan} → from fixedAccents map
 *   - A local const name (`surface`, `panel`, …) → from locals map
 * Returns undefined if the value can't be resolved.
 */
function resolveValue(
  expr: string,
  palette: { primary: string; dim: string; border: string },
  fixedAccents: { amber?: string; red?: string; cyan?: string },
  locals: Record<string, string>,
): string | undefined {
  const trimmed = expr.trim()
  // Direct hex literal: "#xxxxxx"
  if (/^"#[0-9a-fA-F]{3,6}"$/.test(trimmed)) {
    return trimmed.slice(1, -1).toLowerCase()
  }
  // palette.<field>
  const paletteMatch = trimmed.match(/^palette\.(primary|dim|border)$/)
  if (paletteMatch) {
    return palette[paletteMatch[1] as 'primary' | 'dim' | 'border']
  }
  // FIXED_ACCENTS.<field>
  const fixedMatch = trimmed.match(/^FIXED_ACCENTS\.(amber|red|cyan)$/)
  if (fixedMatch) {
    const key = fixedMatch[1] as 'amber' | 'red' | 'cyan'
    return fixedAccents[key]?.toLowerCase()
  }
  // Local const
  if (locals[trimmed] !== undefined) {
    return locals[trimmed].toLowerCase()
  }
  return undefined
}

interface ResolvedTokens {
  '--dsw-alias-bg-base': string
  '--dsw-alias-bg-layer-1': string
  '--dsw-alias-bg-layer-2': string
  '--dsw-alias-bg-overlay': string
  '--dsw-alias-border-l1': string
  '--dsw-alias-border-l2': string
  '--dsw-alias-border-l3': string
  '--dsw-alias-brand-primary': string
  '--dsw-alias-button-info-fill': string
  '--dsw-alias-button-info-hover': string
  '--dsw-alias-label-caption': string
  '--dsw-alias-label-primary': string
  '--dsw-alias-label-primary-bluish': string
  '--dsw-alias-label-primary-dimmed': string
  '--dsw-alias-label-secondary': string
  '--dsw-alias-label-tertiary': string
  '--dsw-alias-state-business-primary': string
  '--dsw-alias-state-error-primary': string
  '--dsw-alias-state-success-primary': string
  '--dsw-alias-state-warn-primary': string
  '--dsw-specific-input-major': string
  '--dsw-specific-sidebar-fill': string
}

/**
 * Parse the body of `tokenOverridesFor()` and resolve all `both(<value>)`
 * expressions to concrete hex strings. Returns the 22 token map or undefined
 * if the body can't be parsed or any token fails to resolve.
 */
function resolveTokens(
  body: string,
  palette: { primary: string; dim: string; border: string },
  fixedAccents: { amber?: string; red?: string; cyan?: string },
): ResolvedTokens | undefined {
  // Step 1: extract `const <name> = "<hex>";` declarations at the top of
  // the function body. These are local helper variables used in the
  // `return { ... }` block below.
  const locals: Record<string, string> = {}
  for (const m of body.matchAll(/const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"(#[0-9a-fA-F]{3,6})"\s*;/g)) {
    locals[m[1]] = m[2].toLowerCase()
  }

  // Step 2: extract each `return { "<key>": both(<value>), ... }` entry.
  // We support both quote styles: "key" (TS source) and after rolldown
  // minification it may stay as `"key"`. The bundle preserves double-quoted
  // keys (verified across all 22 variants).
  const entries: [string, string][] = []
  const returnBlock = body.match(/return\s*\{([\s\S]*?)\}\s*;?\s*\}?/)?.[1]
  if (!returnBlock) return undefined
  for (const m of returnBlock.matchAll(/["'](--[a-z0-9-]+)["']\s*:\s*both\(\s*([^)]+?)\s*\)/g)) {
    entries.push([m[1], m[2]])
  }
  if (entries.length !== 22) {
    console.warn(`  warning: expected 22 token entries in tokenOverridesFor, found ${entries.length}`)
  }

  // Step 3: resolve each value.
  const result: Record<string, string> = {}
  for (const [key, valueExpr] of entries) {
    const resolved = resolveValue(valueExpr, palette, fixedAccents, locals)
    if (resolved === undefined) {
      console.warn(`  warning: could not resolve ${key} = ${valueExpr}`)
      return undefined
    }
    result[key] = resolved
  }

  return result as unknown as ResolvedTokens
}

// ---- main ----

interface CatalogEntry {
  id: string
  name: string
  author: string
  screenshot: string
  colorScheme: 'dark'
  type: 'shell'
  installPackage: string
  shellPluginId: string
  installHint: string
  tokens: Record<string, string>
}

async function main(): Promise<void> {
  const entries: CatalogEntry[] = []
  let failures = 0

  const packages = readdirSync(EDEX_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^dsh-edex(?:-.+)?-ui$/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const { name: slug } of packages) {
    const variantRoot = join(EDEX_ROOT, slug)
    const libPath = join(variantRoot, 'packages/ui-edex/lib/client.js')

    // Gate: the variant must have a built bundle. A published plugin MUST
    // have one (the loop mandates `pnpm bundle` before publish).
    let src: string
    try {
      src = readFileSync(libPath, 'utf8')
    } catch (e) {
      console.warn(`skip ${slug}: no built bundle at ${libPath} (${e instanceof Error ? e.message : e})`)
      failures++
      continue
    }

    const primary = extractDefaultThemeColor(src)
    if (!primary) {
      console.warn(`skip ${slug}: could not find DEFAULT_THEME_COLOR in client.js`)
      failures++
      continue
    }
    const fixed = extractFixedAccents(src)
    if (!fixed.amber || !fixed.red || !fixed.cyan) {
      console.warn(`skip ${slug}: could not find FIXED_ACCENTS in client.js`)
      failures++
      continue
    }
    const body = extractTokenOverridesFor(src)
    if (!body) {
      console.warn(`skip ${slug}: could not find tokenOverridesFor() in client.js`)
      failures++
      continue
    }

    const palette = paletteFor(primary)
    const tokens = resolveTokens(body, palette, fixed)
    if (!tokens) {
      console.warn(`skip ${slug}: failed to resolve all 22 token entries from tokenOverridesFor()`)
      failures++
      continue
    }

    const screenshotFile = SCREENSHOTS.find(candidate => {
      try { return statSync(join(variantRoot, candidate)).isFile() } catch { return false }
    })
    const screenshot = screenshotFile ? `https://raw.githubusercontent.com/${OWNER}/${slug}/main/${screenshotFile}` : ''

    const installPackage = readPackageName(join(variantRoot, 'packages/bundle/package.json')) ?? `@danielng23/dsh-edex-${variantOf(slug)}-ui`
    const shellPluginId = readPackageName(join(variantRoot, 'packages/ui-edex/package.json')) ?? `@danielng23/dsh-${variantOf(slug)}-client-ui-edex`

    entries.push({
      id: variantOf(slug),
      name: displayName(slug),
      author: '@danielng23',
      screenshot,
      colorScheme: 'dark',
      type: 'shell',
      installPackage,
      shellPluginId,
      installHint: `dsh plugin --profile <name> add ${installPackage}`,
      tokens,
    })
    console.log(`+ ${slug} (${Object.keys(tokens).length} tokens, accent=${primary}, dim=${palette.dim}, border=${palette.border}, ${installPackage})`)
  }

  mkdirSync(join(OUT_PATH, '..'), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify({ themes: entries }, undefined, 2) + '\n')
  console.log(`\nwrote ${entries.length} themes to ${relative(resolve(__dirname, '..'), OUT_PATH)} (${failures} skipped)`)
}

void main().catch(e => { console.error(e); process.exitCode = 1 })
