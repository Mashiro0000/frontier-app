import {
  setAccent,
  setFont,
  setThemeChoice,
  useAccent,
  useFont,
  useThemeChoice,
  type ThemeChoice
} from '../appearance'
import { ACCENTS, FONTS } from '../../../shared/look'
import { IconMoon, IconSun } from '../icons'

const MONITOR = (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 21h6M12 17v4" />
  </svg>
)

const THEMES: { id: ThemeChoice; label: string; icon: React.JSX.Element }[] = [
  { id: 'system', label: 'System', icon: MONITOR },
  { id: 'light', label: 'Light', icon: <IconSun /> },
  { id: 'dark', label: 'Dark', icon: <IconMoon /> }
]

/**
 * Settings > Appearance (D-051, D-054, as AI Fiesta's Settings > General): the theme (System follows Windows), the accent colour and the font. Each changes the
 * window at once; all are kept on this computer, for this app only.
 */
function AppearanceSection(): React.JSX.Element {
  const choice = useThemeChoice()
  const accent = useAccent()
  const font = useFont()
  return (
    <section className="settings-section" aria-labelledby="settings-appearance-heading">
      <h3 id="settings-appearance-heading" className="settings-heading">
        Appearance
      </h3>

      <p className="look-label" id="look-theme-label">
        Theme
      </p>
      <div className="theme-choice" role="group" aria-labelledby="look-theme-label">
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="theme-option"
            aria-pressed={choice === option.id}
            onClick={() => setThemeChoice(option.id)}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
      <p className="settings-hint settings-more">
        Dark is the default. System follows Windows, and changes when Windows does.
      </p>

      <p className="look-label" id="look-accent-label">
        Accent colour
      </p>
      <div className="accent-choice" role="group" aria-labelledby="look-accent-label">
        {ACCENTS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="accent-option"
            data-accent={option.id}
            aria-pressed={accent === option.id}
            title={option.label}
            onClick={() => setAccent(option.id)}
          >
            <span
              className="accent-swatch"
              style={{ background: `linear-gradient(135deg, ${option.solid}, ${option.to})` }}
              aria-hidden="true"
            />
            <span className="accent-name">{option.label}</span>
          </button>
        ))}
      </div>

      <p className="look-label" id="look-font-label">
        Font
      </p>
      <div className="font-choice" role="group" aria-labelledby="look-font-label">
        {FONTS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="font-option"
            data-font={option.id}
            aria-pressed={font === option.id}
            onClick={() => setFont(option.id)}
          >
            <span className="font-sample" style={{ fontFamily: option.stack }} aria-hidden="true">
              Aa
            </span>
            <span className="font-name" style={{ fontFamily: option.stack }}>
              {option.label}
            </span>
          </button>
        ))}
      </div>
      <p className="settings-hint settings-more">
        Fonts that come with Windows; nothing is downloaded. The choices are kept on this computer,
        for this app only.
      </p>
    </section>
  )
}

export default AppearanceSection
