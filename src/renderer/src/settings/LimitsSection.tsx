import type { SettingsStatus } from '../../../shared/ipc'
import { limitsAreSet } from '../../../shared/limits'
import LimitsForm from './LimitsForm'

interface LimitsSectionProps {
  status: SettingsStatus | null
  onStatusChange: (status: SettingsStatus) => void
}

/**
 * The spending limits in Settings (D-031): a daily and a monthly one, each an amount or a deliberate "No limit". The main process checks
 * them before EVERY request (a new message, Regenerate, an edited message) against what the ledger has counted, and refuses with a sentence
 * that says which limit; this section only collects the choice, and says what the limit is and is not.
 */
function LimitsSection({ status, onStatusChange }: LimitsSectionProps): React.JSX.Element {
  return (
    <section className="settings-section" aria-labelledby="settings-limits-heading">
      <h3 id="settings-limits-heading" className="settings-heading">
        Spending limits
      </h3>
      {status === null ? (
        <p className="settings-status">Checking...</p>
      ) : (
        <>
          {!limitsAreSet(status.limits) && (
            <p className="settings-notice settings-notice-error" role="status">
              No limits are set yet, so the app sends nothing until you set them.
            </p>
          )}
          <p className="settings-hint">
            A request that would take today&apos;s or this month&apos;s spending past a limit is not
            sent. Spending is what the app has counted (see Usage), at list prices. A reply that
            starts under a limit can end a little over it, by at most that one reply.
          </p>
          <LimitsForm
            limits={status.limits}
            idPrefix="limits-settings"
            submitLabel="Save limits"
            onSaved={onStatusChange}
          />
          <p className="settings-hint">
            The count is kept in the usage file in this app&apos;s data folder (usage/ledger.jsonl).
            Deleting that file starts the count again from zero, and the limits only know what it
            shows.
          </p>
        </>
      )}
    </section>
  )
}

export default LimitsSection
