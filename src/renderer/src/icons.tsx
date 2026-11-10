// The app's icons (D-051): drawn here as lines, so they take the colour of the text around them and need no file or font. Each is
// hidden from screen readers; the button that holds one always has a name of its own (a label, visible or not).

function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

/** The app's mark: a peak and a sun, on the gradient square around it. */
export function LogoMark(): React.JSX.Element {
  return (
    <svg className="logo-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 19.5 9 8.5l3.6 5.6 2.4-3.6 6.5 9z" />
      <circle cx="17.5" cy="5.5" r="2" />
    </svg>
  )
}

export const IconPlus = (): React.JSX.Element => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IconHistory = (): React.JSX.Element => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
)

export const IconTools = (): React.JSX.Element => (
  <Icon>
    <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4z" />
  </Icon>
)

export const IconSettings = (): React.JSX.Element => (
  <Icon>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
)

export const IconSun = (): React.JSX.Element => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Icon>
)

export const IconMoon = (): React.JSX.Element => (
  <Icon>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </Icon>
)

export const IconSidebar = (): React.JSX.Element => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9.5 4v16" />
  </Icon>
)

export const IconAttach = (): React.JSX.Element => (
  <Icon>
    <path d="m20.5 11.5-8.4 8.4a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />
  </Icon>
)

export const IconImage = (): React.JSX.Element => (
  <Icon>
    <path d="m11 3 1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18.5 15l.8 2 2 .8-2 .7-.8 2-.7-2-2-.7 2-.8z" />
  </Icon>
)

/** (21.5) Search: a magnifying glass. */
export const IconSearch = (): React.JSX.Element => (
  <Icon>
    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
  </Icon>
)

/** (21.4) Web search: a globe. */
export const IconGlobe = (): React.JSX.Element => (
  <Icon>
    <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </Icon>
)

/** (21.4) Enhance: a wand with a spark. */
export const IconEnhance = (): React.JSX.Element => (
  <Icon>
    <path d="M4 20 15 9M14 4v3M19.5 9.5h-3M17.8 5.2l-2 2M9 3.5v2M6 6.5H4" />
  </Icon>
)

export const IconProject = (): React.JSX.Element => (
  <Icon>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
)

export const IconInstructions = (): React.JSX.Element => (
  <Icon>
    <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </Icon>
)

export const IconMemory = (): React.JSX.Element => (
  <Icon>
    <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
  </Icon>
)

export const IconSend = (): React.JSX.Element => (
  <Icon>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Icon>
)

export const IconStop = (): React.JSX.Element => (
  <Icon>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </Icon>
)

/** (22.2) Experts: a person with a small star. */
export const IconExperts = (): React.JSX.Element => (
  <Icon>
    <path d="M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21c0-3.9 3.1-7 7-7 1.4 0 2.7.4 3.8 1.1M18 13l1.1 2.3 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" />
  </Icon>
)

/** (22.1) Library: books on a shelf. */
export const IconLibrary = (): React.JSX.Element => (
  <Icon>
    <path d="M3 4h4v16H3zM9 4h4v16H9zM15 5.2l3.6-1 3.9 15.1-3.6 1z" />
  </Icon>
)

/** (22.3) Image Studio: a frame with a hill and a sun. */
export const IconStudio = (): React.JSX.Element => (
  <Icon>
    <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5a1.5 1.5 0 1 0 0-.01" />
  </Icon>
)

// (23.1, D-055) The sidebar's chat menu.
export const IconMore = (): React.JSX.Element => (
  <Icon>
    <circle cx="5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="19" cy="12" r="1.2" />
  </Icon>
)

export const IconPin = (): React.JSX.Element => (
  <Icon>
    <path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />
  </Icon>
)

export const IconPencil = (): React.JSX.Element => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  </Icon>
)

export const IconTrash = (): React.JSX.Element => (
  <Icon>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Icon>
)

// (23.2, D-055) The actions under a message.
export const IconCopy = (): React.JSX.Element => (
  <Icon>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
)

export const IconCheck = (): React.JSX.Element => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)

export const IconRegenerate = (): React.JSX.Element => (
  <Icon>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
  </Icon>
)

export const IconSpeaker = (): React.JSX.Element => (
  <Icon>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
)

export const IconKey = (): React.JSX.Element => (
  <Icon>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8-8M16 7l3 3M14 9l2 2" />
  </Icon>
)

export const IconChart = (): React.JSX.Element => (
  <Icon>
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </Icon>
)
