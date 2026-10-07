// Asking before a very large request (Stage 8.3, D-032): the pure part. No Electron and nothing only Node has, because the page (to draw the
// question and to check what is typed) and the preload (it bundles the shared contract) use it too. The file the person's choice is kept in is
// main's (src/main/askFirst.ts), the waiting room for the answer is main's (src/main/confirmation.ts), and the question is asked from
// src/main/chat.ts; everything here is arithmetic, reading and wording, so a plain-Node suite can run it.
//
// The limits of 8.2 are the hard stop; this is the question that can come before it. When what a request SENDS (the conversation so far,
// which goes out again with every message) could cost more than an amount the person picked, the app shows what the request could cost, the
// most, and asks first. The amount is the person's: until they pick one the default below applies (so the question is on without anyone
// having to find it first), and "Never ask" is a choice made on purpose, like "No limit" is.

import { isLimitAmount, LIMIT_MAX_USD } from './limits'
import type { ModelPricing } from './registry'

/**
 * What a request may send for before the app asks, until the person picks an amount. The one number in this file that is the app's own:
 * it is shown in Settings and in the question itself, and changing it is one box. (The spending limits have no such number; those are
 * the person's alone, D-031. This is only a question, and a question that is off until someone finds it protects nobody.)
 */
export const ASK_FIRST_DEFAULT_USD = 0.5

/** What the app holds: nothing chosen yet (the default applies), "Never ask" chosen on purpose, or an amount in US dollars. */
export type AskFirstSetting = { kind: 'default' } | { kind: 'never' } | { kind: 'usd'; usd: number }

/** What the page may hand over: never "default", which is only what is there before anyone has chosen. */
export type AskFirstChoice = { kind: 'never' } | { kind: 'usd'; usd: number }

export const defaultAskFirst = (): AskFirstSetting => ({ kind: 'default' })

/** The amount a request is compared with, or null when the question is off ("Never ask"). */
export function askFirstAmount(setting: AskFirstSetting): number | null {
  if (setting.kind === 'never') return null
  return setting.kind === 'usd' ? setting.usd : ASK_FIRST_DEFAULT_USD
}

export const sameAskFirst = (a: AskFirstSetting, b: AskFirstSetting): boolean =>
  a.kind === b.kind && (a.kind !== 'usd' || (b.kind === 'usd' && a.usd === b.usd))

/**
 * True when saving `next` would make the question come less often than it does now (Stage 10.1, D-039): "Never ask", or an amount above the one in force
 * (the default's, until the person picks one). Main then asks the person first, in a window of the system's own; a lower amount is saved without that
 * question. Compared in whole cents.
 */
export function askFirstLoosens(current: AskFirstSetting, next: AskFirstChoice): boolean {
  const now = askFirstAmount(current)
  if (now === null) return false // "Never ask" already: nothing asks less often than that
  if (next.kind === 'never') return true
  return Math.round(next.usd * 100) > Math.round(now * 100)
}

// --- The estimate ------------------------------------------------------------------------------------------------------------

/**
 * What a request could cost at the most, at list prices, worked out by the main process before anything is sent and shown to the person
 * as it is. Every figure is the app's own guess, on the high side (the same guess the ledger counts, D-030), and none is a promise: the
 * provider's invoice decides.
 */
export interface RequestEstimate {
  /** A guess at the tokens the request sends: the app's rules, the person's instructions and every message (`estimateInputTokens`). */
  inputTokens: number
  /** What sending them could cost at the most: priced at the dearer of the ordinary input price and the cache-write price. */
  inputUsd: number
  /** The most the reply can write, thinking included: the request's own ceiling (`maxOutputTokens`). */
  outputTokens: number
  /** What a reply of that length costs, at the output price. */
  outputUsd: number
  /** `inputUsd` and `outputUsd` together: the most this request could cost. */
  totalUsd: number
  /**
   * The attached files the request sends, when there are any (D-037): how many, and how many of `inputTokens` they are. Absent for a request
   * without files, which is described exactly as before.
   */
  files?: { count: number; tokens: number }
}

/**
 * The most a request could cost: its input at the dearer of the two prices it can be billed at (ordinary input, or written to the
 * provider's cache, which the Anthropic request asks for and which costs a quarter more, D-030), and a reply as long as the ceiling lets
 * it be. A conversation the provider still holds in its cache (a few minutes after the last message) costs far less than this; the
 * app cannot know whether it does, so the figure says "up to".
 */
