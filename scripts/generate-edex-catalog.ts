/**
 * Generate `catalog/edex-themes.json` from the eDEX-UI variant packages in
 * `../dsh-edex/`. Run with the harness's tsx:
 *
 *   /Users/daniel/workspace/deepseek-harness/node_modules/.bin/tsx scripts/generate-edex-catalog.ts
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const EDEX_ROOT = resolve(__dirname, '../../dsh-edex')
const OUT_PATH = resolve(__dirname, '../catalog/edex-themes.json')
const OWNER = 'ph4310822'
const SCREENSHOTS = ['review-shot.png', 'screenshot.png', 'probe-shot.png']

function displayName(slug: string): string {
  const word = slug.replace(/^dsh-edex-/, '').replace(/-ui$/, '')
  return word.charAt(0).toUpperCase() + word.slice(1)
}

async function main(): Promise<void> {
  const entries: { id: string; name: string; author: string; screenshot: string; colorScheme: 'dark'; type: 'shell'; installPackage: string; shellPluginId: string; installHint: string; tokens: Record<string, string> }[] = []
  let failures = 0
  const packages = readdirSync(EDEX_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^dsh-edex-.+-ui$/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const { name: slug } of packages) {
    const settingsPath = join(EDEX_ROOT, slug, 'packages/ui-edex/src/settings.ts')
    let mod: { DEFAULT_THEME_COLOR?: string; paletteFor?(c: string): { primary: string }; tokenOverridesFor?(p: { primary: string }): Record<string, { light: string; dark: string }> }
    try {
      mod = await import(settingsPath)
    } catch (e) {
      console.warn(`skip ${slug}: ${e instanceof Error ? e.message : String(e)}`)
      failures++
      continue
    }
    const paletteFor = mod.paletteFor
    const tokenOverridesFor = mod.tokenOverridesFor
    if (!paletteFor || !tokenOverridesFor) {
      console.warn(`skip ${slug}: settings.ts missing paletteFor/tokenOverridesFor`)
      failures++
      continue
    }
    const accent = mod.DEFAULT_THEME_COLOR ?? '#4fbcc7'
    const palette = paletteFor(accent)
    const raw = tokenOverridesFor(palette)
    const tokens: Record<string, string> = {}
    for (const [name, pair] of Object.entries(raw)) tokens[name] = pair.light
    const screenshotFile = SCREENSHOTS.find(candidate => {
      try { return statSync(join(EDEX_ROOT, slug, candidate)).isFile() } catch { return false }
    })
    const screenshot = screenshotFile ? `https://raw.githubusercontent.com/${OWNER}/${slug}/main/${screenshotFile}` : ''
    // Shell install metadata: the bundle package (dsh plugin target), the
    // client UI package (inventory detection), and a copyable install command.
    const installPackage = readPackageName(join(EDEX_ROOT, slug, 'packages/bundle/package.json')) ?? `@danielng23/dsh-edex-${variantOf(slug)}-ui`
    const shellPluginId = readPackageName(join(EDEX_ROOT, slug, 'packages/ui-edex/package.json')) ?? `@danielng23/dsh-${variantOf(slug)}-client-ui-edex`
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
    console.log(`+ ${slug} (${Object.keys(tokens).length} tokens, ${installPackage})`)
  }

  mkdirSync(join(OUT_PATH, '..'), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify({ themes: entries }, undefined, 2) + '\n')
  console.log(`\nwrote ${entries.length} themes to ${relative(resolve(__dirname, '..'), OUT_PATH)} (${failures} skipped)`)
}

/** The variant id from a repo slug (`dsh-edex-armory-ui` → `armory`). */
function variantOf(slug: string): string {
  return slug.replace(/^dsh-edex-/, '').replace(/-ui$/, '')
}

/** Read a package.json's `name`, or undefined when absent/unreadable. */
function readPackageName(path: string): string | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')).name as string
  } catch {
    return undefined
  }
}

void main().catch(e => { console.error(e); process.exitCode = 1 })