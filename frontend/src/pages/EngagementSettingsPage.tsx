import { useState } from 'react'
import { Check, RotateCcw, Save, Users } from 'lucide-react'
import { ErrorState, LoadingState } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { isSettingsSliceDirty, pickSettings, useSettingsDraft } from '../lib/useSettingsDraft'

const ENGAGEMENT_KEYS = ['accountManagers', 'solutionManagers'] as const

function PeopleList({
  label,
  names,
  onChange,
}: {
  label: string
  names: string[]
  onChange: (names: string[]) => void
}) {
  const [incoming, setIncoming] = useState('')
  const add = () => {
    const name = incoming.trim()
    if (!name) return
    if (names.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setIncoming('')
      return
    }
    onChange([...names, name])
    setIncoming('')
  }
  return (
    <div className="people-list">
      <span className="filter-label">{label}</span>
      <div className="people-row">
        <input
          className="field-input"
          placeholder="Add a name"
          value={incoming}
          onChange={(e) => setIncoming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            add()
          }}
        />
        <button type="button" className="secondary-button" onClick={add}>
          Add
        </button>
      </div>
      {names.map((name, index) => (
        <div key={`p-${index}`} className="people-row">
          <input
            className="field-input"
            value={name}
            onChange={(e) => {
              const next = [...names]
              next[index] = e.target.value
              onChange(next)
            }}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={() => onChange(names.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}

export function EngagementSettingsPage() {
  const {
    settingsQuery,
    draft,
    serverDraft,
    patch,
    reset,
    saveMutation,
    savedFlash,
  } = useSettingsDraft()

  if (settingsQuery.isLoading && !draft) return <LoadingState label="Loading engagement settings…" />
  if (settingsQuery.error && !draft) {
    return <ErrorState message={errorMessage(settingsQuery.error, 'Failed to load settings')} />
  }
  if (!draft || !serverDraft) return <LoadingState label="Loading engagement settings…" />

  const dirty = isSettingsSliceDirty(draft, serverDraft, ENGAGEMENT_KEYS)
  const save = () => saveMutation.mutate(pickSettings(draft, ENGAGEMENT_KEYS))

  return (
    <div className="settings-page">
      <div className="settings-intro">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h2>Engagement</h2>
          <p>These names appear as dropdowns on the Engagement page. Add, edit, or remove them here, then save.</p>
        </div>
        <div className="settings-intro-actions">
          <button type="button" className="secondary-button" disabled={!dirty || saveMutation.isPending} onClick={reset}>
            <RotateCcw size={15} /> Reset
          </button>
          <button type="button" className="primary-button" disabled={!dirty || saveMutation.isPending} onClick={save}>
            <Save size={15} />
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {saveMutation.isError && (
        <ErrorState message={errorMessage(saveMutation.error, 'Could not save settings')} />
      )}
      {savedFlash && !saveMutation.isError && (
        <div className="alert-box settings-saved">
          <Check size={14} /> Settings saved
        </div>
      )}

      <section className="settings-grid">
        <article className="settings-card" style={{ gridColumn: '1 / -1' }}>
          <header>
            <Users size={18} />
            <div>
              <p className="eyebrow">People</p>
              <h3>Account and Solution Managers</h3>
            </div>
          </header>
          <div className="two-col">
            <PeopleList
              label="Account managers"
              names={draft.accountManagers}
              onChange={(accountManagers) => patch({ accountManagers })}
            />
            <PeopleList
              label="Solution managers"
              names={draft.solutionManagers}
              onChange={(solutionManagers) => patch({ solutionManagers })}
            />
          </div>
        </article>
      </section>

      {dirty && (
        <div className="settings-savebar">
          <span>Unsaved manager list changes</span>
          <button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={save}>
            <Save size={15} /> Save now
          </button>
        </div>
      )}
    </div>
  )
}
