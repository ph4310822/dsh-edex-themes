/**
 * Theme store section: a Settings page that lists repository themes as image
 * cards. Color themes apply inline (`register` + `setTheme`); shell themes
 * (eDEX variants) also preview their palette but need a pnpm install for the
 * full UI, so their card surfaces the install command and copies it on demand.
 *
 * The component receives the store mirror (catalog status/themes/applied/
 * installedShells) and injected callbacks. It is a pure props consumer — no
 * React context, no ctx, no subscription machinery.
 */
import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogTheme } from './catalog.ts'
import type { createThemeStoreStore } from './settings-store.ts'
import css from './ThemeStoreSection.module.css'

/** Install progress stages surfaced to the card's status bar. */
export type ThemeInstallStage = 'installing' | 'restarting' | 'reloading'

/**
 * sessionStorage key the install flow writes right before `location.reload()`
 * so the section can show a visible "installed and restarted" confirmation
 * after the page comes back (the reload wipes the DevTools console).
 */
export const LAST_INSTALL_KEY = 'theme-store.last-install'

/** Marker payload read back by the section after the reload. */
export interface LastInstallMarker {
  /** Catalog theme id that was installed. */
  id: string
  /** Display name of the installed theme. */
  name: string
  /** ISO timestamp of the install. */
  ts: string
}

