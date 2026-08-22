import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { AppSettings, SettingsUpdate } from '../api'

export type SettingsDraft = Omit<AppSettings, 'nextScheduledAt' | 'taskStatus'>

export function toSettingsDraft(settings: AppSettings): SettingsDraft {
  return {
    scheduleEnabled: settings.scheduleEnabled,
    // Tolerate a backend that predates multi-time scheduling rather than crashing the page.
    scheduleTimes: [...(settings.scheduleTimes ?? [])],
    scheduleDays: [...settings.scheduleDays],
    dailyLookbackDays: settings.dailyLookbackDays,
    requestDelaySeconds: settings.requestDelaySeconds,
    maxRequestsPerSecond: settings.maxRequestsPerSecond,
    scrapeConcurrency: settings.scrapeConcurrency,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    closingSoonDays: settings.closingSoonDays,
    defaultPageSize: settings.defaultPageSize,
    accountManagers: [...(settings.accountManagers ?? [])],
    solutionManagers: [...(settings.solutionManagers ?? [])],
  }
}

export function pickSettings(
  draft: SettingsDraft,
  keys: readonly (keyof SettingsDraft)[],
): SettingsUpdate {
  const patch: SettingsUpdate = {}
  for (const key of keys) {
    Object.assign(patch, { [key]: draft[key] })
  }
  return patch
}

export function isSettingsSliceDirty(
  draft: SettingsDraft,
  server: SettingsDraft,
  keys: readonly (keyof SettingsDraft)[],
): boolean {
  return keys.some((key) => JSON.stringify(draft[key]) !== JSON.stringify(server[key]))
}

export function useSettingsDraft() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  })
  const [draftOverride, setDraftOverride] = useState<SettingsDraft | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const serverDraft = settingsQuery.data ? toSettingsDraft(settingsQuery.data) : null
  const draft = draftOverride ?? serverDraft

  const saveMutation = useMutation({
    mutationFn: (patch: SettingsUpdate) => api.updateSettings(patch),
    onSuccess: (saved) => {
      qc.setQueryData(['settings'], saved)
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['engagements'] })
      setDraftOverride(null)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2400)
    },
  })

  const patch = (partial: Partial<SettingsDraft>) => {
    setDraftOverride((current) => {
      const base = current ?? serverDraft
      return base ? { ...base, ...partial } : current
    })
  }

  return {
    settingsQuery,
    draft,
    serverDraft,
    saved: settingsQuery.data,
    patch,
    reset: () => setDraftOverride(null),
    saveMutation,
    savedFlash,
  }
}
