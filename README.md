# 🤖 MCP Dev Agent

**Agente de desarrollo de software autónomo construido sobre Model Context Protocol (MCP)**

Utiliza el SDK oficial de MCP para exponer herramientas de filesystem, terminal y git que un modelo de lenguaje (GPT-4o) puede usar para planificar, escribir y ejecutar código de forma autónoma.

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
│  │  1. OpenAI   │                             │ ejecuta sobre   │
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
│         ┌────────────────────────────────┐                      │
│         │        OPENAI API              │                      │
│         │  GPT-4o con function calling   │                      │
│         └────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de comunicación

1. **Usuario** escribe una tarea en el CLI
2. **DevAgent** envía el mensaje + tools disponibles a **OpenAI GPT-4o**
3. **OpenAI** decide qué tools llamar y con qué argumentos
4. **MCPClient** recibe la tool call y la envía al **MCP Server** via stdio
5. **MCP Server** ejecuta la tool real (lee archivo, escribe, ejecuta comando...)
6. El resultado vuelve a **OpenAI** como contexto
7. El loop continúa hasta que el agente termina la tarea

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Runtime | Node.js ≥ 18 (ES Modules) |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.10.2 |
| IA / LLM | OpenAI API (`gpt-4o`) |
| Schema validation | `zod` |
| CLI | `readline` nativo + `chalk` |
| Transport | stdio (subprocess) |

---

## Requisitos previos

- **Node.js** 18 o superior
- **npm** 8 o superior
- Cuenta en **OpenAI** con API key y créditos disponibles
- **git** instalado (opcional, para tools de git)

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

Edita `.env` y configura obligatoriamente:

```env
OPENAI_API_KEY=sk-proj-tu-api-key-aqui
OPENAI_MODEL=gpt-4o
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
- **Max iterations**: El agent loop se detiene después de 20 iteraciones

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `OPENAI_API_KEY` | — | **Obligatoria**. API key de OpenAI |
| `OPENAI_MODEL` | `gpt-4o` | Modelo a usar |
| `WORKSPACE_DIR` | `./workspace` | Directorio de trabajo del agente |
| `LOG_LEVEL` | `info` | Nivel de logs: debug/info/warn/error |
| `MAX_ITERATIONS` | `20` | Máximo de iteraciones del agent loop |
| `COMMAND_TIMEOUT` | `30000` | Timeout de comandos en ms |
| `BLOCKED_COMMANDS` | (lista interna) | Comandos adicionales a bloquear |

---

## Estructura del proyecto

```
mcp-dev-agent/
├── src/
│   ├── index.js              # CLI interactiva y punto de entrada
│   ├── agent/
│   │   └── agent.js          # DevAgent: agent loop + OpenAI integration
│   ├── mcp/
│   │   ├── server.js         # MCP Server oficial con todas las tools
│   │   └── client.js         # MCP Client: conecta y llama al server
│   ├── tools/
│   │   ├── filesystem.js     # read_file, write_file, list_directory...
│   │   ├── terminal.js       # run_command
│   │   └── git.js            # git_init, git_status, git_add, git_commit...
│   └── utils/
│       ├── logger.js         # Logger con niveles y colores
│       └── security.js       # Validaciones de paths y comandos
├── scripts/
│   └── demo.js               # Demo standalone sin CLI interactivo
├── examples/
│   └── prompts.md            # Ejemplos de prompts para usar con el agente
├── workspace/                # Directorio donde el agente trabaja (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Solución de problemas

### Error: OPENAI_API_KEY no configurada
Asegúrate de haber copiado `.env.example` a `.env` y configurado tu API key.

### Error: Cannot find module '@modelcontextprotocol/sdk'
Ejecuta `npm install` para instalar las dependencias.

### El agente no termina / bucle infinito
Aumenta `MAX_ITERATIONS` en `.env` o simplifica la tarea. El límite por defecto es 20 iteraciones.

### Comando bloqueado por seguridad
Los comandos destructivos están bloqueados por diseño. Puedes modificar `BLOCKED_COMMANDS` en `.env` para ajustar la lista (con precaución).

### Error de timeout en comandos
Aumenta `COMMAND_TIMEOUT` en `.env`. Por defecto es 30000 ms (30 segundos).

---

## Licencia

MIT