export function estimateRequest(
  inputTokens: number,
  maxOutputTokens: number,
  prices: ModelPricing,
  files?: { count: number; tokens: number }
): RequestEstimate {
  const inputUsd =
    (inputTokens * Math.max(prices.inputPerMTok, prices.cacheWritePerMTok)) / 1_000_000
  const outputUsd = (maxOutputTokens * prices.outputPerMTok) / 1_000_000
  return {
    inputTokens,
    inputUsd,
    outputTokens: maxOutputTokens,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    ...(files !== undefined && files.count > 0 ? { files: { ...files } } : {})
  }
}

/** A dollar amount in millionths of a dollar, the smallest price the registry can have (a token at $1 a million), so that float noise cannot decide. */
const micros = (usd: number): number => Math.round(usd * 1_000_000)

/**
 * Whether the app asks before sending this request: what it SENDS (its input, not the reply, whose length is not known) could cost MORE than
 * the amount. Exactly at the amount goes without a question, as exactly at a limit does. "Never ask" never asks.
 */
export function needsConfirmation(setting: AskFirstSetting, estimate: RequestEstimate): boolean {
  const above = askFirstAmount(setting)
  return above !== null && micros(estimate.inputUsd) > micros(above)
}

// --- What the person types ---------------------------------------------------------------------------------------------------

export type AskFirstTextCheck = { ok: true; usd: number } | { ok: false; error: string }

/** Reads an amount typed into the box: "0.50", "2", "$12.50". At most two decimals, more than nothing, at most LIMIT_MAX_USD. */
export function parseAskFirstText(text: string): AskFirstTextCheck {
  const typed = text.trim()
  if (typed === '') return { ok: false, error: 'Type an amount, or choose Never ask.' }
  const match = /^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(typed)
  if (!match) {
    return {
      ok: false,
      error: 'Type an amount in dollars, like 0.50 or 2 (no more than two decimals).'
    }
  }
  const usd = Number(match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`)
  if (!(usd > 0)) return { ok: false, error: 'The amount must be more than $0.' }
  if (usd > LIMIT_MAX_USD) {
    return {
      ok: false,
      error: `The most is $${LIMIT_MAX_USD.toLocaleString('en-US')}. Choose Never ask if you mean never.`
    }
  }
  return { ok: true, usd }
}

// --- What the page hands over ------------------------------------------------------------------------------------------------

export type AskFirstCheck = { ok: true; choice: AskFirstChoice } | { ok: false; error: string }

/**
 * Checks "save this choice" from the page: "Never ask", or an amount in whole cents between $0.01 and LIMIT_MAX_USD. The value handed back is
 * main's own, built field by field, so nothing else the page sends is kept. "Nothing chosen" is not something the page can send.
 */
export function checkAskFirstChoice(input: unknown): AskFirstCheck {
  const refused: AskFirstCheck = { ok: false, error: 'The choice was not understood.' }
  if (typeof input !== 'object' || input === null) return refused
  const { kind, usd } = input as Record<string, unknown>
  if (kind === 'never') return { ok: true, choice: { kind: 'never' } } // nothing else it carries is read
  if (kind === 'usd' && isLimitAmount(usd)) return { ok: true, choice: { kind: 'usd', usd } }
  return refused
}

// --- The file ----------------------------------------------------------------------------------------------------------------

/** What is written to ask-first.json, so that a person can read it: `{"version":1,"above":0.5}`, or `"above":"never"`. Nothing chosen leaves it out. */
export function askFirstFileText(setting: AskFirstSetting): string {
  const stored: Record<string, unknown> = { version: 1 }
  if (setting.kind === 'usd') stored.above = setting.usd
  else if (setting.kind === 'never') stored.above = 'never'
  return JSON.stringify(stored)
}

/**
 * Reads what ask-first.json holds. Forgiving the safe way, which here is the way that still asks: a file that is missing, damaged, cut off
 * or not one this app could have written holds no choice, so the default applies. Damage is NEVER read as "Never ask": a torn write of
 * this file costs the person's amount, and cannot turn the question off. `damaged` says whether anything was wrong (for the log).
 */
export function parseAskFirstFile(text: string): { setting: AskFirstSetting; damaged: boolean } {
  const nothing = (damaged: boolean): { setting: AskFirstSetting; damaged: boolean } => ({
    setting: defaultAskFirst(),
    damaged
  })
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return nothing(true)
  }
  if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== 1) {
    return nothing(true)
  }
  const { above } = raw as Record<string, unknown>
  if (above === undefined) return nothing(false)
  if (above === 'never') return { setting: { kind: 'never' }, damaged: false }
  if (isLimitAmount(above)) return { setting: { kind: 'usd', usd: above }, damaged: false }
  return nothing(true)
}
