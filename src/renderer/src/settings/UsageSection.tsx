import { useEffect, useState } from 'react'
import { formatMoney, type LimitSetting, type Limits } from '../../../shared/limits'
import type { UsageSummary, UsageTotals } from '../../../shared/usage'
import { formatCount, formatSpend, inputSide } from './format'
import UsageChart from './UsageChart'

interface UsageSectionProps {
  /** Whether Settings is open: the sums are asked for each time it opens, and not while it is shut. */
  open: boolean
  /** The conversation on screen, whose own sum is shown first. */
  conversationId: string
  /** The spending limits (D-031), so that a row can say how much of its limit it has used. Null until the settings are known. */
  limits: Limits | null
}

const NO_BRIDGE = 'the window could not connect to the app (the preload did not load)'

function row(label: string, totals: UsageTotals, limit?: LimitSetting): React.JSX.Element {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {formatCount(inputSide(totals.tokens))} in, {formatCount(totals.tokens.output)} out,{' '}
        {totals.requests === 1 ? '1 request' : `${formatCount(totals.requests)} requests`}
      </td>
      {/* Two amounts that each stay on one line, so that a narrow window can break the cell before "of" (it scrolled sideways at 280 px). */}
      <td className="settings-usage-cost">
        <span className="settings-usage-amount">{formatSpend(totals.costUsd, totals.about)}</span>
        {limit?.kind === 'usd' && (
          <>
            {' '}
            <span className="settings-usage-amount">of {formatMoney(limit.usd)}</span>
          </>
        )}
      </td>
    </tr>
  )
}

/**
 * What has been used and what it cost (D-030): this chat, today and this month, from the main process's own ledger. The page only
 * asks for the sums. They are counted at the registry's list prices, so they say what the app thinks it owes, and the provider's invoice
 * is what decides; "about" marks a sum that includes a guess.
 */
function UsageSection({ open, conversationId, limits }: UsageSectionProps): React.JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The sums of an earlier opening are not shown again (found by the regression of 9.6): a reply may have ended since, and the old numbers
  // would be on screen until main answered. When Settings opens, it says "Checking..." until the new sums arrive.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSummary(null)
      setError(null)
    }
  }

  useEffect(() => {
    if (!open) return
    let current = true
    // `window.api` is missing when the preload failed to load (see D-004). Say so, and set state only in the callbacks below.
    const request = window.api
      ? window.api.usage.summary(conversationId)
      : Promise.reject(new Error(NO_BRIDGE))
    request.then(
      (sums) => {
        if (!current) return
        setSummary(sums)
        setError(null)
      },
      (failure: unknown) => {
        if (current) setError(failure instanceof Error ? failure.message : String(failure))
      }
    )
    return () => {
      current = false
    }
  }, [open, conversationId])

  const day = summary
    ? new Date(summary.at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
    : ''
  const month = summary
    ? new Date(summary.at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : ''

  return (
    <section className="settings-section" aria-labelledby="settings-usage-heading">
      <h3 id="settings-usage-heading" className="settings-heading">
        Usage
      </h3>
      {error !== null && (
        <p className="settings-notice settings-notice-error" role="status">
          The usage could not be read: {error}
        </p>
      )}
      {summary === null ? (
        error === null && <p className="settings-status">Checking...</p>
      ) : (
        <>
          <table className="settings-usage" aria-label="Usage so far">
            <tbody>
              {summary.chat !== null && row('This chat', summary.chat)}
              {row(`Today (${day})`, summary.today, limits?.daily)}
              {row(`This month (${month})`, summary.month, limits?.monthly)}
            </tbody>
          </table>
          {summary.unreadable > 0 && (
            <p className="settings-notice settings-notice-error" role="status">
              {summary.unreadable === 1
                ? '1 line of the usage file could not be read'
                : `${summary.unreadable} lines of the usage file could not be read`}
              , so what they cost is not in these sums.
            </p>
          )}
        </>
      )}
      <UsageChart open={open} />
      <p className="settings-hint">
        Counted by this app from what each provider reports, at list prices (cached input at its
        own, lower price). Your provider&apos;s invoice is what counts. &quot;About&quot; marks a
        sum that includes a guess: a reply that was stopped or failed has no report, so the app
        counts the text it sent and received, which leaves out any thinking that was not shown.
        Today and this month follow this computer&apos;s clock.
      </p>
    </section>
  )
}

export default UsageSection
