import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import type { Note } from '../../types';
import styles from './NotesPanel.module.css';

interface NotesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

export function NotesPanel({ isOpen, onClose, onCountChange }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const parseNotes = useCallback((raw: string): Note[] => {
    if (!raw.trim()) return [];
    const result: Note[] = [];
    const sections = raw.split(/\n---\n/).filter(s => s.trim());
    for (const section of sections) {
      const titleMatch = section.match(/^##\s+(.+)/m);
      const dateMatch = section.match(/^\*(.+)\*$/m);
      const bodyLines = section.split('\n').filter(l => !l.startsWith('##') && !l.match(/^\*.+\*$/) && l.trim());
      result.push({
        title: titleMatch ? titleMatch[1].trim() : 'Nota',
        date: dateMatch ? dateMatch[1].trim() : '',
        body: bodyLines.join('\n').trim(),
      });
    }
    return result.filter(n => n.body);
  }, []);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const { content } = await api.getNotes();
      const parsed = parseNotes(content);
      setNotes(parsed);
      onCountChange(parsed.length);
    } catch (err) {
      console.error('Error loading notes:', err);
    } finally {
      setLoading(false);
    }
  }, [parseNotes, onCountChange]);

  useEffect(() => {
    if (isOpen) {
      loadNotes();
    }
  }, [isOpen, loadNotes]);

  const handleSave = useCallback(async () => {
    if (!content.trim()) return;
    await api.saveNote(content, title || undefined);
    setTitle('');
    setContent('');
    loadNotes();
  }, [content, title, loadNotes]);

  const handleDelete = useCallback(async (index: number) => {
    if (!confirm('¿Eliminar esta nota?')) return;
    await api.deleteNote(index);
    loadNotes();
  }, [loadNotes]);

  const handleClearAll = useCallback(async () => {
    if (!confirm('¿Eliminar todas las notas?\nEsta acción no se puede deshacer.')) return;
    await api.deleteAllNotes();
    loadNotes();
  }, [loadNotes]);

  const toggleExpand = useCallback((index: number) => {
    setExpandedNotes(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  return (
    <>
      <div className={`${styles.overlay} ${isOpen ? styles.open : ''}`} onClick={onClose} />
      <div className={`${styles.panel} ${isOpen ? styles.open : ''}`}>
        <div className={styles['panel-header']}>
          <span style={{ fontSize: '18px' }}>📝</span>
          <h3>
            Project Notes
            {notes.length > 0 && <span className={styles['count-badge']}>{notes.length}</span>}
          </h3>
          <button className={styles['clear-btn']} onClick={onClose} style={{ marginLeft: 'auto', padding: '4px 8px' }}>✕</button>
        </div>

        <div className={styles['panel-body']}>
          {loading ? (
            <div className={styles['empty-state']}>
              <div className={styles['empty-icon']}>📝</div>
              <div className={styles['empty-title']}>Cargando...</div>
            </div>
          ) : notes.length === 0 ? (
            <div className={styles['empty-state']}>
              <div className={styles['empty-icon']}>📭</div>
              <div className={styles['empty-title']}>Sin notas todavía</div>
              <div className={styles['empty-sub']}>
                Pídele al agente que analice tu proyecto y guarda los resultados aquí para que los tenga en cuenta en futuras sesiones.
              </div>
            </div>
          ) : (
            <div className={styles['notes-list']}>
              {[...notes].reverse().map((note, i) => {
                const realIndex = notes.length - 1 - i;
                const isExpanded = expandedNotes.has(realIndex);
                const isTall = note.body.split('\n').length > 8 || note.body.length > 400;
                return (
                  <div key={realIndex} className={styles['note-card']}>
                    <div className={styles['note-header']}>
                      <span className={styles['note-title']}>📌 {note.title}</span>
                      <span className={styles['note-date']}>{note.date}</span>
                      <button className={styles['delete-btn']} onClick={() => handleDelete(realIndex)}>✕</button>
                    </div>
                    <div
                      className={`${styles['note-body']} ${isExpanded ? styles.expanded : ''}`}
                      onClick={() => isTall && !isExpanded && toggleExpand(realIndex)}
                    >
                      {note.body}
                    </div>
                    {isTall && !isExpanded && (
                      <div className={styles['note-fade']} onClick={() => toggleExpand(realIndex)}>▾ ver más</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles['panel-footer']}>
          <div className={styles['footer-title']}>Agregar nota manualmente</div>
          <input
            className={styles['title-input']}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (opcional)"
          />
          <textarea
            className={styles['content-input']}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Escribe aquí tu nota..."
          />
          <div className={styles['footer-actions']}>
            <button className={styles['save-btn']} onClick={handleSave}>💾 Guardar nota</button>
            <button className={styles['clear-btn']} onClick={handleClearAll} title="Eliminar todas las notas">🗑</button>
          </div>
        </div>
      </div>
    </>
  );
}
