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
