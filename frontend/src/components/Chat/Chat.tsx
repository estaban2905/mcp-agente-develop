import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useSSE } from '../../hooks/useSSE';
import styles from './Chat.module.css';
import inputStyles from './Input.module.css';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  model?: string;
  timestamp: Date;
}

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
}

interface ProviderSwitch {
  from: string;
  reason: string;
}

interface DoneMeta {
  iterations: number;
  toolCalls: number;
}

interface ChatProps {
  model: string;
  onRefreshStats: () => void;
  onOpenGit: () => void;
  onOpenNotes: () => void;
  notesCount: number;
  selectedAgent: string;
  agents: { id: string; name: string; description: string }[];
  onAgentChange: (agent: string) => void;
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📄',
  write_file: '✏️',
  list_directory: '📂',
  delete_file: '🗑️',
  create_directory: '📁',
  run_command: '⚡',
  git_init: '🌿',
  git_commit: '📝',
  git_status: '🔍',
  git_add: '➕',
  git_diff: '🔀',
  git_log: '📜',
  search_files: '🔎',
  search_code: '🔎',
  replace_in_file: '🔄',
  fetch_url: '🌐',
  http_request: '🌐',
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdown(text: string): string {
  const blocks: string[] = [];
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
    const idx = blocks.length;
    const langLabel = lang || 'code';
    blocks.push(
      `<div class="${styles['code-block']}"><div class="${styles['code-block-header']}"><span class="${styles['code-block-lang']}">${escHtml(langLabel)}</span><button class="${styles['code-copy-btn']}">Copiar</button></div><pre><code class="lang-${escHtml(lang)}">${escHtml(code.trim())}</code></pre></div>`
    );
    return `\x00BLOCK${idx}\x00`;
  });

  text = text.replace(/`([^`\n]+)`/g, (_: string, c: string) => `<code>${escHtml(c)}</code>`);
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

  const lines = text.split('\n');
  const out: string[] = [];
  let inList = false;

  for (const line of lines) {
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      if (inList) { out.push('</ul>'); inList = false; }
      const level = Math.min(hm[1].length + 3, 6);
      out.push(`<h${level} style="margin:8px 0 4px;font-size:${15 - hm[1].length}px">${hm[2]}</h${level}>`);
      continue;
    }
    const lm = line.match(/^(\s*[-*•]\s+)(.+)/);
    if (lm) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:18px;list-style:disc">'); inList = true; }
      out.push(`<li style="margin:2px 0">${lm[2]}</li>`);
      continue;
    }
    if (inList && line.trim() === '') { out.push('</ul>'); inList = false; }
    out.push(line);
  }
  if (inList) out.push('</ul>');
  text = out.join('\n');
  text = text.replace(/\x00BLOCK(\d+)\x00/g, (_: string, i: string) => blocks[parseInt(i)]);
  text = text.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">');

  return text;
}

let msgId = 0;
function createMsgId(): string {
  return `msg-${++msgId}`;
}

export function Chat({ model, onRefreshStats, onOpenGit, onOpenNotes, notesCount, selectedAgent, agents, onAgentChange }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [providerSwitch, setProviderSwitch] = useState<ProviderSwitch | null>(null);
  const [doneMeta, setDoneMeta] = useState<DoneMeta | null>(null);
  const [showTyping, setShowTyping] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, toolCalls, providerSwitch, doneMeta, showTyping, scrollToBottom]);

  const handleCopyCode = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const codeBlock = (e.target as HTMLButtonElement).closest(`.${styles['code-block']}`);
    const code = codeBlock?.querySelector('code')?.textContent;
    if (code) {
      navigator.clipboard.writeText(code);
      (e.target as HTMLButtonElement).textContent = '¡Copiado!';
      setTimeout(() => {
        (e.target as HTMLButtonElement).textContent = 'Copiar';
      }, 1800);
    }
  }, []);

  const { sendMessage } = useSSE({
    onTool: (name, args) => {
      const id = `tool-${Date.now()}`;
      setToolCalls(prev => [...prev, { id, name, args, status: 'running' }]);
      setShowTyping(false);
      setTimeout(() => {
        setToolCalls(prev => prev.map(tc => tc.id === id ? { ...tc, status: 'done' } : tc));
        setShowTyping(true);
      }, 100);
    },
    onDone: (content, iterations, toolCallsCount) => {
      setShowTyping(false);
      setMessages(prev => [...prev, {
        id: createMsgId(),
        role: 'agent',
        content,
        model,
        timestamp: new Date(),
      }]);
      setDoneMeta({ iterations, toolCalls: toolCallsCount });
      onRefreshStats();
    },
    onError: (message) => {
      setShowTyping(false);
      setMessages(prev => [...prev, {
        id: createMsgId(),
        role: 'agent',
        content: `❌ ${escHtml(message)}`,
        timestamp: new Date(),
      }]);
    },
    onProviderSwitch: (from, reason) => {
      setShowTyping(false);
      setProviderSwitch({ from, reason });
      setShowTyping(true);
    },
  });

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    setShowTyping(true);
    setToolCalls([]);
    setProviderSwitch(null);
    setDoneMeta(null);

    setMessages(prev => [...prev, {
      id: createMsgId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }]);

    await sendMessage(text);
    setIsStreaming(false);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }, [handleSubmit]);

  const handleClearHistory = useCallback(async () => {
    await api.clear();
    setMessages([]);
    setToolCalls([]);
    setProviderSwitch(null);
    setDoneMeta(null);
    onRefreshStats();
  }, [onRefreshStats]);

  const handleShowTools = useCallback(async () => {
    const tools = await api.getTools();
    const list = tools.map((t: { name: string; description?: string }) => `• <strong>${t.name}</strong>: ${escHtml(t.description || '').substring(0, 60)}`).join('\n');
    setMessages(prev => [...prev, {
      id: createMsgId(),
      role: 'agent',
      content: `📋 <strong>Herramientas disponibles (${tools.length})</strong>\n\n${list}`,
      model,
      timestamp: new Date(),
    }]);
  }, [model]);

  const handleShowStats = useCallback(async () => {
    const s = await api.getStats();
    setMessages(prev => [...prev, {
      id: createMsgId(),
      role: 'agent',
      content: `📊 <strong>Estadísticas de Sesión</strong>\n\n` +
        `• <strong>Modelo:</strong> ${escHtml(s.model)}\n` +
        `• <strong>Proveedor:</strong> ${escHtml(s.provider)}\n` +
        `• <strong>Mensajes:</strong> ${s.messages}\n` +
        `• <strong>Iteraciones:</strong> ${s.iterations}\n` +
        `• <strong>Tool calls:</strong> ${s.toolCalls}`,
      model,
      timestamp: new Date(),
    }]);
  }, [model]);

  const handleSaveAsNote = useCallback(async () => {
    const bubbles = document.querySelectorAll(`.${styles.msg}.${styles.agent} .${styles.bubble}`);
    const lastBubble = bubbles[bubbles.length - 1];
    const content = lastBubble?.textContent?.trim();
    if (!content) return;

    const title = `Respuesta del agente — ${new Date().toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`;
    await api.saveNote(content, title);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = inputRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    }
  }, []);

  return (
    <>
      <div className={styles.chat} ref={chatRef} onClick={(e) => {
        const btn = (e.target as HTMLElement).closest(`.${styles['code-copy-btn']}`);
        if (btn) handleCopyCode(e as unknown as React.MouseEvent<HTMLButtonElement>);
      }}>
        {messages.map((msg) => (
          <div key={msg.id} className={`${styles.msg} ${styles[msg.role]}`}>
            <div className={styles['msg-avatar']}>
              {msg.role === 'user' ? '🧑' : '🤖'}
            </div>
            <div className={styles['msg-content']}>
              <div className={styles['msg-meta']}>
                {msg.role === 'user' ? (
                  <span className={styles['msg-time']}>{formatTime(msg.timestamp)}</span>
                ) : msg.model ? (
                  <>
                    <span className={styles['msg-model']}>{msg.model}</span>
                    <span className={styles['msg-time']}>{formatTime(msg.timestamp)}</span>
                  </>
                ) : null}
              </div>
              <div
                className={styles.bubble}
                dangerouslySetInnerHTML={{ __html: msg.role === 'agent' ? renderMarkdown(msg.content) : escHtml(msg.content) }}
              />
            </div>
          </div>
        ))}

        {toolCalls.map((tc) => (
          <div key={tc.id} className={styles['tool-call']}>
            <div className={styles['tool-call-header']}>
              <div className={styles['tool-icon']}>{TOOL_ICONS[tc.name] || '⚙️'}</div>
              <div className={styles['tool-info']}>
                <span className={styles['tool-name']}>{escHtml(tc.name)}</span>
                <span className={styles['tool-args-preview']}>
                  {Object.entries(tc.args || {}).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(', ')}
                </span>
              </div>
              <span className={`${styles['tool-status']} ${styles[tc.status === 'done' ? 'done' : tc.status === 'error' ? 'error' : 'running']}`}>
                {tc.status === 'done' ? 'hecho' : tc.status === 'error' ? 'error' : 'ejecutando'}
              </span>
              <span className={styles['tool-expand-icon']}>▶</span>
            </div>
            <div className={styles['tool-args-body']}>
              {JSON.stringify(tc.args, null, 2)}
            </div>
          </div>
        ))}

        {providerSwitch && (
          <div className={styles['provider-switch']}>
            <div className={styles['provider-switch-row']}>
              <span>🔄</span>
              <span className={styles['ps-label']}>Cambio de proveedor</span>
            </div>
            <div className={styles['provider-switch-row']}>
              <span className={styles['ps-from']}>{escHtml(providerSwitch.from)}</span>
              <span className={styles['ps-arrow']}>→</span>
              <span className={styles['ps-to']}>{escHtml(providerSwitch.reason)}</span>
            </div>
          </div>
        )}

        {doneMeta && (
          <div className={styles['done-meta']}>
            <span>✅ Completado</span>
            <span className={styles['dm-sep']}>·</span>
            <span>⟳ {doneMeta.iterations} iter.</span>
            <span className={styles['dm-sep']}>·</span>
            <span>🔧 {doneMeta.toolCalls} tools</span>
            <span className={styles['dm-sep']}>·</span>
            <button className={styles['save-note-btn']} onClick={handleSaveAsNote} title="Guardar respuesta como nota del proyecto">📝 Guardar nota</button>
          </div>
        )}

        {showTyping && (
          <div className={`${styles.msg} ${styles.agent}`}>
            <div className={styles['msg-avatar']}>🤖</div>
            <div className={styles['msg-content']}>
              <div className={`${styles.bubble} ${styles['thinking-bubble']}`}>
                <div className={styles['thinking-indicator']}>
                  <div className={styles['thinking-wave']}>
                    <span></span><span></span><span></span><span></span><span></span>
                  </div>
                  <span className={styles['thinking-label']}>Pensando...</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className={inputStyles['chat-footer']}>
        <div className={inputStyles['agent-selector']}>
          <label htmlFor="agent-select" style={{ marginRight: '8px', fontSize: '12px', color: 'var(--text-dim)' }}>Agente:</label>
          <select
            id="agent-select"
            value={selectedAgent}
            onChange={(e) => onAgentChange(e.target.value)}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <form className={inputStyles['input-wrapper']} onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className={inputStyles.input}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe tu tarea de desarrollo... (Enter para enviar, Shift+Enter para nueva línea)"
            rows={1}
            disabled={isStreaming}
          />
          <button type="submit" className={inputStyles['send-btn']} disabled={isStreaming || !input.trim()}>
            Enviar
          </button>
        </form>
        <div className={inputStyles.actions}>
          <button className={inputStyles['action-btn']} onClick={handleClearHistory}>🗑️ Limpiar</button>
          <button className={inputStyles['action-btn']} onClick={handleShowTools}>🔧 Herramientas</button>
          <button className={inputStyles['action-btn']} onClick={handleShowStats}>📊 Stats</button>
          <button className={inputStyles['action-btn']} onClick={onOpenGit}>🌿 Git</button>
          <button className={inputStyles['action-btn']} onClick={onOpenNotes}>
            📝 Notas
            {notesCount > 0 && (
              <span style={{
                background: 'var(--teal)',
                color: '#000',
                borderRadius: '8px',
                padding: '0 5px',
                fontSize: '9px',
                fontWeight: 700,
                marginLeft: '2px',
              }}>
                {notesCount}
              </span>
            )}
          </button>
        </div>
      </footer>
    </>
  );
}
