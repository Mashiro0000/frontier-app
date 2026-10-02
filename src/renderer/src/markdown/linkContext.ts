import { createContext } from 'react'

/**
 * Asks the person whether an address may be opened in their browser (D-025). The links in a reply call this and nothing else: they
 * carry no `href`, so a click, a middle click and a drag all do nothing by themselves. Without a provider a link does nothing.
 */
export const OpenLinkContext = createContext<(url: string) => void>(() => {})
