import { useState, useCallback, useRef } from 'react';
import type { SSEEvent } from '../types';

interface UseSSEOptions {
  onTool?: (name: string, args: Record<string, unknown>) => void;
  onDone?: (content: string, iterations: number, toolCalls: number) => void;
  onError?: (message: string) => void;
  onProviderSwitch?: (from: string, reason: string) => void;
  onConfirm?: (id: string, toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

export function useSSE(options: UseSSEOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    if (isStreaming) return;
    
    setIsStreaming(true);
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          try {
            const event: SSEEvent = JSON.parse(line.slice(6));
            
            switch (event.type) {
              case 'tool':
                options.onTool?.(event.name!, event.args || {});
                break;
              case 'done':
                options.onDone?.(event.content || '', event.iterations || 0, event.toolCalls || 0);
                break;
              case 'error':
                options.onError?.(event.message || 'Unknown error');
                break;
              case 'providerSwitch':
                options.onProviderSwitch?.(event.from || '', event.reason || '');
                break;
              case 'confirm':
                if (event.id && event.toolName) {
                  const approved = await options.onConfirm?.(event.id, event.toolName, event.args || {});
                  await fetch('/chat/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: event.id, approved }),
                  });
                }
                break;
            }
          } catch (parseError) {
            console.error('Error parsing SSE event:', parseError);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        options.onError?.((error as Error).message);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [isStreaming, options]);

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return { sendMessage, isStreaming, abort };
}
