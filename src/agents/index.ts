export { TestAgent } from "./test-agent.js";
export { CodeReviewAgent } from "./code-review-agent.js";

import { TestAgent } from "./test-agent.js";
import { CodeReviewAgent } from "./code-review-agent.js";
import type { MCPClient } from "../mcp/client.js";

export type AgentType = "dev" | "test" | "codereview";

export interface AgentInstance {
  name: string;
  description: string;
  agent: TestAgent | CodeReviewAgent | null;
}

export class AgentRegistry {
  private agents: Map<AgentType, AgentInstance> = new Map();
  private mcpClient: MCPClient | null = null;

  initialize(mcpClient: MCPClient): void {
    this.mcpClient = mcpClient;
    
    this.agents.set("dev", {
      name: "Dev Agent",
      description: "Agente general de desarrollo - tareas completas de coding",
      agent: null,
    });

    this.agents.set("test", {
      name: "Test Agent",
      description: "Genera tests unitarios, de integración y e2e",
      agent: new TestAgent(mcpClient),
    });

    this.agents.set("codereview", {
      name: "Code Review Agent",
      description: "Analiza código, detecta bugs, security issues y mejoras",
      agent: new CodeReviewAgent(mcpClient),
    });
  }

  get(type: AgentType): AgentInstance | undefined {
    return this.agents.get(type);
  }

  list(): { type: AgentType; name: string; description: string }[] {
    return Array.from(this.agents.entries()).map(([type, instance]) => ({
      type,
      name: instance.name,
      description: instance.description,
    }));
  }

  getAgent(type: AgentType): TestAgent | CodeReviewAgent | null {
    const instance = this.agents.get(type);
    return instance?.agent as TestAgent | CodeReviewAgent | null;
  }
}

export const agentRegistry = new AgentRegistry();
