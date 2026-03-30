import { useState, useEffect, useCallback } from 'react';
import styles from './WorkspaceSelector.module.css';
import { api } from '../../api/client';

interface WorkspaceSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceChange: (path: string) => void;
}

export function WorkspaceSelector({ isOpen, onClose, onWorkspaceChange }: WorkspaceSelectorProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [directories, setDirectories] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [browseTimer, setBrowseTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      api.getWorkspace().then(({ path }) => {
        setCurrentPath(path);
        setInputValue(path);
        loadDirectories(path);
      });
      setRecentPaths(getRecentPaths());
    }
  }, [isOpen]);

  const getRecentPaths = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem('mcp-ws-history') || '[]');
    } catch {
      return [];
    }
  };

  const addToRecent = (path: string) => {
    const filtered = recentPaths.filter(p => p !== path);
    const updated = [path, ...filtered].slice(0, 8);
    localStorage.setItem('mcp-ws-history', JSON.stringify(updated));
    setRecentPaths(updated);
  };

  const loadDirectories = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.browse(path);
      if (data.error) {
        setError(data.error);
        return;
      }
      setDirectories(data.dirs || []);
      setCurrentPath(data.path);
    } catch (err: any) {
      setError(err.message || 'Error al cargar directorio');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (browseTimer) clearTimeout(browseTimer);
    if (value.trim()) {
      const timer = setTimeout(() => loadDirectories(value.trim()), 450);
      setBrowseTimer(timer);
    }
  };

  const handleBreadcrumbClick = (path: string) => {
    loadDirectories(path);
  };

  const handleDirectoryClick = (dir: string) => {
    const newPath = currentPath.replace(/\/$/, '') + '/' + dir;
    loadDirectories(newPath);
  };

  const handleRecentClick = (path: string) => {
    loadDirectories(path);
  };

  const handleApply = async () => {
    const newPath = inputValue.trim();
    if (!newPath) return;

    setError('');
    try {
      const data = await api.setWorkspace(newPath);
      if (!data.ok) {
        setError(data.error || 'Error al cambiar workspace');
        return;
      }
      addToRecent(data.path);
      onWorkspaceChange(data.path);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error de conexión');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && isOpen) handleApply();
  };

  const renderBreadcrumb = () => {
    const parts = currentPath.split('/').filter(Boolean);
    return (
      <div className={styles.breadcrumb}>
        <span
          className={styles.bcPart}
          onClick={() => handleBreadcrumbClick('/')}
        >
          /
        </span>
        {parts.map((part, i) => {
          const acc = '/' + parts.slice(0, i + 1).join('/');
          return (
            <span key={i}>
              <span className={styles.bcSep}>›</span>
              <span
                className={styles.bcPart}
                onClick={() => handleBreadcrumbClick(acc)}
              >
                {part}
              </span>
            </span>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <h3>📁 Cambiar directorio de trabajo</h3>
        {renderBreadcrumb()}
        <input
          type="text"
          className={styles.input}
          value={inputValue}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="/home/usuario/mi-proyecto"
          spellCheck={false}
          autoFocus
        />
        <div className={styles.dirList}>
          {loading && <div className={styles.loading}>Cargando...</div>}
          {!loading && directories.length === 0 && !error && (
            <div className={styles.empty}>Sin subdirectorios</div>
          )}
          {!loading && error && <div className={styles.error}>{error}</div>}
          {!loading && directories.map(dir => (
            <div
              key={dir}
              className={styles.dirItem}
              onClick={() => handleDirectoryClick(dir)}
            >
              📁 {dir}
            </div>
          ))}
        </div>
        {recentPaths.length > 0 && (
          <div className={styles.recentSection}>
            <div className={styles.recentTitle}>Recientes</div>
            <div className={styles.recentList}>
              {recentPaths.map(path => (
                <div
                  key={path}
                  className={styles.recentItem}
                  onClick={() => handleRecentClick(path)}
                >
                  <span className={styles.recentName}>
                    {path.split('/').filter(Boolean).pop() || path}
                  </span>
                  <span className={styles.recentPath}>{path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className={styles.errorMsg}>{error}</div>
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancelar
          </button>
          <button className={styles.applyBtn} onClick={handleApply}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceSelector;
