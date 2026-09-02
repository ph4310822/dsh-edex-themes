/** Theme store settings stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the theme store plugin. */
export const THEME_STORE_NAMESPACE = 'ui-theme-store'

/** Field carrying the currently applied theme id. */
export const THEME_STORE_APPLIED_FIELD = 'applied'

/** Durable settings section shared by the Host schema and the browser scope. */
export interface ThemeStoreSettings {
  /** Applied theme id (empty string = none / built-in preference active). */
  applied: string
}

/** Durable schema; also the wire envelope the browser scope validates against. */
export const ThemeStoreSettingsSchema: z<ThemeStoreSettings> = z.object({
  [THEME_STORE_APPLIED_FIELD]: z.string().default(''),
})
