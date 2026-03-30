import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import type { GitInfo, CommitEntry } from '../../types';
import styles from './GitPanel.module.css';

interface GitPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GitPanel({ isOpen, onClose }: GitPanelProps) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [log, setLog] = useState<CommitEntry[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [checkoutBranch, setCheckoutBranch] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFrom, setNewBranchFrom] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [infoData, logData, branchesData] = await Promise.all([
        api.getGitInfo(),
        api.getGitLog(),
        api.getGitBranches(),
      ]);
      setInfo(infoData);
      setLog(logData);
      setBranches(branchesData.branches || []);
    } catch (err) {
      console.error('Error loading git data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const handleAdd = useCallback(async (files: string) => {
    await api.gitAdd(files);
    loadData();
  }, [loadData]);

  const handleRestore = useCallback(async (files: string, staged: boolean) => {
    await api.gitRestore(files, staged);
    loadData();
  }, [loadData]);

  const handleRemove = useCallback(async (files: string) => {
    if (confirm(`¿Eliminar el archivo "${files}"?\nEsta acción no se puede deshacer.`)) {
      await api.gitRemove(files);
      loadData();
    }
  }, [loadData]);

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) {
      alert('Ingresa un mensaje de commit');
      return;
    }
    const result = await api.gitCommit(commitMsg);
    if (result.ok) {
      setCommitMsg('');
      loadData();
    } else {
      alert('Error al hacer commit:\n' + result.out);
    }
  }, [commitMsg, loadData]);

  const handleCheckout = useCallback(async () => {
    if (!checkoutBranch.trim()) {
      alert('Selecciona una rama');
      return;
    }
    const result = await api.gitCheckout(checkoutBranch);
    if (result.ok) {
      loadData();
    } else {
      alert('Error al cambiar de rama:\n' + result.out);
    }
  }, [checkoutBranch, loadData]);

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) {
      alert('Ingresa un nombre para la rama');
      return;
    }
    const result = await api.gitCreateBranch(newBranchName, newBranchFrom || undefined);
    if (result.ok) {
      setNewBranchName('');
      setNewBranchFrom('');
      loadData();
    } else {
      alert('Error al crear rama:\n' + result.out);
    }
  }, [newBranchName, newBranchFrom, loadData]);

  const handleInit = useCallback(async () => {
    const result = await api.gitInit();
    if (result.ok) {
      loadData();
    } else {
      alert('Error al inicializar:\n' + result.out);
    }
  }, [loadData]);

  const getStatusBadgeClass = (status: string): string => {
    if (['M', 'A', 'D'].includes(status)) return styles[status];
    return styles.U;
  };

  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: 'U' };
    return labels[status] || status;
  };

  if (!isOpen) return null;

  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose} />
      <div className={`${styles.panel} ${isOpen ? styles.open : ''}`}>
        <div className={styles['panel-header']}>
          <span>🌿</span>
          <h3>Git</h3>
          <button className={styles['close-btn']} onClick={onClose}>✕</button>
        </div>

        <div className={styles['panel-body']}>
          {loading ? (
            <div className={styles.loading}>Cargando...</div>
          ) : info?.error ? (
            <>
              <div className={styles['error-msg']}>⚠️ {info.error}</div>
              {/no es un repositorio git|not a git repository/i.test(info.error) && (
                <button className={styles['init-btn']} onClick={handleInit}>🌿 Inicializar repositorio git</button>
              )}
            </>
          ) : (
            <>
              <div className={styles['info-bar']}>
                <span>📁 <strong>{info?.project}</strong></span>
                <span>·</span>
                <span>🌿 {info?.branch}</span>
                <button className={styles['refresh-btn']} onClick={loadData} title="Actualizar">↺</button>
              </div>

              <div className={styles.section}>
                <div className={styles['section-title']}>
                  <span>Staged <span className={styles.count} style={{ color: 'var(--green)' }}>({info?.staged.length})</span></span>
                  {info?.staged.length ? (
                    <button className={styles['action-btn']} onClick={() => handleRestore('.', true)}>Unstage all</button>
                  ) : null}
                </div>
                {info?.staged.length ? (
                  info.staged.map((f, i) => (
                    <div key={i} className={styles['file-item']}>
                      <span className={`${styles['status-badge']} ${getStatusBadgeClass(f.status)}`}>{getStatusLabel(f.status)}</span>
                      <span className={styles['file-name']} title={f.file}>{f.file}</span>
                      <button className={`${styles['action-btn']} ${styles.undo}`} onClick={() => handleRestore(f.file, true)}>↓</button>
                    </div>
                  ))
                ) : (
                  <div className={styles.empty}>Sin cambios staged</div>
                )}
              </div>
              <hr className={styles.divider} />

              <div className={styles.section}>
                <div className={styles['section-title']}>
                  <span>Cambios <span className={styles.count} style={{ color: 'var(--yellow)' }}>({info?.unstaged.length})</span></span>
                  {info?.unstaged.length ? (
                    <button className={`${styles['action-btn']} ${styles.add}`} onClick={() => handleAdd('.')}>Add all</button>
                  ) : null}
                </div>
                {info?.unstaged.length ? (
                  info.unstaged.map((f, i) => (
                    <div key={i} className={styles['file-item']}>
                      <span className={`${styles['status-badge']} ${getStatusBadgeClass(f.status)}`}>{getStatusLabel(f.status)}</span>
                      <span className={styles['file-name']} title={f.file}>{f.file}</span>
                      <button className={`${styles['action-btn']} ${styles.add}`} onClick={() => handleAdd(f.file)}>+</button>
                      <button className={`${styles['action-btn']} ${styles.undo}`} onClick={() => handleRestore(f.file, false)}>⟳</button>
                    </div>
                  ))
                ) : (
                  <div className={styles.empty}>Sin cambios</div>
                )}
              </div>
              <hr className={styles.divider} />

              <div className={styles.section}>
                <div className={styles['section-title']}>
                  <span>Sin seguimiento <span className={styles.count} style={{ color: 'var(--text-muted)' }}>({info?.untracked.length})</span></span>
                  {info?.untracked.length ? (
                    <button className={`${styles['action-btn']} ${styles.add}`} onClick={() => handleAdd('.')}>Add all</button>
                  ) : null}
                </div>
                {info?.untracked.length ? (
                  info.untracked.map((f, i) => (
                    <div key={i} className={styles['file-item']}>
                      <span className={`${styles['status-badge']} ${styles.q}`}>?</span>
                      <span className={styles['file-name']} title={f.file}>{f.file}</span>
                      <button className={`${styles['action-btn']} ${styles.add}`} onClick={() => handleAdd(f.file)}>+</button>
                      <button className={`${styles['action-btn']} ${styles.remove}`} onClick={() => handleRemove(f.file)}>🗑</button>
                    </div>
                  ))
                ) : (
                  <div className={styles.empty}>Sin archivos nuevos</div>
                )}
              </div>
              <hr className={styles.divider} />

              <div className={styles['commit-area']}>
                <div className={styles['section-title']}><span>Commit</span></div>
                <textarea
                  className={styles['branch-input']}
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Mensaje del commit..."
                />
                <button
                  className={styles['commit-btn']}
                  onClick={handleCommit}
                  disabled={!info?.staged.length}
                >
                  Commit staged ({info?.staged.length})
                </button>
              </div>
              <hr className={styles.divider} />

              <div className={styles['commit-area']}>
                <div className={styles['section-title']}><span>Cambiar rama</span></div>
                <select
                  className={styles['branch-select']}
                  value={checkoutBranch}
                  onChange={(e) => setCheckoutBranch(e.target.value)}
                >
                  <option value="">Seleccionar rama...</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <button className={styles['commit-btn']} onClick={handleCheckout}>Cambiar rama</button>
              </div>
              <hr className={styles.divider} />

              <div className={styles['commit-area']}>
                <div className={styles['section-title']}><span>Crear rama</span></div>
                <input
                  className={styles['branch-input']}
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="Nombre de la rama..."
                />
                <input
                  className={styles['branch-input']}
                  value={newBranchFrom}
                  onChange={(e) => setNewBranchFrom(e.target.value)}
                  placeholder="Desde (rama/commit, vacío = HEAD)..."
                />
                <button className={styles['commit-btn']} onClick={handleCreateBranch}>Crear rama</button>
              </div>
              <hr className={styles.divider} />

              <div className={styles.section}>
                <div className={styles['section-title']}><span>Historial reciente</span></div>
                {log.length ? (
                  log.map((c, i) => (
                    <div key={i} className={styles['log-item']}>
                      <span className={styles['log-hash']}>{c.hash}</span>
                      <span className={styles['log-msg']} title={c.message}>{c.message}</span>
                      <span className={styles['log-date']}>{c.date}</span>
                    </div>
                  ))
                ) : (
                  <div className={styles.empty}>Sin commits</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
