'use client';

// System / Day / Night. The server already rendered <html> in the saved mode
// (see theme/appearance.ts), so this only has to react to a click: write the
// cookie for the next page load and update the two attributes for this one.

import { useState } from 'react';
import {
  APPEARANCE_MODES,
  appearanceAttributes,
  appearanceCookie,
  type AppearanceMode,
} from '../theme/appearance';

interface AppearanceControlsProps {
  /** The mode the server rendered this page in, read from the cookie. */
  initial: AppearanceMode;
}

const TITLES: Readonly<Record<AppearanceMode, string>> = {
  system: 'Follow your device appearance',
  day: 'Use day mode',
  night: 'Use night mode',
};

function applyToDocument(mode: AppearanceMode): void {
  const root = document.documentElement;
  const attributes = appearanceAttributes(mode);
  root.setAttribute('data-appearance', attributes['data-appearance']);
  if (attributes['data-theme']) root.setAttribute('data-theme', attributes['data-theme']);
  else root.removeAttribute('data-theme');
  document.cookie = appearanceCookie(mode, window.location.protocol === 'https:');
}

export default function AppearanceControls({ initial }: AppearanceControlsProps) {
  const [mode, setMode] = useState<AppearanceMode>(initial);

  const choose = (next: AppearanceMode): void => {
    applyToDocument(next);
    setMode(next);
  };

  return (
    <div className="admin-appearance" role="group" aria-label="Appearance">
      {APPEARANCE_MODES.map((choice) => (
        <button
          key={choice}
          type="button"
          data-appearance-choice={choice}
          aria-pressed={choice === mode}
          title={TITLES[choice]}
          onClick={() => choose(choice)}
        >
          {choice.charAt(0).toUpperCase() + choice.slice(1)}
        </button>
      ))}
    </div>
  );
}
