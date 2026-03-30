import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Chat } from './components/Chat';
import { GitPanel } from './components/GitPanel';
import { NotesPanel } from './components/NotesPanel';
import { Aside } from './components/Aside';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { api } from './api/client';
import type { Stats, Tool, ProviderConfig, ProviderInfo, ChatMessage, ConfirmEvent, Agent } from './types';
import './styles/global.css';

const CHAT_HISTORY_KEY = 'mcp-chat-history';
const CHAT_WORKSPACE_KEY = 'mcp-chat-workspace';

export type AgentType = 'dev' | 'test' | 'codereview';

export function App() {
  const [asideOpen, setAsideOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providerInfos, setProviderInfos] = useState<Map<number, ProviderInfo>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [notesCount, setNotesCount] = useState(0);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmEvent | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('dev');
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);

  useEffect(() => {
    const init = async () => {
      try {
        const [{ path }, initialStats, toolsData, providersData, agentsData] = await Promise.all([
          api.getWorkspace(),
          api.getStats(),
          api.getTools(),
          api.getProviders(),
          api.getAgents(),
        ]);

        setWorkspace(path);
        setStats(initialStats);
        setCurrentModel(initialStats.model || '');
        setCurrentProvider(initialStats.provider || '');
        setTools(toolsData);
        setProviders(providersData.providers || []);
        setAvailableAgents(agentsData);

        if (initialStats.providers) {
          const map = new Map<number, ProviderInfo>();
          initialStats.providers.forEach((p: ProviderInfo) => {
            const m = p.name.match(/^provider-(\d+)/);
            if (m) map.set(parseInt(m[1]) - 1, p);
          });
          setProviderInfos(map);
        }

        const savedWorkspace = localStorage.getItem(CHAT_WORKSPACE_KEY);
        if (savedWorkspace === path) {
          const history = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || '[]');
          if (history.length > 0) {
            setMessages(history.map((m: { role: string; html: string; meta: { model?: string }; timestamp: number }) => ({
              id: `restored-${m.timestamp}`,
              role: m.role as 'user' | 'agent',
              content: m.html,
              model: m.meta?.model,
              timestamp: m.timestamp,
            })));
            setChatLoaded(true);
          }
        }
        localStorage.setItem(CHAT_WORKSPACE_KEY, path);

        const { content } = await api.getNotes();
        const notes = parseNotes(content || '');
        setNotesCount(notes.length);
      } catch (err) {
        console.error('Init error:', err);
      }
    };

    init();

    const pollInterval = setInterval(async () => {
      if (!isBusy) {
        try {
          const newStats = await api.getStats();
          setStats(newStats);
          setCurrentModel(newStats.model || '');
          setCurrentProvider(newStats.provider || '');
          if (newStats.providers) {
            const map = new Map<number, ProviderInfo>();
            newStats.providers.forEach((p: ProviderInfo) => {
              const m = p.name.match(/^provider-(\d+)/);
              if (m) map.set(parseInt(m[1]) - 1, p);
            });
            setProviderInfos(map);
          }
        } catch {}
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [isBusy]);

  const parseNotes = (raw: string) => {
    if (!raw.trim()) return [];
    const notes: { title: string; date: string; body: string }[] = [];
    const sections = raw.split(/\n---\n/).filter(s => s.trim());
    for (const section of sections) {
      const titleMatch = section.match(/^##\s+(.+)/m);
      const dateMatch = section.match(/^\*(.+)\*$/m);
      const bodyLines = section.split('\n').filter(l => !l.startsWith('##') && !l.match(/^\*.+\*$/) && l.trim());
      notes.push({
        title: titleMatch ? titleMatch[1].trim() : 'Nota',
        date: dateMatch ? dateMatch[1].trim() : '',
        body: bodyLines.join('\n').trim(),
      });
    }
    return notes.filter(n => n.body);
  };

  const handleWorkspaceChange = useCallback((newPath: string) => {
    setWorkspace(newPath);
    setMessages([]);
    localStorage.removeItem(CHAT_HISTORY_KEY);
    const welcomeMsg: ChatMessage = {
      id: `welcome-${Date.now()}`,
      role: 'agent',
      content: `✅ Workspace cambiado a <code>${newPath}</code>\nHistorial limpiado. ¿En qué puedo ayudarte?`,
      model: currentModel,
      timestamp: Date.now(),
    };
    setMessages([welcomeMsg]);
    setChatLoaded(true);
    localStorage.setItem(CHAT_WORKSPACE_KEY, newPath);
  }, [currentModel]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isBusy) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsBusy(true);

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, agent: selectedAgent }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const typingMsg: ChatMessage = {
        id: `typing-${Date.now()}`,
        role: 'agent',
        content: '',
        isTyping: true,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, typingMsg]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === 'tool') {
            setMessages(prev => prev.filter(m => !m.isTyping));
            const toolMsg: ChatMessage = {
              id: `tool-${Date.now()}-${Math.random()}`,
              role: 'agent',
              content: '',
              isToolCall: true,
              toolCall: {
                id: `tool-${Date.now()}`,
                name: event.name,
                args: event.args,
                status: 'done',
              },
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, toolMsg]);
            const newTypingMsg: ChatMessage = {
              id: `typing-${Date.now()}`,
              role: 'agent',
              content: '',
              isTyping: true,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, newTypingMsg]);

          } else if (event.type === 'providerSwitch') {
            setMessages(prev => prev.filter(m => !m.isTyping));
            const switchMsg: ChatMessage = {
              id: `switch-${Date.now()}`,
              role: 'agent',
              content: '',
              isProviderSwitch: true,
              providerSwitch: { from: event.from, to: event.reason },
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, switchMsg]);
            const newTypingMsg: ChatMessage = {
              id: `typing-${Date.now()}`,
              role: 'agent',
              content: '',
              isTyping: true,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, newTypingMsg]);

            const newStats = await api.getStats();
            setStats(newStats);
            setCurrentModel(newStats.model || '');
            setCurrentProvider(newStats.provider || '');

          } else if (event.type === 'done') {
            setMessages(prev => prev.filter(m => !m.isTyping));
            const agentMsg: ChatMessage = {
              id: `agent-${Date.now()}`,
              role: 'agent',
              content: event.content,
              model: currentModel,
              doneMeta: { iterations: event.iterations, toolCalls: event.toolCalls },
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, agentMsg]);
            const newStats = await api.getStats();
            setStats(newStats);

          } else if (event.type === 'confirm') {
            setMessages(prev => prev.filter(m => !m.isTyping));
            setPendingConfirm({
              id: event.id,
              toolName: event.toolName,
              args: event.args,
            });
            const newTypingMsg: ChatMessage = {
              id: `typing-${Date.now()}`,
              role: 'agent',
              content: '',
              isTyping: true,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, newTypingMsg]);

          } else if (event.type === 'error') {
            setMessages(prev => prev.filter(m => !m.isTyping));
            const errorMsg: ChatMessage = {
              id: `error-${Date.now()}`,
              role: 'agent',
              content: `❌ ${event.message}`,
              isError: true,
              timestamp: Date.now(),
            };
            setMessages(prev => [...prev, errorMsg]);
          }
        }
      }

      const newStats = await api.getStats();
      setStats(newStats);
    } catch (err: any) {
      setMessages(prev => prev.filter(m => !m.isTyping));
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'agent',
        content: `❌ Error de conexión: ${err.message}`,
        isError: true,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, currentModel]);

  const handleConfirm = useCallback(async (approved: boolean) => {
    if (!pendingConfirm) return;
    await fetch('/chat/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingConfirm.id, approved }),
    });
    setPendingConfirm(null);
  }, [pendingConfirm]);

  const handleClearHistory = useCallback(async () => {
    await api.clear();
    setMessages([]);
    localStorage.removeItem(CHAT_HISTORY_KEY);
    const welcomeMsg: ChatMessage = {
      id: `welcome-${Date.now()}`,
      role: 'agent',
      content: 'Historial limpiado. ¿En qué puedo ayudarte?',
      model: currentModel,
      timestamp: Date.now(),
    };
    setMessages([welcomeMsg]);
    const newStats = await api.getStats();
    setStats(newStats);
  }, [currentModel]);

  const handleShowTools = useCallback(async () => {
    const toolsData = await api.getTools();
    const list = toolsData.map((t: Tool) => `• <strong>${t.name}</strong>: ${(t.description || '').substring(0, 60)}`).join('\n');
    const msg: ChatMessage = {
      id: `tools-${Date.now()}`,
      role: 'agent',
      content: `📋 <strong>Herramientas disponibles (${toolsData.length})</strong>\n\n${list}`,
      model: currentModel,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
  }, [currentModel]);

  const handleShowStats = useCallback(async () => {
    const statsData = await api.getStats();
    const msg: ChatMessage = {
      id: `stats-${Date.now()}`,
      role: 'agent',
      content: `📊 <strong>Estadísticas de Sesión</strong>\n\n` +
        `• <strong>Modelo:</strong> ${statsData.model}\n` +
        `• <strong>Proveedor:</strong> ${statsData.provider}\n` +
        `• <strong>Mensajes:</strong> ${statsData.messages}\n` +
        `• <strong>Iteraciones:</strong> ${statsData.iterations}\n` +
        `• <strong>Tool calls:</strong> ${statsData.toolCalls}`,
      model: currentModel,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
  }, [currentModel]);

  const handleSaveProviders = useCallback(async (newProviders: ProviderConfig[]) => {
    setProviders(newProviders);
    await api.saveProviders(newProviders);
    const newStats = await api.getStats();
    setStats(newStats);
  }, []);

  const handleNotesUpdate = useCallback(async () => {
    const { content } = await api.getNotes();
    const notes = parseNotes(content || '');
    setNotesCount(notes.length);
  }, []);

  return (
    <div className="app-container">
      <div className="main-area">
        <Header
          isBusy={isBusy}
          workspace={workspace}
          model={currentModel}
          provider={currentProvider}
          onOpenWorkspace={() => setWorkspaceOpen(true)}
          onToggleAside={() => setAsideOpen(prev => !prev)}
        />
        <Chat
          model={currentModel}
          selectedAgent={selectedAgent}
          agents={availableAgents}
          onAgentChange={(agent) => {
            setSelectedAgent(agent as AgentType);
            setMessages([]);
          }}
          onRefreshStats={async () => {
            const newStats = await api.getStats();
            setStats(newStats);
          }}
          onOpenGit={() => {}}
          onOpenNotes={() => {}}
          notesCount={notesCount}
        />
      </div>
      <Aside
        isOpen={asideOpen}
        stats={stats}
        tools={tools}
        workspace={workspace}
        onClose={() => setAsideOpen(false)}
      />
      <GitPanel isOpen={false} onClose={() => {}} />
      <NotesPanel isOpen={false} onClose={() => {}} onCountChange={() => {}} />
      <WorkspaceSelector
        isOpen={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        onWorkspaceChange={handleWorkspaceChange}
      />
    </div>
  );
}

export default App;
