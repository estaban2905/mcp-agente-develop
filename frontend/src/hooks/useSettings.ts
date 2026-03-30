import { useState, useEffect, useCallback } from 'react';

export type Theme = 'dark' | 'light';
export type FontSize = 'small' | 'medium' | 'large';
export type Density = 'compact' | 'normal' | 'spacious';

export interface Settings {
  theme: Theme;
  fontSize: FontSize;
  density: Density;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  fontSize: 'medium',
  density: 'normal',
};

const STORAGE_KEY = 'mcp-settings';

const THEME_COLORS = {
  dark: {
    '--bg': '#0d1117',
    '--surface': '#161b22',
    '--surface-hover': '#1c2128',
    '--border': '#30363d',
    '--border-light': '#3d444d',
    '--text': '#e6edf3',
    '--text-muted': '#7d8590',
    '--text-dim': '#484f58',
    '--accent': '#58a6ff',
    '--accent-dim': '#1f3a5f',
    '--accent-hover': '#79b8ff',
  },
  light: {
    '--bg': '#ffffff',
    '--surface': '#f6f8fa',
    '--surface-hover': '#eaeef2',
    '--border': '#d0d7de',
    '--border-light': '#d8dee4',
    '--text': '#1f2328',
    '--text-muted': '#656d76',
    '--text-dim': '#8c959f',
    '--accent': '#0969da',
    '--accent-dim': '#ddf4ff',
    '--accent-hover': '#0550ae',
  },
};

const FONT_SIZES = {
  small: '14px',
  medium: '16px',
  large: '18px',
};

const DENSITY = {
  compact: '4px',
  normal: '8px',
  spacious: '16px',
};

function applySettings(settings: Settings) {
  const root = document.documentElement;
  
  const themeColors = THEME_COLORS[settings.theme];
  Object.entries(themeColors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  
  root.style.setProperty('--font-size', FONT_SIZES[settings.fontSize]);
  root.style.setProperty('--spacing', DENSITY[settings.density]);
  root.style.setProperty('--radius', settings.density === 'compact' ? '4px' : '8px');
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  useEffect(() => {
    applySettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const setSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettingsState(prev => ({ ...prev, ...newSettings }));
  }, []);

  return { settings, setSettings };
}
