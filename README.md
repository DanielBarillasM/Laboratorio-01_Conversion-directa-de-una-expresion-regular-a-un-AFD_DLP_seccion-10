# Laboratorio #01 - Como parte del proyecto #01/Analizador Léxico (Generador YALex)

---

## Conversión directa: Expresión Regular → AFD (Aho–Sethi–Ullman / Dragon Book)

---

## Licenciatura en Ingeniería en Ciencias de la Computación

## Diseño de lenguajes de programación – CC - 3071

## Sección: 10

## Catedrático: Ingeniero Carlos Valdéz

## Integrantes del grupo **Dragons Slayers**:

* **Pablo Daniel Barillas Moreno** - Carné No. **22193**
* **Hugo Daniel Barillas Ajín** - Carné No. **23556**
* **Ernesto Ascencio** - Carné No. **23009**

---

## Descripción

Este módulo implementa la **conversión directa de una expresión regular a un AFD** usando el método de **Aho–Sethi–Ullman** (el “método directo” del Dragon Book):

* Aumenta la regex con el sentinela: **(r)#**
* Construye árbol sintáctico desde postfix
* Calcula **nullable**, **firstpos**, **lastpos**
* Calcula **followpos**
* Construye el AFD por conjuntos de posiciones:

  * **estado inicial** = firstpos(raíz)
  * δ(S,a) = ⋃ followpos(p) para p∈S con símbolo(p)=a
  * **estados de aceptación**: los que contienen la posición de **#**
* Grafica desde el backend:

  * **DOT → SVG** usando **viz.js** (solo visualización; no se usan librerías de regex)
* **Simula el AFD** para validar si una **cadena pertenece o no**:

  * Input “**Cadena a evaluar**”
  * Resultado **ACEPTADA / RECHAZADA**
  * Tabla con el **recorrido** (from/to por símbolo)

Además incluye **programación defensiva**:

* Validación fuerte del input (vacío, longitud, `#` reservado, escapes, operadores no soportados)
* Límites para evitar explosiones (tokens, nodos, posiciones, estados/transiciones, DOT/SVG)
* Recorridos iterativos para evitar stack overflow
* Timeout cooperativo (corta si tarda demasiado)

Archivo principal:

* `direct_re_to_dfa_v4.ts`

---

## Requisitos

* **Node.js** recomendado: **18+** (funciona en 20+ también)
* **npm** (incluido con Node)
* Dependencias:

  * `viz.js` (render DOT → SVG)
  * `ts-node`, `typescript`, `@types/node`

---

## Instalación y ejecución

> **Importante:** Antes de instalar las de dependencias y demás, verifique que tiene lo siguiente:

## Problemas adicionales: no tiene `npm` o `npx`

### Cómo verificar si están instalados

En la terminal (PowerShell / CMD / Terminal):

```bash
node -v
npm -v
npx -v
```

* Si `node -v` falla → **no tienes Node.js instalado** (o no está en el PATH).
* Si `npm -v` falla pero `node -v` funciona → instalación incompleta o PATH roto.
* Si `npx -v` falla pero `npm -v` funciona → normalmente es un problema de versión de npm (muy viejo) o PATH.

> Nota: `npm` y `npx` vienen incluidos con Node.js (en instalaciones normales).
> `npx` viene con npm (desde npm 5.2.0), así que con Node moderno debería estar.

---

### Error típico: “'npm' no se reconoce como un comando”

**Causa:** Node.js no está instalado o no está agregado al PATH.

**Solución (recomendada): instalar Node.js**

1. Instalar Node.js LTS (incluye npm y npx).

### Windows (PowerShell) — usando Winget

```powershell
winget install OpenJS.NodeJS.LTS
```

### macOS — usando Homebrew

```bash
brew install node@20
```

### Ubuntu/Debian — usando apt

```bash
sudo apt update && sudo apt install -y nodejs npm
```

Después verificar:

```bash
node -v && npm -v && npx -v
```

2. Cierre y vuelva a abrir la terminal.

3. Repite:

   ```bash
   node -v
   npm -v
   npx -v
   ```

---

### Error típico: Node instalado pero `npm` / `npx` no aparecen

**Causas comunes:**

* No reinicio la terminal después de instalar.
* El instalador no agregó Node al PATH.
* Estás usando una terminal con PATH viejo.

**Soluciones:**

