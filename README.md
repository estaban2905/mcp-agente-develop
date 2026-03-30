# 🤖 MCP Dev Agent

**Agente de desarrollo de software autónomo construido sobre Model Context Protocol (MCP)**

Utiliza el SDK oficial de MCP para exponer herramientas de filesystem, terminal y git que un modelo de lenguaje puede usar para planificar, escribir y ejecutar código de forma autónoma.

Soporta **múltiples proveedores de IA con rotación automática**: si un proveedor alcanza su rate limit o falla, el agente cambia automáticamente al siguiente sin interrumpir la tarea.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP DEV AGENT                            │
│                                                                 │
│  ┌──────────────┐    stdio     ┌──────────────────────────────┐ │
│  │  MCP CLIENT  │◄────────────►│       MCP SERVER             │ │
│  │              │   transport  │  (@modelcontextprotocol/sdk) │ │
│  │  Descubre    │              │                              │ │
│  │  y llama     │              │  Tools registradas:          │ │
│  │  tools       │              │  • read_file                 │ │
│  └──────┬───────┘              │  • write_file                │ │
│         │                     │  • list_directory            │ │
│         │ tools como          │  • delete_file               │ │
│         │ OpenAI functions    │  • create_directory          │ │
│         ▼                     │  • run_command               │ │
│  ┌──────────────┐              │  • git_init / status         │ │
│  │  DEV AGENT   │              │  • git_add / commit / log    │ │
│  │              │              └──────────────┬───────────────┘ │
│  │  Agent Loop: │                             │                 │
│  │  1. LLM call │                             │ ejecuta sobre   │
│  │  2. Tool Call│                             ▼                 │
│  │  3. Resultado│              ┌──────────────────────────────┐ │
│  │  4. Repeat   │              │         WORKSPACE            │ │
│  └──────┬───────┘              │   ./workspace/               │ │
│         │                     │   (sandbox seguro)           │ │
│         ▼                     └──────────────────────────────┘ │
│  ┌──────────────┐                                               │
│  │  CLI / USER  │  ◄── Interfaz interactiva                    │
│  └──────────────┘                                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              PROVIDER REGISTRY (rotación automática)     │   │
│  │                                                          │   │
│  │  [1] Groq — llama-3.3-70b-versatile   ← principal       │   │
│  │  [2] Groq — llama-3.1-8b-instant      ← fallback rápido │   │
│  │  [3] Cerebras — qwen-3-235b           ← razonamiento     │   │
│  │  [4] OpenAI — gpt-4.1                 ← alta calidad     │   │
│  │  [5] OpenAI — gpt-4.1-mini            ← económico        │   │
│  │  [6] OpenAI — o4-mini                 ← razonamiento     │   │
│  │  [7] Ollama Cloud — devstral-small-2  ← código           │   │
│  │  [8] Anthropic — claude-sonnet-4-6    ← último recurso   │   │
│  │                                                          │   │
│  │  Circuit Breaker: si un proveedor falla N veces,         │   │
│  │  se desactiva temporalmente y se reactiva solo.          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de comunicación

1. **Usuario** escribe una tarea en el CLI
2. **DevAgent** envía el mensaje + tools disponibles al **proveedor activo**
3. El **LLM** decide qué tools llamar y con qué argumentos
4. **MCPClient** recibe la tool call y la envía al **MCP Server** via stdio
5. **MCP Server** ejecuta la tool real (lee archivo, escribe, ejecuta comando...)
6. El resultado vuelve al **LLM** como contexto
7. El loop continúa hasta que el agente termina la tarea
8. Si el proveedor falla (rate limit, error 5xx, timeout), el **Provider Registry** rota automáticamente al siguiente

---

## Proveedores de IA soportados

El sistema soporta hasta **10 proveedores simultáneos** mediante sufijos numéricos (`AI_API_KEY`, `AI_API_KEY_2`, ..., `AI_API_KEY_10`). Todos exponen una API compatible con el formato OpenAI (`/chat/completions`).

