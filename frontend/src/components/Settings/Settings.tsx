import { Settings as SettingsType } from '../../hooks/useSettings';
import styles from './Settings.module.css';

interface SettingsProps {
  settings: SettingsType;
  onChange: (settings: Partial<SettingsType>) => void;
}

export function Settings({ settings, onChange }: SettingsProps) {
  return (
    <div className={styles.container}>
      <div className={styles.group}>
        <label className={styles.label}>Tema</label>
        <select
          className={styles.select}
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value as SettingsType['theme'] })}
        >
          <option value="dark">🌙 Oscuro</option>
          <option value="light">☀️ Claro</option>
        </select>
      </div>

      <div className={styles.group}>
        <label className={styles.label}>Tamaño</label>
        <select
          className={styles.select}
          value={settings.fontSize}
          onChange={(e) => onChange({ fontSize: e.target.value as SettingsType['fontSize'] })}
        >
          <option value="small">Pequeño</option>
          <option value="medium">Normal</option>
          <option value="large">Grande</option>
        </select>
      </div>

      <div className={styles.group}>
        <label className={styles.label}>Densidad</label>
        <select
          className={styles.select}
          value={settings.density}
          onChange={(e) => onChange({ density: e.target.value as SettingsType['density'] })}
        >
          <option value="compact">Compacta</option>
          <option value="normal">Normal</option>
          <option value="spacious">Espaciada</option>
        </select>
      </div>
    </div>
  );
}