/** Read (and keep) the last-install marker, if any. */
function readLastInstall(): LastInstallMarker | undefined {
  try {
    const raw = window.sessionStorage.getItem(LAST_INSTALL_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<LastInstallMarker>
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return undefined
    return { id: parsed.id, name: parsed.name, ts: typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString() }
  } catch {
    return undefined
  }
}

/** Forget the last-install marker (dismissed by the user). */
function clearLastInstall(): void {
  try {
    window.sessionStorage.removeItem(LAST_INSTALL_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** Injected business face: load/retry, apply, install-command copy, and shell-theme install. */
export interface ThemeStoreSectionInjected {
  /** Load (or re-load) the theme catalog. */
  load: () => void
  /** Apply a catalog theme by id (color preview for shell themes). */
  apply: (id: string) => void
  /** Copy a shell theme's install command to the clipboard. */
  copyInstall: (command: string) => void
  /**
   * Install a shell theme's bundle into the active profile (pnpm add +
   * profile patch rewrite), respawn the GUI, and reload once it is back.
   * Reports progress through the optional stage callback so the card can
   * render a status bar. Writes a last-install marker before the reload so
   * the section can confirm the install after the page returns. Throws on
   * error.
   * @param installPackage - npm bundle package to install.
   * @param onStage - optional progress callback.
   * @param marker - catalog theme identity to confirm after the reload.
   */
  installShell: (
    installPackage: string,
    onStage?: (stage: ThemeInstallStage) => void,
    marker?: LastInstallMarker,
  ) => Promise<void>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type ThemeStoreSectionComponentProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createThemeStoreStore>>
  & PropsLocale<'settings.themeStore'>
  & ThemeStoreSectionInjected

/**
 * Render the theme store section.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function ThemeStoreSection({ t, useStore, apply, load, installShell }: ThemeStoreSectionComponentProps): ReactNode {
  const { status, themes, applied, installedShells, error } = useStore(s => s)
  const [lastInstall, setLastInstall] = useState<LastInstallMarker | undefined>(readLastInstall)
  const shellCount = themes.filter(theme => theme.type === 'shell').length
  console.log('[theme-store] ThemeStoreSection rendered:', {
    status, themes: themes.length, shellThemes: shellCount, applied,
    installedShells: installedShells.length, lastInstall,
  })
  const dismissBanner = (): void => {
    clearLastInstall()
    setLastInstall(undefined)
  }

  return (
    <div className={css.section} aria-busy={status === 'loading'}>
      <div className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.subtitle}>{t('subtitle')}</p>
      </div>

      {lastInstall !== undefined ? (
        <div className={css.banner} role="status">
          <span className={css.bannerText}>{t('installedBanner').replace('{name}', lastInstall.name)}</span>
          <button type="button" className={css.bannerDismiss} onClick={dismissBanner} aria-label={t('dismiss')}>×</button>
        </div>
      ) : null}

      {status === 'loading' ? (
        <p className={css.status}>{t('loading')}</p>
      ) : status === 'error' ? (
        <div className={css.failure} role="alert">
          <p>{error ? error : t('error')}</p>
          <button type="button" className={css.retry} onClick={load}>{t('retry')}</button>
        </div>
      ) : status === 'ready' && themes.length === 0 ? (
        <p className={css.status}>{t('empty')}</p>
      ) : status === 'ready' ? (
        <div className={css.grid}>
          {themes.map(theme => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              applied={applied === theme.id}
              installed={theme.type === 'shell'
                && theme.shellPluginId !== undefined
                && installedShells.includes(theme.shellPluginId)}
              t={t}
              onApply={() => { apply(theme.id) }}
              onInstall={(onStage) => {
                if (theme.type === 'shell' && theme.installPackage !== undefined) {
                  return installShell(theme.installPackage, onStage, {
                    id: theme.id,
                    name: theme.name,
                    ts: new Date().toISOString(),
                  })
                }
                onStage?.('installing')
                return Promise.resolve()
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** One theme card: screenshot, name, author, scheme badge, Apply/Install button. */
function ThemeCard({
  theme, applied, installed, t, onApply, onInstall,
}: {
  theme: CatalogTheme
  applied: boolean
  installed: boolean
  t: ThemeStoreSectionComponentProps['t']
  onApply: () => void
  onInstall: (onStage: (stage: ThemeInstallStage) => void) => Promise<void>
}): ReactNode {
  const [broken, setBroken] = useState(false)
  const [stage, setStage] = useState<ThemeInstallStage | undefined>(undefined)
  const [installError, setInstallError] = useState<string | undefined>(undefined)
  const schemeLabel = theme.colorScheme === 'light' ? t('light') : t('dark')
  const shell = theme.type === 'shell'
  // Shell themes ALWAYS run the full install flow on click (a no-op restart
  // when the shell is already active). Only color themes use the inline
  // color-preview Apply.
  const runInstall = (): void => {
    console.log('[theme-store] Apply/Install clicked:', theme.id, { installPackage: theme.installPackage })
    setInstallError(undefined)
    Promise.resolve()
      .then(() => onInstall(setStage))
      .catch(error => {
        console.log('[theme-store] Install failed:', error instanceof Error ? error.message : String(error))
        setStage(undefined)
        setInstallError(error instanceof Error ? error.message : String(error))
      })
  }

  return (
    <div className={css.card} data-theme={theme.id}>
      <div className={css.screenshot}>
        {!broken ? (
          <img
            src={theme.screenshot}
            alt={theme.name}
            className={css.screenshotImg}
            loading="lazy"
            onError={() => { setBroken(true) }}
          />
        ) : (
          <div className={css.swatchFallback}>
            {/* Render a few colour swatches from the first tokens. */}
            {Object.entries(theme.tokens).slice(0, 6).map(([name, value]) => (
              <span
                key={name}
                className={css.swatch}
                style={{ backgroundColor: value }}
                title={`${name}: ${value}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className={css.cardMain}>
        <div className={css.cardBody}>
          <strong className={css.cardName}>{theme.name}</strong>
          <span className={css.cardAuthor}>{t('author')}: {theme.author}</span>
          <span className={css.cardTags}>
            <span className={css.cardScheme} data-scheme={theme.colorScheme}>{schemeLabel}</span>
            {shell ? <span className={css.cardType}>{t('shellTheme')}</span> : null}
          </span>
        </div>
      {shell ? (
        <div className={css.installBox}>
          {stage === undefined ? (
            <>
              {!installed ? <p className={css.installNote}>{t('shellInstallNote')}</p> : null}
              {theme.installHint !== undefined && !installed ? (
                <code className={css.installCommand}>{theme.installHint}</code>
              ) : null}
            </>
          ) : null}
          {stage !== undefined ? (
            <div className={css.progress} role="progressbar" aria-label={t(stage)}>
              <span className={css.progressBar} />
              <span className={css.progressLabel}>{t(stage)}</span>
            </div>
          ) : null}
          {installError !== undefined ? (
            <p className={css.installError} role="alert">{installError}</p>
          ) : null}
          <button
            type="button"
            className={css.applyBtn}
            disabled={stage !== undefined}
            onClick={e => { e.currentTarget.blur(); runInstall() }}
            aria-label={`${t(installed && !applied ? 'apply' : applied ? 'applied' : 'install')} ${theme.name}`}
          >
            {installed && applied ? t('applied') : installed ? t('apply') : t('install')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={css.applyBtn}
          disabled={applied}
          aria-pressed={applied}
          aria-label={applied ? `${t('applied')} ${theme.name}` : `${t('apply')} ${theme.name}`}
          onClick={e => { e.currentTarget.blur(); onApply() }}
        >
          {applied ? t('applied') : t('apply')}
        </button>
      )}
      </div>
    </div>
  )
}
