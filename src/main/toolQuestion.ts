import type { SystemQuestion } from './systemQuestion'
import type { CheckedArgs, ToolDefinition } from './toolRegistry'

// The words of the question that stands in front of every tool call (Stage 11.1, D-041), put to the person in the system's own message box (10.1,
// systemQuestion.ts). It shows the call IN FULL: the tool, every argument exactly as the tool will be given it, and the reason the model gives. What it
// shows came from a model that may have read a hostile page, so none of it can pass for the question's own lines: every value is shown between quotes
// with the quote and the backslash escaped and anything the eye cannot see written out (`\u{202e}`), so a value cannot add a line, hide text, turn the
// text around or end the quote. A call whose question would not fit is refused, never shortened (SHOWN_LIMIT). No Electron imports.

/** The most characters that the box's detail may hold. A tool whose largest call would not fit is not registrable, and a call that does not fit is refused. */
export const SHOWN_LIMIT = 2000

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]|[^\P{Zs} ]/u

/** The last line of every such question: why it is asked here, and what cannot answer it. */
export const ASKED_HERE =
  "Frontier App asks this in a window of its own, which the app's page cannot answer. A note, an instruction or a file cannot say yes for you: only you can, here."

/** Text as the box shows it: between quotes, with nothing in it that can pass for the box's own words. */
export function shown(text: string): string {
  let out = '"'
  for (const char of text) {
    if (char === '"' || char === '\\') out += `\\${char}`
    else if (INVISIBLE.test(char)) out += `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`
    else out += char
  }
  return `${out}"`
}

export interface StepOfCaps {
  step: number
  steps: number
}

/**
 * The question for one call: `args` is what the tool will be given (a path as the real path that the guard resolved), `why` the model's reason as it was
 * cleaned. The no button is the box's cancel, as in every question of 10.1: only a deliberate click on the yes can say yes.
 */
export function approvalQuestion(
  def: ToolDefinition,
  args: CheckedArgs,
  why: string,
  place?: StepOfCaps
): SystemQuestion {
  const lines = ['The model asked to use a tool.', '', `Tool: ${def.title}`]
  for (const [name, spec] of Object.entries(def.args)) {
    const value = args[name]
    lines.push(`${spec.label}: ${typeof value === 'number' ? String(value) : shown(String(value))}`)
  }
  lines.push(`The model's reason: ${shown(why)}`, '', def.effect, '')
  if (place !== undefined) {
    lines.push(`This is step ${place.step} of at most ${place.steps} that this reply may take.`, '')
  }
  lines.push(ASKED_HERE)
  return {
    title: def.title,
    message: `Allow this ${def.noun}?`,
    detail: lines.join('\n'),
    yes: def.yes,
    no: "Don't allow"
  }
}