### Groq

**Modelos usados:** `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`

Groq ofrece inferencia ultra-rápida (LPU) con modelos open-source. Tiene un **plan gratuito generoso** con límites por minuto/día.

| | |
|---|---|
| Crear cuenta | [console.groq.com](https://console.groq.com) |
| API Keys | [console.groq.com/keys](https://console.groq.com/keys) |
| Modelos disponibles | [console.groq.com/docs/models](https://console.groq.com/docs/models) |
| Precios | [groq.com/pricing](https://groq.com/pricing) |
| Formato de key | `gsk_...` |

```env
AI_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile
```

---

### Cerebras

**Modelo usado:** `qwen-3-235b-a22b-instruct-2507`

Cerebras ofrece inferencia muy rápida con chips WSE. El modelo Qwen-3 235B es de razonamiento avanzado. Tiene **plan gratuito**.

| | |
|---|---|
| Crear cuenta | [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| API Keys | [cloud.cerebras.ai/platform/api-keys](https://cloud.cerebras.ai/platform/api-keys) |
| Modelos disponibles | [inference-docs.cerebras.ai/models](https://inference-docs.cerebras.ai/models) |
| Precios | [cerebras.ai/pricing](https://cerebras.ai/pricing) |
| Formato de key | `csk-...` |

```env
AI_API_KEY_3=csk_xxxxxxxxxxxxxxxxxxxx
AI_BASE_URL_3=https://api.cerebras.ai/v1
AI_MODEL_3=qwen-3-235b-a22b-instruct-2507
```

---

### OpenAI

**Modelos usados:** `gpt-4.1`, `gpt-4.1-mini`, `o4-mini`

La API de OpenAI. Servicio de pago (requiere créditos). Los modelos `o4-mini` son de razonamiento y no aceptan `max_tokens`, el sistema lo detecta automáticamente.

| | |
|---|---|
| Crear cuenta | [platform.openai.com](https://platform.openai.com) |
| API Keys | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Modelos disponibles | [platform.openai.com/docs/models](https://platform.openai.com/docs/models) |
| Precios | [openai.com/pricing](https://openai.com/pricing) |
| Formato de key | `sk-proj-...` |

```env
AI_API_KEY_4=sk-proj-xxxxxxxxxxxxxxxxxxxx
AI_MODEL_4=gpt-4.1

AI_API_KEY_5=sk-proj-xxxxxxxxxxxxxxxxxxxx
AI_MODEL_5=gpt-4.1-mini

AI_API_KEY_6=sk-proj-xxxxxxxxxxxxxxxxxxxx
AI_MODEL_6=o4-mini
```

> **Nota:** `gpt-4.1` y `gpt-4.1-mini` son los modelos más recientes de la familia GPT-4 (más capaces y eficientes que `gpt-4o`). `o4-mini` es un modelo de razonamiento encadenado (chain-of-thought) especialmente bueno para tareas de código y matemáticas.

---

### Ollama Cloud

**Modelo usado:** `devstral-small-2:24b`

Devstral es un modelo especializado en código desarrollado por Mistral AI para agentes de software. Ollama permite correrlo localmente o usar su cloud.

| | |
|---|---|
| Crear cuenta (cloud) | [ollama.com](https://ollama.com) |
| API Keys | [ollama.com/settings/api-keys](https://ollama.com/settings/api-keys) |
| Modelos disponibles | [ollama.com/library](https://ollama.com/library) |
| Uso local (gratis) | [ollama.com/download](https://ollama.com/download) |
| Formato de key | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.xxxxxxxxxx` |

```env
AI_API_KEY_7=xxxxxxxx.xxxxxxxxxx
AI_BASE_URL_7=https://ollama.com/v1
AI_MODEL_7=devstral-small-2:24b
```

> **Nota:** Para uso **local** cambia `AI_BASE_URL_7=http://localhost:11434/v1` y pon cualquier valor en `AI_API_KEY_7` (Ollama local no requiere key). Ejecuta `ollama pull devstral-small-2` antes.

---

### Anthropic (Claude)

**Modelo usado:** `claude-sonnet-4-6`

La API de Anthropic requiere headers adicionales (`anthropic-version`, `anthropic-beta`). El sistema los configura automáticamente via `AI_HEADERS_N`. Es un servicio de pago.

| | |
|---|---|
| Crear cuenta | [console.anthropic.com](https://console.anthropic.com) |
| API Keys | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| Modelos disponibles | [docs.anthropic.com/en/docs/about-claude/models](https://docs.anthropic.com/en/docs/about-claude/models) |
| Precios | [anthropic.com/pricing](https://anthropic.com/pricing) |
| Formato de key | `sk-ant-api03-...` |

```env
AI_API_KEY_8=sk-ant-api03-xxxxxxxxxxxxxxxxxxxx
AI_BASE_URL_8=https://api.anthropic.com/v1
AI_MODEL_8=claude-sonnet-4-6
AI_HEADERS_8={"anthropic-version":"2023-06-01","anthropic-beta":"tools-2024-04-04"}
```

> **Importante:** Los headers en `AI_HEADERS_N` deben ser JSON válido en una sola línea.

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js ≥ 18 (ES Modules + TypeScript) |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.10.2 |
| IA / LLM | Multi-proveedor: Groq, Cerebras, OpenAI, Ollama, Anthropic |
| Schema validation | `zod` |
| CLI | `readline` nativo + `chalk` |
| Transport | stdio (subprocess) |
| Resiliencia | Circuit Breaker + Round-Robin fallback |

---

## Requisitos previos

- **Node.js** 18 o superior
- **npm** 8 o superior
- Al menos **una API key** de cualquier proveedor soportado (ver sección anterior)
- **git** instalado (opcional, para tools de git)

No necesitas configurar todos los proveedores. Con uno solo el agente funciona. Agregar más proveedores mejora la disponibilidad y reduce interrupciones por rate limiting.

---

## Instalación y configuración

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env`. Configuración mínima con un solo proveedor:

```env
# Proveedor único (mínimo requerido)
AI_API_KEY=gsk_tu-api-key-de-groq
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile

WORKSPACE_DIR=./workspace
```

Configuración recomendada con múltiples proveedores para máxima disponibilidad:

```env
# Proveedor 1 — Groq (principal, gratuito)
AI_API_KEY=gsk_xxxx
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=llama-3.3-70b-versatile

# Proveedor 2 — Groq modelo ligero (fallback rápido)
AI_API_KEY_2=gsk_xxxx
AI_BASE_URL_2=https://api.groq.com/openai/v1
AI_MODEL_2=llama-3.1-8b-instant

# Proveedor 3 — Cerebras (gratuito, razonamiento)
AI_API_KEY_3=csk_xxxx
AI_BASE_URL_3=https://api.cerebras.ai/v1
AI_MODEL_3=qwen-3-235b-a22b-instruct-2507

# Proveedor 4 — OpenAI gpt-4.1 (pago)
AI_API_KEY_4=sk-proj-xxxx
AI_MODEL_4=gpt-4.1

WORKSPACE_DIR=./workspace
```

### 3. Ejecutar el agente

```bash
npm start
```

---

## Uso

### CLI Interactivo

Al ejecutar `npm start` se abre un CLI interactivo:

```
🤖  MCP Dev Agent  v1.0.0

🧑 Tú › Crea una API REST de usuarios con Express
```

El agente planificará, creará archivos, instalará dependencias y ejecutará comandos de forma autónoma.

### Comandos especiales del CLI

| Comando | Descripción |
|---|---|
| `/tools` | Lista todas las herramientas disponibles |
| `/stats` | Estadísticas de la sesión actual |
| `/providers` | Estado de todos los proveedores (activo, fallos, circuit breaker) |
| `/clear` | Limpia el historial de conversación |
| `/demo` | Ejecuta la demo: crear API de usuarios |
| `/exit` | Salir del programa |

### Demo automática

```bash
npm run demo
```

Ejecuta automáticamente la tarea: **"Crear API REST de usuarios completa"** sin necesitar input del usuario.

---

## Herramientas disponibles (MCP Tools)

### Filesystem

| Tool | Descripción | Parámetros |
|---|---|---|
| `read_file` | Lee un archivo | `path` |
| `write_file` | Escribe/crea un archivo | `path`, `content`, `create_dirs?` |
| `list_directory` | Lista un directorio | `path?`, `recursive?` |
| `delete_file` | Elimina un archivo | `path` |
| `create_directory` | Crea un directorio | `path` |

### Terminal

| Tool | Descripción | Parámetros |
|---|---|---|
| `run_command` | Ejecuta un comando shell | `command`, `cwd?`, `timeout?` |

### Git

| Tool | Descripción | Parámetros |
|---|---|---|
| `git_init` | Inicializa un repositorio | `path?` |
| `git_status` | Estado del repo | `path?` |
| `git_add` | Agrega al staging | `path?`, `files?` |
| `git_commit` | Hace un commit | `path?`, `message` |
| `git_log` | Historial de commits | `path?`, `limit?` |

---

## Ejemplo funcional: "Crea una API de usuarios"

**Input del usuario:**
```
Crea una API REST de usuarios completa con Express
```

**Lo que hace el agente:**

1. **Planifica** la estructura del proyecto
2. **Crea** la carpeta `users-api/`
3. **Escribe** `package.json` con dependencias
4. **Escribe** `index.js` con servidor Express
5. **Escribe** `src/routes/users.js` con CRUD completo
6. **Escribe** `src/middleware/validation.js`
7. **Ejecuta** `npm install` dentro de `users-api/`
8. **Verifica** la estructura con `list_directory`
9. **Inicializa** git y hace el primer commit
10. **Escribe** `README.md` con instrucciones
11. **Reporta** un resumen de lo hecho

**Output generado:**
```
workspace/
└── users-api/
    ├── index.js
    ├── package.json
    ├── README.md
    └── src/
        ├── routes/
        │   └── users.js
        └── middleware/
            └── validation.js
```

---

## Seguridad

El agente implementa las siguientes protecciones:

- **Path traversal prevention**: Todos los paths se validan contra el workspace
- **Command blacklist**: Comandos peligrosos (`rm -rf /`, `sudo`, `shutdown`...) están bloqueados
- **File size limit**: Máximo 10 MB por archivo
- **Timeout**: Comandos terminados automáticamente después de 30s
- **Max iterations**: El agent loop se detiene después de N iteraciones (configurable)

---

## Variables de entorno

### Variables del sistema

| Variable | Default | Descripción |
|---|---|---|
| `WORKSPACE_DIR` | `./workspace` | Directorio de trabajo del agente |
| `LOG_LEVEL` | `info` | Nivel de logs: `debug` / `info` / `warn` / `error` |
| `MAX_ITERATIONS` | `30` | Máximo de iteraciones del agent loop |
| `MAX_RESULT_CHARS` | `6000` | Límite de caracteres por resultado de tool |
| `COMMAND_TIMEOUT` | `30000` | Timeout de comandos en ms |
| `BLOCKED_COMMANDS` | (lista interna) | Comandos adicionales a bloquear (separados por coma) |
| `MCP_SERVER_PORT` | `3001` | Puerto del servidor MCP si se usa HTTP transport |

### Variables de proveedores de IA

Se pueden configurar hasta 10 proveedores con sufijos `_2`, `_3`, ..., `_10`. El proveedor 1 no lleva sufijo.

| Variable | Descripción |
|---|---|
| `AI_API_KEY` | API key del proveedor 1 (obligatoria al menos una) |
| `AI_BASE_URL` | URL base de la API (opcional si es OpenAI nativo) |
| `AI_MODEL` | Nombre del modelo a usar |
| `AI_HEADERS` | Headers adicionales en formato JSON (ej. para Anthropic) |
| `AI_API_KEY_2` | API key del proveedor 2 |
| `AI_BASE_URL_2` | URL base del proveedor 2 |
| `AI_MODEL_2` | Modelo del proveedor 2 |
| `AI_API_KEY_N` | API key del proveedor N (hasta N=10) |

> Las variables `OPENAI_API_KEY` y `OPENAI_MODEL` también son reconocidas como alias del proveedor 1 para compatibilidad.

---

## Cómo funciona la rotación de proveedores

El **Provider Registry** implementa:

1. **Round-robin**: Cada llamada exitosa avanza al siguiente proveedor en la lista.
2. **Fallback automático**: Si el proveedor activo falla (rate limit 429, error 5xx, timeout, contexto grande 413), se intenta el siguiente.
3. **Circuit Breaker**: Si un proveedor falla N veces consecutivas, se desactiva temporalmente y el sistema lo vuelve a intentar pasado un tiempo configurable.
4. **Detección de errores no rotatables**: Un error 401 (API key inválida) detiene el proceso inmediatamente en ese proveedor en vez de rotar silenciosamente.
5. **Soporte de modelos de razonamiento**: Los modelos `o1`, `o3`, `o4-*` se detectan automáticamente y no reciben el parámetro `max_tokens` que causaría error.

---

## Estructura del proyecto

```
mcp-dev-agent/
├── src/
│   ├── index.ts              # CLI interactiva y punto de entrada
│   ├── config/
│   │   └── index.ts          # Carga de configuración y env vars
│   ├── agent/
│   │   └── agent.ts          # DevAgent: agent loop + integración LLM
│   ├── mcp/
│   │   ├── server.ts         # MCP Server oficial con todas las tools
│   │   └── client.ts         # MCP Client: conecta y llama al server
│   ├── providers/
│   │   └── registry.ts       # Provider Registry: rotación + circuit breaker
│   ├── tools/
│   │   ├── filesystem.ts     # read_file, write_file, list_directory...
│   │   ├── terminal.ts       # run_command
│   │   └── git.ts            # git_init, git_status, git_add, git_commit...
│   ├── types/
│   │   └── index.ts          # Tipos TypeScript compartidos
│   └── utils/
│       ├── logger.ts         # Logger con niveles y colores
│       └── security.ts       # Validaciones de paths y comandos
├── workspace/                # Directorio donde el agente trabaja (gitignored)
├── .env.example
├── .env                      # Tu configuración local (no commitear)
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Solución de problemas

### Error: No hay proveedores configurados
Asegúrate de tener al menos `AI_API_KEY` configurado en `.env`.

### Error: API Key inválida en provider-N
El sistema detecta errores 401 y para inmediatamente. Verifica que la key del proveedor N sea correcta y no haya expirado.

### El agente rota proveedores constantemente
Todos los proveedores están alcanzando sus rate limits. Agrega más proveedores o reduce la frecuencia de uso. Ejecuta `/providers` en el CLI para ver el estado de cada uno.

### Error: Cannot find module '@modelcontextprotocol/sdk'
Ejecuta `npm install` para instalar las dependencias.

### El agente no termina / bucle infinito
Aumenta `MAX_ITERATIONS` en `.env` o simplifica la tarea. El límite por defecto es 30 iteraciones.

### Comando bloqueado por seguridad
Los comandos destructivos están bloqueados por diseño. Puedes modificar `BLOCKED_COMMANDS` en `.env` para ajustar la lista (con precaución).

### Error de timeout en comandos
Aumenta `COMMAND_TIMEOUT` en `.env`. Por defecto es 30000 ms (30 segundos).

### Anthropic: error de headers
Verifica que `AI_HEADERS_8` sea JSON válido en una sola línea, sin saltos de línea dentro del valor.

---

## Licencia

MIT
