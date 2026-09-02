/**
 * Host registration for the theme store settings namespace (persists the
 * applied third-party theme id across reloads), serves the eDEX theme catalog
 * JSON locally, and provides a POST route to install shell themes (pnpm add
 * + profile patch rewrite) — so "Apply" on a shell theme actually installs
 * and mounts the full UI.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  THEME_STORE_NAMESPACE, ThemeStoreSettingsSchema,
} from './theme-store-settings.ts'
import { installShellTheme } from './host/installer.ts'

export {
  THEME_STORE_APPLIED_FIELD, THEME_STORE_NAMESPACE, ThemeStoreSettingsSchema,
  type ThemeStoreSettings,
} from './theme-store-settings.ts'

/** Path of the catalog JSON relative to this file (src/index.ts → ../catalog, lib/index.js → ../catalog). */
const CATALOG_PATH = new URL('../catalog/edex-themes.json', import.meta.url)

/** Durable event log so install/restart events survive the respawned child (its stdout is /dev/null). */
const EVENT_LOG = join(homedir(), '.dsh', 'theme-store-events.log')

/** Append one timestamped line to the durable event log; never throws. */
function logEvent(message: string): void {
  console.log('[theme-store] ' + message)
  try {
    appendFileSync(EVENT_LOG, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // Log file unwritable — console line above is the best effort.
  }
}

/**
 * Register the durable theme-store section, serve the catalog, and mount the
 * shell-theme installer route.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(THEME_STORE_NAMESPACE),
      ThemeStoreSettingsSchema,
    )
  })

  ctx.inject(['webServer'], (webCtx) => {
    // GET /catalog/edex-themes.json — local theme catalog
    const catalogDispose = webCtx.webServer.register({
      kind: 'exact',
      path: '/catalog/edex-themes.json',
      async handler(_req, res) {
        try {
          const json = await readFile(CATALOG_PATH, 'utf8')
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
          res.end(json)
        } catch {
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('catalog not found')
        }
      },
    })
    webCtx.effect(() => catalogDispose, 'theme-store: catalog route')

    // POST /api/theme-store/install — install a shell theme into the profile
    const installDispose = webCtx.webServer.register({
      kind: 'exact',
      path: '/api/theme-store/install',
      async handler(req, res) {
        let body = ''
        try {
          for await (const chunk of req) body += chunk
          const { installPackage } = JSON.parse(body) as { installPackage?: string }
          logEvent('install request: ' + JSON.stringify({ installPackage, pid: process.pid }))
          if (typeof installPackage !== 'string' || installPackage.length === 0) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'missing installPackage' }))
            return
          }
          const result = installShellTheme(installPackage)
          logEvent('install result: ' + JSON.stringify({ ...result, installPackage }))
          res.writeHead(result.ok ? 200 : 500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: result.ok, changed: result.changed, error: result.error }))
        } catch (error) {
          logEvent('install threw: ' + (error instanceof Error ? error.message : String(error)))
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        }
      },
    })
    webCtx.effect(() => installDispose, 'theme-store: install route')

    // POST /api/theme-store/restart — respawn the GUI process so the new
    // client-module graph composes. Switching eDEX variants changes which
    // client rows are mounted, and the client-modules registry caches package
    // metadata per name (plugin-set changes take effect on restart), so the
    // GUI must reboot to pick up the new shell. This route spawns a detached
    // child running the same dsh command, then exits the current process.
    const restartDispose = webCtx.webServer.register({
      kind: 'exact',
      path: '/api/theme-store/restart',
      async handler(_req, res) {
        logEvent('restart request received (pid=' + process.pid + ')')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        // Let the response flush, then respawn the same dsh invocation in a
        // detached child and exit. The child inherits the current working
        // directory and args, so `--profile`/`--port` carry over.
        setTimeout(() => {
          try {
            logEvent('respawn: execPath=' + process.execPath + ' argv=' + JSON.stringify(process.argv.slice(1)) + ' cwd=' + process.cwd())
            const child = spawn(process.execPath, process.argv.slice(1), {
              cwd: process.cwd(),
              detached: true,
              stdio: 'ignore',
            })
            child.unref()
            logEvent('spawned child pid=' + (child.pid ?? 'unknown'))
          } catch (error) {
            logEvent('respawn failed: ' + (error instanceof Error ? error.message : String(error)))
            // Respawn failed; fall back to a bare exit so a supervisor can
            // restart the GUI.
          }
          const exit = (webCtx as unknown as { get(name: string): unknown }).get?.('appExit')
          logEvent('appExit available: ' + String(typeof exit === 'function'))
          if (typeof exit === 'function') void (exit as (code: number) => Promise<void>)(0)
        }, 300)
      },
    })
    webCtx.effect(() => restartDispose, 'theme-store: restart route')
  })
}