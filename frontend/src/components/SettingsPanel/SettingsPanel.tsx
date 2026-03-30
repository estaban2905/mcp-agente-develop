import type { Settings as SettingsType } from '../../hooks/useSettings';
import styles from './SettingsPanel.module.css';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsType;
  onChange: (settings: Partial<SettingsType>) => void;
}

export function SettingsPanel({ isOpen, onClose, settings, onChange }: SettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose} />
      <div className={`${styles.panel} ${isOpen ? styles.open : ''}`}>
        <div className={styles['panel-header']}>
          <span>⚙️</span>
          <h3>Configuración</h3>
          <button className={styles['close-btn']} onClick={onClose}>✕</button>
        </div>

        <div className={styles['panel-body']}>
          <div className={styles.section}>
            <div className={styles['section-title']}>🎨 Apariencia</div>
            
            <div className={styles['setting-item']}>
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

            <div className={styles['setting-item']}>
              <label className={styles.label}>Tamaño de letra</label>
              <select
                className={styles.select}
                value={settings.fontSize}
                onChange={(e) => onChange({ fontSize: e.target.value as SettingsType['fontSize'] })}
              >
                <option value="small">Pequeño (14px)</option>
                <option value="medium">Normal (16px)</option>
                <option value="large">Grande (18px)</option>
              </select>
            </div>

            <div className={styles['setting-item']}>
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

          <hr className={styles.divider} />

          <div className={styles.section}>
            <div className={styles['section-title']}>💾 Guardado</div>
            <p className={styles.hint}>La configuración se guarda automáticamente en tu navegador.</p>
          </div>
        </div>
      </div>
    </>
  );
}
