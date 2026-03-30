import styles from './Header.module.css';

interface HeaderProps {
  model?: string;
  provider?: string;
  workspace: string;
  onOpenWorkspace: () => void;
  onToggleAside: () => void;
  isBusy: boolean;
}

export function Header({ model, provider, workspace, onOpenWorkspace, onToggleAside, isBusy }: HeaderProps) {
  const workspaceName = workspace.split('/').pop() || workspace;

  return (
    <header className={styles.header}>
      <div className={styles['header-left']}>
        <div className={styles['status-indicator']}>
          <div className={`${styles.dot} ${isBusy ? styles.busy : ''}`} />
          <span className={styles['status-text']}>
            {isBusy ? 'Procesando...' : ''}
          </span>
        </div>
        <h1>🤖 MCP Dev Agent</h1>
      </div>

      <div className={styles['header-center']}>
        <button className={styles['ws-pill']} onClick={onOpenWorkspace} title="Cambiar directorio de trabajo">
          📁 <span className={styles['ws-name']}>{workspaceName}</span>
        </button>
      </div>

      <div className={styles['header-right']}>
        <div className={styles['model-badge']} title="Modelo activo">
          <span className={styles.label}>Modelo activo</span>
          <span className={styles['model-name']}>
            {model || 'cargando...'}
          </span>
        </div>
        <button className={styles['toggle-aside']} onClick={onToggleAside} title="Panel lateral">
          ☰
        </button>
      </div>
    </header>
  );
}
