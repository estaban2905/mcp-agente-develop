# 💡 Ejemplos de Prompts para el Agente

Copia cualquiera de estos prompts en el CLI interactivo del agente.

---

## 🚀 APIs y Backends

### API REST Completa de Usuarios
```
Crea una API REST de usuarios completa en Express con CRUD, validaciones, 
manejo de errores, middleware, y documentación en README.
```

### API con Base de Datos SQLite
```
Crea una API REST de tareas (To-Do) con SQLite y better-sqlite3.
Incluye: crear tarea, listar, marcar como completada, eliminar.
Con manejo de errores y README.
```

### GraphQL Server Básico
```
Implementa un servidor GraphQL básico con Apollo Server y Node.js.
Con schema para Productos (id, nombre, precio, stock) y resolvers.
```

---

## 🛠️ Utilidades CLI

### Generador de Contraseñas
```
Crea una CLI en Node.js para generar contraseñas seguras.
Opciones: --length, --uppercase, --numbers, --symbols.
Con estimación de fortaleza de la contraseña.
```

### Monitor de Sistema
```
Crea un script Node.js que muestre: uso de CPU, memoria RAM,
uptime del sistema y espacio en disco. Actualización cada 5 segundos.
```

### Conversor de Archivos CSV a JSON
```
Crea una utilidad Node.js que convierta archivos CSV a JSON.
Soporte para delimitadores personalizados, headers opcionales,
y output formateado. CLI con argumentos.
```

---

## 📦 Proyectos Completos

### Chat Bot con Websockets
```
Crea un chat en tiempo real usando Socket.io y Express.
Con: sala de chat pública, nicknames, historial de últimos 20 mensajes,
notificaciones de entrada/salida de usuarios.
```

### Web Scraper con Axios y Cheerio
```
Crea un web scraper en Node.js usando axios y cheerio.
Que extraiga: título, descripción y links de cualquier URL dada.
Con rate limiting y manejo de errores.
```

### Sistema de Caché en Memoria
```
Implementa una clase Cache en Node.js con: set/get/delete/clear,
TTL (time-to-live) por entrada, límite máximo de entradas (LRU eviction),
estadísticas de hits/misses. Con tests usando Node.js assert.
```

---

## 🧪 Testing y Calidad

### Suite de Tests para API
```
Tengo una API Express en la carpeta users-api. 
Crea una suite de tests con Jest que pruebe todos los endpoints
incluyendo casos de error y validaciones.
```

### Linting y Formateo
```
Configura ESLint y Prettier para el proyecto en la raíz del workspace.
Con configuración para Node.js moderno (ES modules), 
reglas de estilo consistentes y script npm run lint.
```

---

## 🔧 DevOps y Configuración

### Docker Setup
```
Crea un Dockerfile y docker-compose.yml para el proyecto users-api.
Con: multi-stage build, usuario no-root, variables de entorno,
y README con instrucciones de deployment.
```

### GitHub Actions CI
```
Crea un workflow de GitHub Actions para el proyecto users-api que:
- Se ejecute en push a main
- Instale dependencias
- Ejecute los tests
- Genere un reporte de cobertura
```

---

## 💡 Tips

- El agente trabaja de forma autónoma, no interrumpas su proceso
- Si algo falla, el agente lo detecta y reintenta
- Usa `/stats` para ver cuántas iteraciones usó el agente
- Los archivos generados quedan en la carpeta `workspace/`
- Usa `/clear` entre tareas independientes para resetear el contexto