* Cierre y abra la terminal.
* Reinicie VSCode (si lo ejecuta desde allí).
* Verifique el PATH:

  * Windows: “Editar las variables de entorno del sistema” → PATH
  * Debe incluir algo como:

    * `C:\Program Files\nodejs\`

---

### Alternativa recomendada en Windows: usar `nvm-windows`

Si se maneja varias versiones de Node, instala **nvm-windows** y luego:

```powershell
nvm install 20
nvm use 20
node -v
npm -v
npx -v
```

---

### Si NO tiene `npx`, puedes correr sin `npx`

En caso extremo, puedes ejecutar `ts-node` así:

1. Instala dependencias:

```bash
npm i -D ts-node typescript @types/node
npm i viz.js
```

2. Ejecuta con el bin local:

* Windows (PowerShell/CMD):

```powershell
.\node_modules\.bin\ts-node .\direct_re_to_dfa_v4.ts
```

* macOS/Linux:

```bash
./node_modules/.bin/ts-node ./direct_re_to_dfa_v4.ts
```

---

### Si no tiene `npm` pero sí `node`

Esto es raro en instalaciones oficiales. La solución práctica es **reinstalar Node.js** correctamente.

---

> **Importante:** Instala las dependencias **en el mismo folder** donde está el archivo `.ts`.

### 1) Encontrar carpeta e ir al archivo

Ubicar la carpeta:

* `Laboratorio-01_Conversion-directa-de-una-expresion-regular-a-un-AFD_DLP_seccion-10`

En Windows (PowerShell):

```powershell
cd .\Laboratorio-01_Conversion-directa-de-una-expresion-regular-a-un-AFD_DLP_seccion-10\
cd .\direct_re_to_dfa_v4\
```

### 2) Inicializar npm e instalar dependencias

```powershell
npm init -y
npm i viz.js
npm i -D ts-node typescript @types/node
```

### 3) Ejecutar el servidor

```powershell
npx ts-node .\direct_re_to_dfa_v4.ts
```

Deberías ver en consola:

* `Servidor listo: http://localhost:3000`
* `SSR sin frontend: http://localhost:3000/render?re=(a|b)*abb`

---

## Problema extra (importante): “ts-node corre pero no imprime nada / se cierra”

Esto puede pasar si se está dentro de un proyecto React/Vite con un `tsconfig.json` que **no incluye tipos de Node** (entonces `ts-node` toma ese config y se comporta raro).

**Solución recomendada (crear tsconfig solo para el backend):**

1. Crear `tsconfig.server.json` dentro del folder del backend (`direct_re_to_dfa_v4`):

```powershell
@'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "types": ["node"],
    "skipLibCheck": true
  }
}
'@ | Out-File -Encoding utf8 .\tsconfig.server.json
```

2. Ejecutar usando ese config:

```powershell
npx ts-node -P .\tsconfig.server.json .\direct_re_to_dfa_v4.ts
```

---

> **Si no funciona npm en la powershell, intente a probar:**

### 1) Inicializar npm.cmd e instalar dependencias

```powershell
npm.cmd init -y
npm.cmd i viz.js
npm.cmd i -D ts-node typescript @types/node
```

### 2) Ejecutar el servidor

```powershell
npx.cmd ts-node .\direct_re_to_dfa_v4.ts
```

---

## Uso (endpoints)

### UI mínima (recomendada para pruebas)

