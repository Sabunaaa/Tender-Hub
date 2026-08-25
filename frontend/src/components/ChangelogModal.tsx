import { X } from 'lucide-react'
import { APP_VERSION, CHANGELOG } from '../lib/changelog'

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel changelog-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="changelog-head">
          <div>
            <p className="eyebrow">Version control</p>
            <h2 id="changelog-title">Update notes</h2>
            <p className="muted changelog-support">support: s84404579 - WeLink · current v{APP_VERSION}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="changelog-list">
          {CHANGELOG.map((release) => (
            <section key={release.version} className="changelog-release">
              <h3>
                v{release.version}
                <span>{release.title}</span>
              </h3>
              <ul>
                {release.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
