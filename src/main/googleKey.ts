import type { SystemQuestion } from './systemQuestion'
import { ASKED_HERE } from './toolQuestion'

// (Stage 17.5, D-049) The question in the system's own message box before a Google key is saved (the owner's pick 2: a free key is allowed, after the box says
// what Google does with what is sent). The app cannot tell a free key from a billed one, and sends nothing anywhere to find out; so the question is asked every
// time a Google key is saved, also when one replaces another. No Electron imports: the words are checked under plain Node.

/** The sentence when the person says no: nothing was saved. */
export const GOOGLE_KEY_NOT_SAVED = 'Not saved: you said no in the window that asked.'

export function googleKeyQuestion(): SystemQuestion {
  return {
    title: 'Google API key',
    message: 'Save this Google API key, so that the app can send your chats to Google?',
    detail: [
      "When a Gemini model answers, everything the request carries goes to Google with this key: the chat so far, your instructions and notes, the files on it, and what your tools brought back. Nothing goes to Google while you chat with another provider's model.",
      '',
      'On a free (unbilled) key, Google uses what you send to improve its products, and people at Google may read it. On a billed key it does not (Google keeps it for a limited time, to look for abuse). The app cannot tell which kind of key this is, and sends nothing to find out.',
      '',
      'Gemini 4 Argon needs a billed key: on a free key Google refuses it.',
      '',
      "Gemini's prices change on set days (Gemini 4 Argon doubles on 1 December 2026, Gemini 3.8 Flash on 1 January 2027). The app counts each request at the prices of its day, against your spending limits.",
      '',
      'Searching the web is not offered with Gemini models: the search would run on Google Search, and Google keeps searched prompts for 30 days.',
      '',
      'The key is kept encrypted on this computer, like your other keys. You can remove it in Settings.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Save the key',
    no: "Don't save it"
  }
}