* [http://localhost:3000](http://localhost:3000)
  (Aquí puedes ingresar la regex y la **cadena a evaluar**)

### SSR completo (sin frontend, estilo reporte - por decirlo así)

* [http://localhost:3000/render?re=(a|b)*abb](http://localhost:3000/render?re=%28a|b%29*abb)
  Opcional para simular por URL:
* [http://localhost:3000/render?re=(a|b)*abb&s=abb](http://localhost:3000/render?re=%28a|b%29*abb&s=abb)

### SVG directo del AFD

* [http://localhost:3000/dfa.svg?re=(a|b)*abb](http://localhost:3000/dfa.svg?re=%28a|b%29*abb)

### API JSON

* `POST http://localhost:3000/api/convert`
* Body (regex):

```json
{ "regex": "(a|b)*abb" }
```

* Body (regex + simulación):

```json
{ "regex": "(a|b)*abb", "input": "abb" }
```

---

## Sintaxis soportada

Operadores:

* Unión: `|`
* Kleene: `*`
* Cerradura positiva: `+`
* Opcional: `?`
* Paréntesis: `( )`
* Concatenación: **implícita**
* Epsilon: `ε`
* Escape literal: `\` (ej: `\|` para símbolo `|` literal)

**Restricciones defensivas**:

* `#` está **reservado** (sentinela interno). Si se escribe en la regex, el programa lo **rechaza**.
* Si `STRICT_OPERATORS_ONLY` está en `true` (por defecto), se rechazan operadores estilo RegExp **no soportados**: `{ } [ ] . ^ $` (si no están escapados).

---

## Ejemplos para probar

Copiar y pegar en la UI:

1. `(a|b)*abb`  → termina en `abb`
2. `(a|b)*aba`  → termina en `aba`
3. `a*`         → `""`, `a`, `aa`, ...
4. `(ab)*`      → repeticiones de `ab`
5. `(a|ε)b`     → acepta `b` o `ab`
6. `a+b`        → acepta `ab`, `aab`, `aaab`, ...
7. `a?b`        → acepta `b` o `ab`

Ejemplo con caracteres “raros” como símbolos (válido):

* `¡jole`  → acepta exactamente la cadena `¡jole`

---

## Ejemplos para probar más específicos

Aquí hay 3 ejemplos que cubren todos los operadores:

1. Usa `|` y `*` y concatenación:

* Regex: `(a|b)*abb`
* Cadena SÍ: `abb`
* Cadena NO: `ab`

2. Usa `+` (cerradura positiva) y concatenación:

* Regex: `a+b`
* Cadena SÍ: `aaab`
* Cadena NO: `b`

1. Usa `?` (opcional) y concatenación:

* Regex: `a?b`
* Cadena SÍ: `b`  (porque `a` es opcional)
* Cadena NO: `aaab`

---

## Errores comunes y cómo arreglarlos

### 1) “No hay SVG / Instala viz.js”

Solución: instala en **ese folder**:

```powershell
npm i viz.js
```

y vuelva a correr el server.

### 2) Puerto ocupado (EADDRINUSE)

Si el puerto 3000 está ocupado:

* Cierre el proceso anterior (Ctrl+C en la terminal donde corre)
* O cambie el puerto en el archivo (const `PORT = 3000;`) y vuelva a ejecutar.

### 3) “Body demasiado grande”

El backend limita el tamaño del body (defensivo).
Evita enviar payloads enormes o sube el límite en `LIMITS.MAX_BODY_BYTES`.

### 4) “Timeout… tardó demasiado”

La conversión corta si excede `LIMITS.TIMEOUT_MS`.
Soluciones:

* Reduce la regex (o simplifica)
* Sube `TIMEOUT_MS`
* Baja el tamaño de salida (reduce límites DOT/SVG o desactiva render pesado)

### 5) “DFA demasiado grande / demasiadas transiciones”

El método directo puede explotar en estados.
Soluciones:

* Simplifica regex
* Ajusta `MAX_DFA_STATES` / `MAX_DFA_TRANSITIONS` (con cuidado)

### 6) PowerShell: políticas de ejecución (ts-node.ps1)

Si se intenta correr `ts-node` global y falla por ExecutionPolicy, siempre use:

```powershell
npx ts-node .\direct_re_to_dfa_v4.ts
```

`npx` no depende del script `.ps1` global.

### 7) “ts-node corre pero no imprime nada / se cierra”

Use el fix del **tsconfig.server.json**:

```powershell
npx ts-node -P .\tsconfig.server.json .\direct_re_to_dfa_v4.ts
```

---

## Integración con React

Este backend ya sirve HTML y también API JSON. Para integrarlo con React:

* Mantiene el backend corriendo (puerto 3000 por default)
* Desde React consume:

  * `POST /api/convert` con `{ regex: "...", input: "..." }`
* Se puede renderizar:

  * `data.svg` (si viene) como `innerHTML` en un contenedor
  * las tablas desde `data.steps`
  * el resultado de simulación desde `data.test`

---

## Notas de compiladores

* No se usa `RegExp` ni librerías que “resuelvan” la regex.
* La lógica de compiladores se implementa desde cero:

  * tokenización, shunting-yard, árbol, followpos, construcción de DFA, simulación
* `viz.js` solo se usa para **dibujar** el DOT (visualización).

---

## Licencia

MIT.