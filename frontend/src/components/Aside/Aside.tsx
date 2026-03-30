import type { Stats, Tool } from '../../types';
import styles from './Aside.module.css';

interface AsideProps {
  isOpen: boolean;
  onClose: () => void;
  stats: Stats | null;
  tools: Tool[];
  workspace: string;
}

export function Aside({ isOpen, onClose, stats, tools, workspace }: AsideProps) {
  const sessionStart = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

  return (
    <aside className={`${styles.aside} ${!isOpen ? styles.hidden : ''}`}>
      <div className={styles['aside-header']}>
        <h2>⚙️ Panel de Control</h2>
        <button className={styles['close-btn']} onClick={onClose}>✕</button>
      </div>

      <div className={styles['aside-body']}>
        <div className={styles.section}>
          <div className={styles['section-title']}>📊 Estadísticas de Sesión</div>
          <div className={styles['stats-card']}>
            <div className={styles['stat-item']}>
              <span className={styles['stat-value']}>{stats?.messages || 0}</span>
              <span className={styles['stat-label']}>Mensajes</span>
            </div>
            <div className={styles['stat-item']}>
              <span className={styles['stat-value']}>{stats?.iterations || 0}</span>
              <span className={styles['stat-label']}>Iteraciones</span>
            </div>
            <div className={styles['stat-item']}>
              <span className={styles['stat-value']}>{stats?.toolCalls || 0}</span>
              <span className={styles['stat-label']}>Tool Calls</span>
            </div>
            <div className={styles['stat-item']}>
              <span className={styles['stat-value']}>{stats?.messages || 0}</span>
              <span className={styles['stat-label']}>En Contexto</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles['section-title']}>🔧 Herramientas Disponibles</div>
          <div className={styles['tools-list']}>
            {tools.slice(0, 15).map((tool) => (
              <div key={tool.name} className={styles['tool-item']} title={tool.description || ''}>
                <span className={styles['tool-icon']}>⚙</span>
                {tool.name}
              </div>
            ))}
            {tools.length > 15 && (
              <div className={styles['tool-item']} style={{ color: 'var(--text-dim)' }}>
                ...y {tools.length - 15} más
              </div>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles['section-title']}>💻 Sesión Actual</div>
          <div className={styles['session-info']}>
            <div className={styles['session-row']}>
              <span>Workspace</span>
              <span>{workspace.split('/').pop() || workspace}</span>
            </div>
            <div className={styles['session-row']}>
              <span>Inicio</span>
              <span>{sessionStart}</span>
            </div>
            <div className={styles['session-row']}>
              <span>Modelo</span>
              <span>{(stats?.model || '—').split('/').pop()}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
