/**
 * Self-contained tsdown config for the standalone theme store plugin.
 *
 * The harness builds in-repo client plugins with its unpublished `clientBundle`
 * preset (packages/client/tsdown.client.ts). This package lives OUTSIDE that
 * repo, so it reproduces the same two artifacts with plain tsdown:
 *
 * 1. The Node half: `lib/index.js` + `lib/invariant.js` (esm, node platform).
 * 2. The browser client bundle: `lib/client.js` in the closure-factory format
 *    the harness client module system loads — the bundle calls
 *    `window.__ModuleLoader__.load({ id, factory })` and resolves module-table
 *    externals through the injected `require`. CSS is compiled by lightningcss:
 *    `x.module.css` yields its hashed class map and injects a tagged style at
 *    factory execution, while `x.css?inline` exports compiled text for a
 *    plugin-owned lifecycle effect.
 *
 * Externals mirror the harness client baseline (packages/client/web
 * src/platform.ts): the shell-seeded React/Cordis/slot modules plus the
 * preloaded runtime/client row, and any specifier the package requests through
 * `dsh.client.external`. Every other bare import (clsx, etc.) is bundled.
 */
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, isAbsolute, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** Shell-seeded module-table specifiers (harness PLATFORM_MODULES). */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** Client-bundle specifiers the harness parser preloads (PRELOADED_CLIENT_EXTERNALS). */
const PRELOADED_CLIENT_EXTERNALS = [
  '@deepseek-ai/dsh-client-runtime/client',
] as const

const ID = '@deepseek-ai/dsh-client-ui-theme-store'

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** Whether a specifier names a package rather than a file next to its importer. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('\0') && !isAbsolute(specifier)
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(`${sep}lib${sep}types${sep}`)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + `${sep}lib${sep}types${sep}`.length))
}

/** Locate a stylesheet import against the package sources and name its emitted position. */
function stylesheetAsset(source: string, importer: string): { readonly file: string, readonly fileName: string } {
  const file = sourceAssetPath(source, importer)
  const boundary = file.lastIndexOf(`${sep}src${sep}`)
  if (boundary < 0) throw new Error(`tsdown: stylesheet ${file} is outside the package sources`)
  return { file, fileName: file.slice(boundary + `${sep}src${sep}`.length).split(sep).join('/') }
}

/** Specifiers this package requests from the module table via dsh.client.external. */
function requestedExternals(): ReadonlySet<string> {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    dsh?: { client?: { external?: unknown } }
  }
  const external = manifest.dsh?.client?.external
  if (external === undefined) return new Set()
  if (!Array.isArray(external) || external.some(value => typeof value !== 'string')) {
    throw new Error('tsdown: dsh.client.external must be a string array')
  }
  return new Set(external)
}

/** Full external set for the browser bundle: baseline plus package requests. */
function clientExternals(): ReadonlySet<string> {
  return new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS, ...requestedExternals()])
}

/** Browser/Node bundle-visible environment defines (mirrors harness client-build-environment). */
function buildDefines(): Record<string, string> {
  const defines: Record<string, string> = {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  }
  // Build-time catalog URL override (harness DSH_CLIENT_* convention). Only
  // define the key when set so the bundler never embeds an undefined value.
  const catalog = process.env.DSH_CLIENT_THEME_STORE_CATALOG_URL
  if (catalog !== undefined && catalog !== '') {
    defines['process.env.DSH_CLIENT_THEME_STORE_CATALOG_URL'] = JSON.stringify(catalog)
  }
  return defines
}

/** Node-half config: esm, node platform, externals = production deps. */
function nodeLibConfig(id: string, entry: readonly string[]): UserConfig {
  const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  const patterns = [...names].sort().map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`))
  return {
    name: id,
    entry: [...entry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: (specifier: string) => patterns.some(pattern => pattern.test(specifier)),
      alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !patterns.some(pattern => pattern.test(specifier)),
    },
  }
}

/** Browser client bundle: CJS closure-factory artifact served by the harness modules registry. */
function clientConfig(id: string, entry: string): UserConfig {
  const isRequested = (specifier: string): boolean => clientExternals().has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      alwaysBundle: (specifier: string) => !isRequested(specifier),
    },
    define: buildDefines(),
    plugins: [{
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null
        // Vendored framework libraries (mirrors the harness preset): ordinary
        // libraries a browser bundle inlines; they carry no cross-plugin
        // runtime identity to share.
        if (/^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not in the default client externals or ${id}'s dsh.client.external, `
          + 'an inline-safe wire layer, or a generated /remote contribution — cross-plugin value imports are forbidden',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([left], [right]) =>
          (left < right ? -1 : left > right ? 1 : 0))) {
          classMap[local] = exp.name
        }
        return styleInjectionModule(id, fileId, code.toString(), classMap)
      },
    }, {
      name: 'dsh-css-text-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
        const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
        const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
        return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return `export default ${JSON.stringify(code.toString())};`
      },
    }, {
      name: 'dsh-css-global-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return styleInjectionModule(id, fileId, code.toString())
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [
  nodeLibConfig(ID, ['lib/types/index.js', 'lib/types/invariant.js']),
  clientConfig(ID, 'lib/types/client/index.js'),
]
