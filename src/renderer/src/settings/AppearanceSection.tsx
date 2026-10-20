import { setTheme, useTheme, type Theme } from '../appearance'
import { IconMoon, IconSun } from '../icons'

const THEMES: { id: Theme; label: string; icon: React.JSX.Element }[] = [
  { id: 'dark', label: 'Dark', icon: <IconMoon /> },
  { id: 'light', label: 'Light', icon: <IconSun /> }
]

/** Settings > Appearance (D-051): dark or light. The same choice as the button at the foot of the sidebar. */
function AppearanceSection(): React.JSX.Element {
  const theme = useTheme()
  return (
    <section className="settings-section" aria-labelledby="settings-appearance-heading">
      <h3 id="settings-appearance-heading" className="settings-heading">
        Appearance
      </h3>
      <div className="theme-choice" role="group" aria-label="Theme">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="theme-option"
            aria-pressed={theme === option.id}
            onClick={() => setTheme(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
      <p className="settings-hint">
        Dark is the default. The choice is kept on this computer, for this app only.
      </p>
    </section>
  )
}

export default AppearanceSection
