/**
 * Conversión directa de una Expresión Regular a un AFD (Aho–Sethi–Ullman / Dragon Book)
 * ------------------------------------------------------------------------------
 * LÓGICA DESDE CERO (sin RegExp / sin librerías de regex)
 * Método directo: árbol sintáctico + nullable/firstpos/lastpos/followpos + construcción de DFA
 * Incluye TODOS los “artefactos” típicos del PDF/Dragon Book:
 *    - expresión aumentada (r)#,
 *    - tokens, tokens con concatenación explícita (·), postfix,
 *    - tabla pos→símbolo,
 *    - árboles: base / nullable / firstpos / lastpos / all,
 *    - tabla followpos,
 *    - estado inicial,
 *    - expansión paso-a-paso de δ(S,a) con ⋃ followpos,
 *    - tabla de transición final,
 *    - estados de aceptación (contienen #).
 * Graficación real desde backend: DOT -> SVG con viz.js (solo visualización).
 *
 * 🛡️ Además: programación defensiva fuerte
 *    - Validación de entrada (vacío, longitud, '#' reservado, escapes, operadores no soportados)
 *    - Límites: tokens, nodos, posiciones, estados/transiciones, DOT/SVG, request body
 *    - Recorridos iterativos (evita stack overflow)
 *    - Timeout cooperativo por conversión
 *
 * Requisitos:
 *   npm i viz.js
 *   npm i -D ts-node typescript @types/node
 *
 * Ejecutar:
 *   npx ts-node .\direct_re_to_dfa_full_defensive.ts
 *
 * Abrir:
 *   - SSR completo:           http://localhost:3000/render?re=(a|b)*abb
 *   - UI mínima:             http://localhost:3000
 *   - SVG directo (AFD):     http://localhost:3000/dfa.svg?re=(a|b)*abb
 *   - API JSON:              POST http://localhost:3000/api/convert  { "regex": "(a|b)*abb" }
 */

import http from "http";
import { URL } from "url";

// Node (compat ESM/CJS): en ESM no existe require.
declare var require: any;

// ----------------------------
// Config defensiva
// ----------------------------
const LIMITS = {
  MAX_REGEX_CHARS: 5000,
  MAX_TOKENS: 20000,
  MAX_NODES: 20000,
  MAX_POSITIONS: 5000,
  MAX_DFA_STATES: 5000,
  MAX_DFA_TRANSITIONS: 30000,
  MAX_BODY_BYTES: 2_000_000,
  MAX_DOT_CHARS: 2_000_000,
  MAX_SVG_CHARS: 4_000_000,
  TIMEOUT_MS: 1500,
  STRICT_OPERATORS_ONLY: true, // si true, rechaza + ? { } [ ] . ^ $ salvo que estén escapados
};

// ----------------------------
// Utilidades (sin regex)
// ----------------------------
function nowMs(): number { return Date.now(); }

function assertBudget(startMs: number, phase: string) {
  if (nowMs() - startMs > LIMITS.TIMEOUT_MS) {
    throw new Error(`Timeout: la conversión excedió ${LIMITS.TIMEOUT_MS}ms durante "${phase}".`);
  }
}

function isWhitespace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c === 9 || c === 10 || c === 13 || c === 32;
}

function htmlEscape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else out += ch;
  }
  return out;
}

function dotEscapeLabel(s: string): string {
  // Escapa para DOT label: \, ", y saltos de línea reales a \n
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") { /* ignore */ }
    else out += ch;
  }
  return out;
}

function setUnion<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a);
  for (const x of b) out.add(x);
  return out;
}
function setAddAll<T>(target: Set<T>, src: Set<T>) {
  for (const x of src) target.add(x);
}
function setToSortedArray(s: Set<number>): number[] {
  const arr: number[] = [];
  for (const x of s) arr.push(x);
  arr.sort((x, y) => x - y);
  return arr;
}
function keyOfSet(s: Set<number>): string {
  const a = setToSortedArray(s);
  let out = "";
  for (let i = 0; i < a.length; i++) {
    if (i) out += ",";
    out += String(a[i]);
  }
  return out; // "" si vacío
}
function setFromKey(key: string): Set<number> {
  const s = new Set<number>();
  if (!key) return s;
  let num = 0;
  let inNum = false;
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      num = num * 10 + (code - 48);
      inNum = true;
    } else if (ch === ",") {
      if (inNum) s.add(num);
      num = 0;
      inNum = false;
    }
  }
  if (inNum) s.add(num);
  return s;
}
function setLabel(s: Set<number> | undefined): string {
  if (!s) return "{}";
  const arr = setToSortedArray(s);
  return "{" + arr.join(",") + "}";
}

// ----------------------------
// Validación defensiva de la regex del usuario
// ----------------------------
function validateInputRegex(userRegex: string) {
  if (typeof userRegex !== "string") throw new Error("La expresión regular debe ser texto.");
  if (!userRegex.trim()) throw new Error("La expresión regular está vacía.");
  if (userRegex.length > LIMITS.MAX_REGEX_CHARS) throw new Error(`Regex demasiado larga (>${LIMITS.MAX_REGEX_CHARS}).`);

  const forbidden = "{}[].^$";
  for (let i = 0; i < userRegex.length; i++) {
    const ch = userRegex[i];

    // escape consume el siguiente char
    if (ch === "\\") {
      if (i + 1 >= userRegex.length) throw new Error("Escape '\\' al final de la expresión.");
      i++;
      continue;
    }

    // '#' reservado para sentinela del método directo.
    if (ch === "#") {
      throw new Error("El símbolo '#' está reservado para el sentinela del método directo. No lo uses en la entrada.");
    }

    if (LIMITS.STRICT_OPERATORS_ONLY) {
      // si el usuario quiere estos como literal, debe escaparlos: \+
      for (let j = 0; j < forbidden.length; j++) {
        if (ch === forbidden[j]) {
          throw new Error(`Operador no soportado: '${ch}'. Solo se permite | * + ? ( ) concatenación y ε. Si lo quieres literal, escápalo con \\.`);
        }
      }
    }
  }
}

// ----------------------------
// 1) Tokenización (sin RegExp)
// ----------------------------
type Tok =
  | { t: "sym"; v: string } // símbolo del alfabeto, ε o #
  | { t: "op"; v: "|" | "·" | "*" | "+" | "?" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(input: string, startMs: number): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < input.length; i++) {
    assertBudget(startMs, "tokenize");
    const ch = input[i];

    if (isWhitespace(ch)) continue;

    if (ch === "\\") {
      if (i + 1 >= input.length) throw new Error("Escape '\\' al final de la expresión.");
      i++;
      out.push({ t: "sym", v: input[i] });
    } else if (ch === "(") out.push({ t: "lp" });
    else if (ch === ")") out.push({ t: "rp" });
    else if (ch === "|") out.push({ t: "op", v: "|" });
    else if (ch === "*") out.push({ t: "op", v: "*" });
    else if (ch === "+") out.push({ t: "op", v: "+" });
    else if (ch === "?") out.push({ t: "op", v: "?" });
    else out.push({ t: "sym", v: ch });

    if (out.length > LIMITS.MAX_TOKENS) throw new Error(`Demasiados tokens (>${LIMITS.MAX_TOKENS}).`);
  }
  return out;
}

function isConcatNeeded(a: Tok | null, b: Tok | null): boolean {
  if (!a || !b) return false;
  const aCanEnd = a.t === "sym" || a.t === "rp" || (a.t === "op" && (a.v === "*" || a.v === "+" || a.v === "?"));
  const bCanStart = b.t === "sym" || b.t === "lp";
  return aCanEnd && bCanStart;
}

function insertExplicitConcat(tokens: Tok[], startMs: number): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    assertBudget(startMs, "insertExplicitConcat");
    const cur = tokens[i];
    const prev = out.length ? out[out.length - 1] : null;
    if (isConcatNeeded(prev, cur)) out.push({ t: "op", v: "·" });
    out.push(cur);
    if (out.length > LIMITS.MAX_TOKENS) throw new Error(`Demasiados tokens tras concatenación (>${LIMITS.MAX_TOKENS}).`);
  }
  return out;
}

// ----------------------------
// 2) Infix -> Postfix (Shunting-yard)
// ----------------------------
function precedence(op: "|" | "·" | "*" | "+" | "?"): number {
  if (op === "*" || op === "+" || op === "?") return 3;
  if (op === "·") return 2;
  return 1;
}

function toPostfix(tokens: Tok[], startMs: number): Tok[] {
  const output: Tok[] = [];
  const stack: Tok[] = [];

  for (const tok of tokens) {
    assertBudget(startMs, "toPostfix");
    if (tok.t === "sym") {
      output.push(tok);
    } else if (tok.t === "lp") {
      stack.push(tok);
    } else if (tok.t === "rp") {
      while (stack.length && stack[stack.length - 1].t !== "lp") {
        output.push(stack.pop() as Tok);
      }
      if (!stack.length) throw new Error("Paréntesis desbalanceados: falta '('");
      stack.pop();
    } else if (tok.t === "op") {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t !== "op") break;
        const pTop = precedence(top.v);
        const pCur = precedence(tok.v);
        if (pTop > pCur || pTop === pCur) output.push(stack.pop() as Tok);
        else break;
      }
      stack.push(tok);
    }

    if (output.length + stack.length > LIMITS.MAX_TOKENS) throw new Error("Demasiados elementos durante postfix.");
  }

  while (stack.length) {
    const top = stack.pop() as Tok;
    if (top.t === "lp" || top.t === "rp") throw new Error("Paréntesis desbalanceados");
    output.push(top);
  }

  return output;
}

// ----------------------------
// 3) Árbol sintáctico
// ----------------------------
type Node =
  | { id: number; k: "leaf"; sym: string; pos?: number; nullable?: boolean; first?: Set<number>; last?: Set<number> }
  | { id: number; k: "or"; l: Node; r: Node; nullable?: boolean; first?: Set<number>; last?: Set<number> }
  | { id: number; k: "concat"; l: Node; r: Node; nullable?: boolean; first?: Set<number>; last?: Set<number> }
  | { id: number; k: "star"; c: Node; nullable?: boolean; first?: Set<number>; last?: Set<number> };

let NODE_ID = 0;
function nid(): number {
  NODE_ID++;
  if (NODE_ID > LIMITS.MAX_NODES) throw new Error(`Demasiados nodos en el árbol (>${LIMITS.MAX_NODES}).`);
  return NODE_ID;
}


function cloneSubtree(orig: Node, startMs: number): Node {
  // Clonado profundo SIN recursión (evita stack overflow).
  // Importante para r+ ≡ r · r* (se requiere duplicar posiciones).
  const map = new Map<any, Node>();
  const stack: Array<{ n: Node; seen: boolean }> = [{ n: orig, seen: false }];

  while (stack.length) {
    assertBudget(startMs, "cloneSubtree");
    const cur = stack.pop() as { n: Node; seen: boolean };
    const n = cur.n;

    if (!cur.seen) {
      stack.push({ n, seen: true });
      if (n.k === "star") stack.push({ n: n.c, seen: false });
      else if (n.k === "concat" || n.k === "or") {
        stack.push({ n: n.r, seen: false });
        stack.push({ n: n.l, seen: false });
      }
      continue;
    }

    let c: Node;
    if (n.k === "leaf") {
      c = { id: nid(), k: "leaf", sym: n.sym };
    } else if (n.k === "star") {
      c = { id: nid(), k: "star", c: map.get(n.c) as Node };
    } else if (n.k === "concat") {
      c = { id: nid(), k: "concat", l: map.get(n.l) as Node, r: map.get(n.r) as Node };
    } else {
      c = { id: nid(), k: "or", l: map.get(n.l) as Node, r: map.get(n.r) as Node };
    }
    map.set(n, c);
  }

  return map.get(orig) as Node;
}

function buildSyntaxTree(postfix: Tok[], startMs: number): Node {
  const st: Node[] = [];

  for (const tok of postfix) {
    assertBudget(startMs, "buildSyntaxTree");

    if (tok.t === "sym") {
      st.push({ id: nid(), k: "leaf", sym: tok.v });
      continue;
    }
    if (tok.t !== "op") continue;

    if (tok.v === "*" || tok.v === "+" || tok.v === "?") {
      const a = st.pop();
      if (!a) throw new Error(`Operador '${tok.v}' sin operando.`);

      if (tok.v === "*") {
        st.push({ id: nid(), k: "star", c: a });
      } else if (tok.v === "?") {
        // r? ≡ (r | ε)
        const eps: Node = { id: nid(), k: "leaf", sym: "ε" };
        st.push({ id: nid(), k: "or", l: a, r: eps });
      } else {
        // r+ ≡ r · r*
        const a2 = cloneSubtree(a, startMs);
        const star: Node = { id: nid(), k: "star", c: a2 };
        st.push({ id: nid(), k: "concat", l: a, r: star });
      }
      continue;
    }

    const b = st.pop();
    const a = st.pop();
    if (!a || !b) throw new Error(`Operador '${tok.v}' con operandos insuficientes.`);

    if (tok.v === "·") st.push({ id: nid(), k: "concat", l: a, r: b });
    else st.push({ id: nid(), k: "or", l: a, r: b });
  }

  if (st.length !== 1) throw new Error("Expresión inválida: el árbol no se redujo a una sola raíz.");
  return st[0];
}

type TreeMode = "base" | "nullable" | "firstpos" | "lastpos" | "all";

function buildTreeDot(root: Node, mode: TreeMode): string {
  let out = "digraph SyntaxTree {\n";
  out += "  rankdir=TB;\n";
  out += "  node [shape=box];\n";

  function opLabel(n: Node): string {
    if (n.k === "leaf") {
      const pos = typeof n.pos === "number" ? "\npos=" + n.pos : "";
      return "leaf\n" + n.sym + pos;
    }
    if (n.k === "star") return "star\n*";
    if (n.k === "concat") return "concat\n·";
    return "or\n|";
  }

  function valLabel(n: Node): string {
    if (mode === "base") return opLabel(n);
    if (mode === "nullable") return n.nullable ? "true" : "false";
    if (mode === "firstpos") return setLabel(n.first);
    if (mode === "lastpos") return setLabel(n.last);
    const nlb = n.nullable ? "true" : "false";
    return "nullable=" + nlb + "\nfirst=" + setLabel(n.first) + "\nlast=" + setLabel(n.last);
  }

  // iterativo para evitar recursión
  const stack: Node[] = [root];
  const seen = new Set<number>();
  while (stack.length) {
    const n = stack.pop() as Node;
    if (seen.has(n.id)) continue;
    seen.add(n.id);

    out += `  n${n.id} [label="${dotEscapeLabel(valLabel(n))}"];\n`;

    if (n.k === "star") {
      out += `  n${n.id} -> n${n.c.id};\n`;
      stack.push(n.c);
    } else if (n.k === "concat" || n.k === "or") {
      out += `  n${n.id} -> n${n.l.id} [label="L"];\n`;
      out += `  n${n.id} -> n${n.r.id} [label="R"];\n`;
      stack.push(n.r);
      stack.push(n.l);
    }
  }

  out += "}\n";
  return out;
}

// ----------------------------
// 4) Etiquetar hojas con posiciones (iterativo)
// ----------------------------
function assignPositions(root: Node, startMs: number): { posToSym: string[]; hashPos: number } {
  let pos = 0;
  const posToSym: string[] = [""];
  let hashPos = -1;

  const stack: Node[] = [root];
  while (stack.length) {
    assertBudget(startMs, "assignPositions");
    const n = stack.pop() as Node;

    if (n.k === "leaf") {
      if (n.sym !== "ε") {
        pos++;
        if (pos > LIMITS.MAX_POSITIONS) throw new Error(`Demasiadas posiciones (>${LIMITS.MAX_POSITIONS}).`);
        n.pos = pos;
        posToSym[pos] = n.sym;
        if (n.sym === "#") hashPos = pos;
      }
      continue;
    }

    if (n.k === "star") stack.push(n.c);
    else {
      stack.push(n.r);
      stack.push(n.l);
    }
  }

  if (hashPos === -1) throw new Error("No se encontró '#' en la regex aumentada (error interno).");
  return { posToSym, hashPos };
}

// ----------------------------
// 5-7) nullable / firstpos / lastpos / followpos (postorden iterativo)
// ----------------------------
type FollowPos = Map<number, Set<number>>;

function ensureFollow(follow: FollowPos, i: number): Set<number> {
  let s = follow.get(i);
  if (!s) {
    s = new Set<number>();
    follow.set(i, s);
  }
  return s;
}

function computeFunctions(root: Node, follow: FollowPos, startMs: number) {
  const stack: Array<{ n: Node; seen: boolean }> = [{ n: root, seen: false }];

  while (stack.length) {
    assertBudget(startMs, "computeFunctions");
    const cur = stack.pop() as { n: Node; seen: boolean };
    const n = cur.n;

    if (!cur.seen) {
      stack.push({ n, seen: true });
      if (n.k === "star") stack.push({ n: n.c, seen: false });
      else if (n.k === "concat" || n.k === "or") {
        stack.push({ n: n.r, seen: false });
        stack.push({ n: n.l, seen: false });
      }
      continue;
    }

    // hijos ya calculados
    if (n.k === "leaf") {
      if (n.sym === "ε") {
        n.nullable = true;
        n.first = new Set<number>();
        n.last = new Set<number>();
      } else {
        n.nullable = false;
        const s = new Set<number>();
        s.add(n.pos as number);
        n.first = new Set<number>(s);
        n.last = new Set<number>(s);
      }
      continue;
    }

    if (n.k === "star") {
      const c = n.c;
      n.nullable = true;
      n.first = new Set<number>(c.first as Set<number>);
      n.last = new Set<number>(c.last as Set<number>);
      for (const i of c.last as Set<number>) {
        const fp = ensureFollow(follow, i);
        setAddAll(fp, c.first as Set<number>);
      }
      continue;
    }

    if (n.k === "or") {
      const l = n.l, r = n.r;
      n.nullable = (l.nullable as boolean) || (r.nullable as boolean);
      n.first = setUnion(l.first as Set<number>, r.first as Set<number>);
      n.last = setUnion(l.last as Set<number>, r.last as Set<number>);
      continue;
    }

    // concat
    const l = n.l, r = n.r;
    const lNull = l.nullable as boolean;
    const rNull = r.nullable as boolean;

    n.nullable = lNull && rNull;

    n.first = lNull
      ? setUnion(l.first as Set<number>, r.first as Set<number>)
      : new Set<number>(l.first as Set<number>);

    n.last = rNull
      ? setUnion(l.last as Set<number>, r.last as Set<number>)
      : new Set<number>(r.last as Set<number>);

    for (const i of l.last as Set<number>) {
      const fp = ensureFollow(follow, i);
      setAddAll(fp, r.first as Set<number>);
    }
  }
}

// Dump de nodos para tabla (postorden iterativo)
type NodeDump = {
  id: number;
  kind: string;
  sym?: string;
  pos?: number;
  nullable: boolean;
  first: number[];
  last: number[];
  left?: number;
  right?: number;
  child?: number;
};

function dumpNodes(root: Node, startMs: number): NodeDump[] {
  const out: NodeDump[] = [];
  const stack: Array<{ n: Node; seen: boolean }> = [{ n: root, seen: false }];

  while (stack.length) {
    assertBudget(startMs, "dumpNodes");
    const cur = stack.pop() as { n: Node; seen: boolean };
    const n = cur.n;

    if (!cur.seen) {
      stack.push({ n, seen: true });
      if (n.k === "star") stack.push({ n: n.c, seen: false });
      else if (n.k === "concat" || n.k === "or") {
        stack.push({ n: n.r, seen: false });
        stack.push({ n: n.l, seen: false });
      }
      continue;
    }

    if (n.k === "leaf") {
      out.push({
        id: n.id,
        kind: "leaf",
        sym: n.sym,
        pos: n.pos,
        nullable: !!n.nullable,
        first: setToSortedArray(n.first as Set<number>),
        last: setToSortedArray(n.last as Set<number>),
      });
    } else if (n.k === "star") {
      out.push({
        id: n.id,
        kind: "star",
        child: n.c.id,
        nullable: !!n.nullable,
        first: setToSortedArray(n.first as Set<number>),
        last: setToSortedArray(n.last as Set<number>),
      });
    } else {
      out.push({
        id: n.id,
        kind: n.k,
        left: n.l.id,
        right: n.r.id,
        nullable: !!n.nullable,
        first: setToSortedArray(n.first as Set<number>),
        last: setToSortedArray(n.last as Set<number>),
      });
    }

    if (out.length > LIMITS.MAX_NODES) throw new Error("Dump de nodos demasiado grande.");
  }

  return out;
}

// ----------------------------
// 8-10) Construcción del AFD directo
// ----------------------------
type DFAState = { id: string; key: string; positions: number[]; isAccept: boolean; isDead: boolean };
type DFATrans = { from: string; via: string; to: string };

type DFASteps = {
  step1_augmented: string;
  step2_tokens: string[];
  step2_tokens_with_concat: string[];
  step2_postfix: string[];
  step3_pos_to_sym: { pos: number; sym: string }[];
  step4_6_node_dump: NodeDump[];
  step7_followpos: { pos: number; sym: string; follow: number[] }[];
  step8_start_state: { positions: number[] };
  step9_expansion_log: {
    state: string;
    positions: number[];
    perSymbol: { sym: string; positionsWithSym: number[]; followUnion: number[]; targetState: string }[];
  }[];
  step9_transition_table: { state: string; positions: number[]; isAccept: boolean; row: Record<string, string> }[];
  step10_accepting_states: string[];
};

type Meta = {
  timingMs: number;
  truncated: { dotTooLarge: boolean; svgTooLarge: boolean };
  counts: { tokens: number; nodes: number; positions: number; states: number; transitions: number };
  limits: typeof LIMITS;
};

type DFATestStep = { index: number; symbol: string; from: string; to: string | null; note?: string };
type DFATestResult = { input: string; accepted: boolean; start: string; end: string; path: DFATestStep[] };

type DFAResult = {
  vizError?: string;
  trees?: {
    baseDot: string;
    nullableDot: string;
    firstDot: string;
    lastDot: string;
    allDot: string;
    baseSvg?: string;
    nullableSvg?: string;
    firstSvg?: string;
    lastSvg?: string;
    allSvg?: string;
  };

  alphabet: string[];
  startId: string;
  states: DFAState[];
  transitions: DFATrans[];
  dot: string;
  svg?: string;

  steps: DFASteps;
  meta: Meta;

  // Resultado opcional de simulación
  test?: DFATestResult;
};

function simulateDFA(dfa: DFAResult, input: string): DFATestResult {
  // Construye tabla de transición δ desde la lista de transiciones
  const delta = new Map<string, Map<string, string>>();
  for (const t of dfa.transitions) {
    let row = delta.get(t.from);
    if (!row) {
      row = new Map<string, string>();
      delta.set(t.from, row);
    }
    row.set(t.via, t.to);
  }

  const accept = new Set<string>();
  for (const st of dfa.states) if (st.isAccept) accept.add(st.id);

  let cur = dfa.startId;
  const path: DFATestStep[] = [];

  for (let i = 0; i < input.length; i++) {
    const sym = input[i];
    const row = delta.get(cur);
    const nxt = row ? row.get(sym) : undefined;
    if (!nxt) {
      path.push({ index: i, symbol: sym, from: cur, to: null, note: "Sin transición para este símbolo" });
      return { input, accepted: false, start: dfa.startId, end: cur, path };
    }
    path.push({ index: i, symbol: sym, from: cur, to: nxt });
    cur = nxt;
  }

  return { input, accepted: accept.has(cur), start: dfa.startId, end: cur, path };
}


function buildDot(states: DFAState[], transitions: DFATrans[], startId: string): string {
  let out = "digraph DFA {\n";
  out += "  rankdir=LR;\n";
  out += "  node [shape=circle];\n";
  out += '  __start [shape=point,label=""];\n';
  out += "  __start -> " + startId + ";\n";

  for (const st of states) {
    let label = st.id + "\\n";
    if (st.isDead) label += "∅";
    else label += "{" + st.positions.join(",") + "}";
    if (st.isAccept) out += "  " + st.id + ' [shape=doublecircle,label="' + label + '"];\n';
    else out += "  " + st.id + ' [label="' + label + '"];\n';
  }

  for (const tr of transitions) {
    out += "  " + tr.from + " -> " + tr.to + ' [label="' + dotEscapeLabel(tr.via) + '"];\n';
  }

  out += "}\n";
  return out;
}

function buildDFA(root: Node, posToSym: string[], hashPos: number, follow: FollowPos, startMs: number) {
  const alphaSet = new Set<string>();
  for (let i = 1; i < posToSym.length; i++) {
    const s = posToSym[i];
    if (s !== "#" && s !== "ε") alphaSet.add(s);
  }
  const alphabet = Array.from(alphaSet).sort();

  const startSet = root.first as Set<number>;
  const startKey = keyOfSet(startSet);

  const keyToId = new Map<string, string>();
  const idToKey: string[] = [];
  const queue: string[] = [];

  function addState(key: string): string {
    let id = keyToId.get(key);
    if (id) return id;
    if (idToKey.length >= LIMITS.MAX_DFA_STATES) throw new Error(`DFA demasiado grande (>${LIMITS.MAX_DFA_STATES} estados).`);
    id = "S" + idToKey.length;
    keyToId.set(key, id);
    idToKey.push(key);
    queue.push(key);
    return id;
  }

  const startId = addState(startKey);

  const DEAD_KEY = "";
  let deadNeeded = false;

  const transMap = new Map<string, Map<string, string>>();
  const expansionLogByKey = new Map<
    string,
    { sym: string; positionsWithSym: number[]; followUnion: number[]; targetState: string }[]
  >();

  let transCount = 0;

  while (queue.length) {
    assertBudget(startMs, "buildDFA");
    const curKey = queue.shift() as string;
    const curSet = setFromKey(curKey);

    const perSym = new Map<string, Set<number>>();
    for (const a of alphabet) perSym.set(a, new Set<number>());

    for (const p of curSet) {
      const sym = posToSym[p];
      if (!sym || sym === "#" || sym === "ε") continue;
      const dest = perSym.get(sym);
      if (!dest) continue;
      const fp = follow.get(p);
      if (fp) setAddAll(dest, fp);
    }

    const perSymbolLog: { sym: string; positionsWithSym: number[]; followUnion: number[]; targetState: string }[] = [];
    const row = new Map<string, string>();

    for (const a of alphabet) {
      const dest = perSym.get(a) as Set<number>;
      const k = keyOfSet(dest);
      if (k === DEAD_KEY) deadNeeded = true;

      const targetId = addState(k);

      const posWith: number[] = [];
      for (const p of curSet) if (posToSym[p] === a) posWith.push(p);
      posWith.sort((x, y) => x - y);

      perSymbolLog.push({
        sym: a,
        positionsWithSym: posWith,
        followUnion: setToSortedArray(dest),
        targetState: targetId,
      });

      row.set(a, k);

      transCount++;
      if (transCount > LIMITS.MAX_DFA_TRANSITIONS) throw new Error(`Demasiadas transiciones (>${LIMITS.MAX_DFA_TRANSITIONS}).`);
    }

    transMap.set(curKey, row);
    expansionLogByKey.set(curKey, perSymbolLog);
  }

  if (deadNeeded) {
    if (!keyToId.has(DEAD_KEY)) addState(DEAD_KEY);
    if (!transMap.has(DEAD_KEY)) {
      const row = new Map<string, string>();
      for (const a of alphabet) row.set(a, DEAD_KEY);
      transMap.set(DEAD_KEY, row);
      expansionLogByKey.set(
        DEAD_KEY,
        alphabet.map((a) => ({
          sym: a,
          positionsWithSym: [],
          followUnion: [],
          targetState: keyToId.get(DEAD_KEY) as string,
        }))
      );
    }
  }

  const states: DFAState[] = idToKey.map((k, idx) => {
    const set = setFromKey(k);
    const positions = setToSortedArray(set);
    const isDead = k === DEAD_KEY;
    const isAccept = set.has(hashPos);
    return { id: "S" + idx, key: k, positions, isAccept, isDead };
  });

  const transitions: DFATrans[] = [];
  for (const [fromKey, row] of transMap.entries()) {
    const fromId = keyToId.get(fromKey) as string;
    for (const [via, toKey] of row.entries()) {
      const toId = keyToId.get(toKey) as string;
      transitions.push({ from: fromId, via, to: toId });
    }
  }
  transitions.sort((a, b) => (a.from + a.via + a.to).localeCompare(b.from + b.via + b.to));

  const acceptStates: string[] = [];
  for (const st of states) if (st.isAccept) acceptStates.push(st.id);

  const dot = buildDot(states, transitions, startId);

  const steps: DFASteps = {
    step1_augmented: "",
    step2_tokens: [],
    step2_tokens_with_concat: [],
    step2_postfix: [],
    step3_pos_to_sym: [],
    step4_6_node_dump: [],
    step7_followpos: [],
    step8_start_state: { positions: setToSortedArray(startSet) },
    step9_expansion_log: [],
    step9_transition_table: [],
    step10_accepting_states: acceptStates,
  };

  for (const st of states) {
    const per = expansionLogByKey.get(st.key) || [];
    steps.step9_expansion_log.push({
      state: st.id,
      positions: st.positions,
      perSymbol: per.map((x) => ({
        sym: x.sym,
        positionsWithSym: x.positionsWithSym,
        followUnion: x.followUnion,
        targetState: x.targetState,
      })),
    });
  }

  for (const st of states) {
    const rowMap = transMap.get(st.key) || new Map<string, string>();
    const rowOut: Record<string, string> = {};
    for (const a of alphabet) {
      const toKey = rowMap.get(a) ?? DEAD_KEY;
      rowOut[a] = keyToId.get(toKey) || "¿?";
    }
    steps.step9_transition_table.push({
      state: st.id,
      positions: st.positions,
      isAccept: st.isAccept,
      row: rowOut,
    });
  }

  return { alphabet, startId, states, transitions, dot, steps };
}

// ----------------------------
// Convertir -> DFAResult
// ----------------------------
function stringifyTok(tok: Tok): string {
  if (tok.t === "sym") return tok.v;
  if (tok.t === "lp") return "(";
  if (tok.t === "rp") return ")";
  return tok.v;
}

function convertRegexToDFA(userRegex: string): DFAResult {
  const startMs = nowMs();
  validateInputRegex(userRegex);

  NODE_ID = 0;

  // Paso 1: aumentar con #
  const augmented = "(" + userRegex + ")#";

  // Paso 2: tokens, concat explícita, postfix
  const toks = tokenize(augmented, startMs);
  const withConcat = insertExplicitConcat(toks, startMs);
  const postfix = toPostfix(withConcat, startMs);

  // Paso 3: árbol + posiciones
  const root = buildSyntaxTree(postfix, startMs);
  const { posToSym, hashPos } = assignPositions(root, startMs);

  // Paso 4-7: funciones + followpos
  const follow: FollowPos = new Map<number, Set<number>>();
  computeFunctions(root, follow, startMs);

  // DFA
  const built = buildDFA(root, posToSym, hashPos, follow, startMs);

  const dfa: DFAResult = {
    alphabet: built.alphabet,
    startId: built.startId,
    states: built.states,
    transitions: built.transitions,
    dot: built.dot,
    steps: built.steps,
    meta: {
      timingMs: nowMs() - startMs,
      truncated: { dotTooLarge: false, svgTooLarge: false },
      counts: {
        tokens: withConcat.length,
        nodes: NODE_ID,
        positions: posToSym.length - 1,
        states: built.states.length,
        transitions: built.transitions.length,
      },
      limits: LIMITS,
    },
  };

  // Completar pasos
  dfa.steps.step1_augmented = augmented;
  dfa.steps.step2_tokens = toks.map(stringifyTok);
  dfa.steps.step2_tokens_with_concat = withConcat.map(stringifyTok);
  dfa.steps.step2_postfix = postfix.map(stringifyTok);

  for (let p = 1; p < posToSym.length; p++) dfa.steps.step3_pos_to_sym.push({ pos: p, sym: posToSym[p] });

  dfa.steps.step4_6_node_dump = dumpNodes(root, startMs);

  for (let p = 1; p < posToSym.length; p++) {
    const fp = follow.get(p) || new Set<number>();
    dfa.steps.step7_followpos.push({ pos: p, sym: posToSym[p], follow: setToSortedArray(fp) });
  }

  dfa.trees = {
    baseDot: buildTreeDot(root, "base"),
    nullableDot: buildTreeDot(root, "nullable"),
    firstDot: buildTreeDot(root, "firstpos"),
    lastDot: buildTreeDot(root, "lastpos"),
    allDot: buildTreeDot(root, "all"),
  };

  if (dfa.dot.length > LIMITS.MAX_DOT_CHARS) dfa.meta.truncated.dotTooLarge = true;

  return dfa;
}

// ----------------------------
// Viz.js (DOT -> SVG) solo visualización
// ----------------------------
type VizRenderer = { render(dot: string): Promise<string> };
let vizRendererPromise: Promise<VizRenderer | null> | null = null;
let lastVizLoadError: string | null = null;

async function getNodeRequire(): Promise<any> {
  if (typeof require !== "undefined") return require;
  const mod: any = await import("module");
  const createRequire = mod.createRequire as (filename: string) => any;
  return createRequire(process.cwd() + "/__dummy__.js");
}

async function getVizRenderer(): Promise<VizRenderer | null> {
  if (vizRendererPromise) return vizRendererPromise;

  vizRendererPromise = (async () => {
    lastVizLoadError = null;
    try {
      const req = await getNodeRequire();
      const vizMod: any = req("viz.js");
      const fullRender: any = req("viz.js/full.render.js");

      const Viz = vizMod.default || vizMod;
      const viz = new Viz({ Module: fullRender.Module, render: fullRender.render });

      return {
        render: async (dot: string) => {
          const svg = await viz.renderString(dot);
          return String(svg);
        },
      };
    } catch (e: any) {
      lastVizLoadError = String(e?.stack || e?.message || e);
      return null;
    }
  })();

  return vizRendererPromise;
}

// ----------------------------
// HTTP Server + Render HTML
// ----------------------------
const PORT = 3000;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += String(chunk);
      if (data.length > LIMITS.MAX_BODY_BYTES) {
        reject(new Error("Body demasiado grande."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJSON(res: http.ServerResponse, status: number, obj: any) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(obj));
}

function renderFollowposTable(rows: { pos: number; sym: string; follow: number[] }[]): string {
  let html = '<table><thead><tr><th>pos</th><th>símbolo</th><th>followpos</th></tr></thead><tbody>';
  for (const r of rows) html += "<tr><td>" + r.pos + "</td><td>" + htmlEscape(r.sym) + "</td><td>{" + r.follow.join(",") + "}</td></tr>";
  html += "</tbody></table>";
  return html;
}

function renderPosTable(rows: { pos: number; sym: string }[]): string {
  let html = '<table><thead><tr><th>posición</th><th>símbolo</th></tr></thead><tbody>';
  for (const r of rows) html += "<tr><td>" + r.pos + "</td><td>" + htmlEscape(r.sym) + "</td></tr>";
  html += "</tbody></table>";
  return html;
}

function renderNodeDumpTable(dump: NodeDump[]): string {
  let html =
    '<table><thead><tr><th>nodeId</th><th>tipo</th><th>info</th><th>nullable</th><th>firstpos</th><th>lastpos</th></tr></thead><tbody>';
  for (const n of dump) {
    let info = "";
    if (n.kind === "leaf") info = "sym=" + (n.sym || "") + (n.pos ? " pos=" + n.pos : "");
    else if (n.kind === "star") info = "child=" + n.child;
    else info = "L=" + n.left + " R=" + n.right;

    html += "<tr>";
    html += "<td>" + n.id + "</td>";
    html += "<td>" + htmlEscape(n.kind) + "</td>";
    html += "<td>" + htmlEscape(info) + "</td>";
    html += "<td>" + (n.nullable ? "true" : "false") + "</td>";
    html += "<td>{" + n.first.join(",") + "}</td>";
    html += "<td>{" + n.last.join(",") + "}</td>";
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function renderTransitionTable(alphabet: string[], rows: { state: string; positions: number[]; isAccept: boolean; row: Record<string, string> }[]): string {
  let html = "<table><thead><tr><th>Estado</th><th>Posiciones</th>";
  for (const a of alphabet) html += "<th>" + htmlEscape(a) + "</th>";
  html += "</tr></thead><tbody>";

  for (const r of rows) {
    const posLabel = r.positions.length ? "{" + r.positions.join(",") + "}" : "∅";
    html += "<tr>";
    html += "<td>" + htmlEscape(r.state) + (r.isAccept ? " ✓" : "") + "</td>";
    html += "<td>" + htmlEscape(posLabel) + "</td>";
    for (const a of alphabet) html += "<td>" + htmlEscape(r.row[a]) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table>";
  return html;
}

function renderExpansionLog(log: DFASteps["step9_expansion_log"]): string {
  let html = "";
  for (const entry of log) {
    const posLabel = entry.positions.length ? "{" + entry.positions.join(",") + "}" : "∅";
    html += "<details open><summary><b>" + htmlEscape(entry.state) + "</b> = " + htmlEscape(posLabel) + "</summary>";
    html += "<table><thead><tr><th>Símbolo</th><th>Posiciones en S con símbolo</th><th>⋃ followpos(pos)</th><th>Destino</th></tr></thead><tbody>";
    for (const row of entry.perSymbol) {
      const pws = row.positionsWithSym.length ? "{" + row.positionsWithSym.join(",") + "}" : "∅";
      const fu = row.followUnion.length ? "{" + row.followUnion.join(",") + "}" : "∅";
      html += "<tr><td>" + htmlEscape(row.sym) + "</td><td>" + htmlEscape(pws) + "</td><td>" + htmlEscape(fu) + "</td><td>" + htmlEscape(row.targetState) + "</td></tr>";
    }
    html += "</tbody></table></details>";
  }
  return html;
}

function wrapSvgOrDot(svg: string | undefined, dot: string): string {
  if (svg) return "<div class='svgWrap'>" + svg + "</div>";
  return "<pre style='background:#f6f6f6;padding:10px;overflow:auto;'>" + htmlEscape(dot) + "</pre>";
}

function renderSSRPage(dfa: DFAResult, svg: string | null, warnNoViz: boolean, vizErr: string | null): string {
  const re = dfa.steps.step1_augmented;
  const tokens = dfa.steps.step2_tokens.join(" ");
  const tokensC = dfa.steps.step2_tokens_with_concat.join(" ");
  const postfix = dfa.steps.step2_postfix.join(" ");

  const posTable = renderPosTable(dfa.steps.step3_pos_to_sym);
  const nodeDumpTable = renderNodeDumpTable(dfa.steps.step4_6_node_dump);
  const followTable = renderFollowposTable(dfa.steps.step7_followpos);
  const expansionHtml = renderExpansionLog(dfa.steps.step9_expansion_log);
  const transTable = renderTransitionTable(dfa.alphabet, dfa.steps.step9_transition_table);

  let treesHtml = "";
  if (dfa.trees) {
    treesHtml += "<details open><summary><b>Árbol base</b></summary>" + wrapSvgOrDot(dfa.trees.baseSvg, dfa.trees.baseDot) + "</details>";
    treesHtml += "<details><summary><b>Árbol nullable</b></summary>" + wrapSvgOrDot(dfa.trees.nullableSvg, dfa.trees.nullableDot) + "</details>";
    treesHtml += "<details><summary><b>Árbol firstpos</b></summary>" + wrapSvgOrDot(dfa.trees.firstSvg, dfa.trees.firstDot) + "</details>";
    treesHtml += "<details><summary><b>Árbol lastpos</b></summary>" + wrapSvgOrDot(dfa.trees.lastSvg, dfa.trees.lastDot) + "</details>";
    treesHtml += "<details><summary><b>Árbol all</b></summary>" + wrapSvgOrDot(dfa.trees.allSvg, dfa.trees.allDot) + "</details>";
  }


  let simHtml = "";
  if (dfa.test) {
    const ok = dfa.test.accepted;
    simHtml += "<div style='margin:6px 0;color:" + (ok ? "#1b5e20" : "#b00020") + ";'><b>" + (ok ? "ACEPTADA" : "RECHAZADA") + "</b> | fin=" + htmlEscape(dfa.test.end) + "</div>";
    simHtml += "<details open><summary>Ver recorrido</summary>";
    simHtml += "<table><thead><tr><th>i</th><th>sym</th><th>from</th><th>to</th><th>nota</th></tr></thead><tbody>";
    for (const step of dfa.test.path) {
      simHtml += "<tr><td>" + step.index + "</td><td>" + htmlEscape(step.symbol) + "</td><td>" + htmlEscape(step.from) + "</td><td>" + (step.to ? htmlEscape(step.to) : "∅") + "</td><td>" + htmlEscape(step.note || "") + "</td></tr>";
    }
    simHtml += "</tbody></table></details>";
  }

  const svgBlock = svg ? svg : "<pre style='background:#f6f6f6;padding:10px;overflow:auto;'>" + htmlEscape(dfa.dot) + "</pre>";

  const warning = warnNoViz
    ? "<div style='color:#b00020;margin:10px 0;'>No se pudo generar SVG desde el backend. " +
      "Instala en ESTE folder: <code>npm i viz.js</code><br/>" +
      (vizErr ? ("Detalle: <pre style='white-space:pre-wrap;background:#f6f6f6;padding:8px;'>" + htmlEscape(vizErr) + "</pre>") : "") +
      "</div>"
    : "";

  const metaLine =
    "Tiempo: " + dfa.meta.timingMs + "ms | tokens=" + dfa.meta.counts.tokens +
    " | nodos=" + dfa.meta.counts.nodes + " | posiciones=" + dfa.meta.counts.positions +
    " | estados=" + dfa.meta.counts.states + " | trans=" + dfa.meta.counts.transitions +
    (dfa.meta.truncated.dotTooLarge ? " | ⚠ DOT muy grande" : "") +
    (dfa.meta.truncated.svgTooLarge ? " | ⚠ SVG muy grande" : "");

  const css =
    "body{font-family:system-ui,Arial,sans-serif;margin:18px}" +
    "code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}" +
    "table{border-collapse:collapse;width:100%}" +
    "th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}" +
    ".svgWrap{border:1px solid #eee;padding:10px;overflow:auto;margin:8px 0}" +
    ".svgWrap svg{max-width:100%;height:auto}" +
    "details{margin:8px 0}" +
    "summary{cursor:pointer}" +
    "h2,h3{margin-top:18px}" +
    ".meta{color:#333;margin:6px 0 14px 0}";

  return (
    "<!doctype html><html lang='es'><head><meta charset='utf-8'/>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'/>" +
    "<title>Regex → AFD (Directo)</title><style>" +
    css +
    "</style></head><body>" +
    "<h2>Regex → AFD (Conversión directa, Dragon Book)</h2>" +
    "<div class='meta'><b>" + htmlEscape(metaLine) + "</b></div>" +
    warning +
    "<h3>Diagrama AFD</h3><div class='svgWrap'>" + svgBlock + "</div>" +
    "<h3>Simulación de cadena</h3>" + (simHtml || "<div class='hint'>Usa /render?re=...&s=CADENA para simular.</div>") +
    "<h3>Árboles del método directo</h3>" + treesHtml +
    "<h3>Paso 1: Expresión aumentada</h3><pre>" + htmlEscape(re) + "</pre>" +
    "<h3>Paso 2: Tokens</h3><pre>" + htmlEscape(tokens) + "</pre>" +
    "<h3>Paso 2: Tokens con concatenación (·)</h3><pre>" + htmlEscape(tokensC) + "</pre>" +
    "<h3>Paso 2: Postfija (RPN)</h3><pre>" + htmlEscape(postfix) + "</pre>" +
    "<h3>Paso 3: Posiciones (pos→símbolo)</h3>" + posTable +
    "<h3>Pasos 4–6: nullable / firstpos / lastpos por nodo</h3>" + nodeDumpTable +
    "<h3>Paso 7: followpos</h3>" + followTable +
    "<h3>Paso 8: Estado inicial</h3><pre>{" + dfa.steps.step8_start_state.positions.join(",") + "}</pre>" +
    "<h3>Paso 9: Construcción paso a paso</h3>" + expansionHtml +
    "<h3>Paso 9: Tabla de transición</h3>" + transTable +
    "<h3>Paso 10: Aceptación (contienen #)</h3><pre>" + htmlEscape(dfa.steps.step10_accepting_states.join(", ")) + "</pre>" +
    "<details><summary>Ver JSON completo</summary><pre>" + htmlEscape(JSON.stringify(dfa, null, 2)) + "</pre></details>" +
    "</body></html>"
  );
}

// UI mínima (renderiza todos los pasos)
const INDEX_HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Regex → AFD (Directo)</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;margin:18px}
    textarea{width:100%;height:70px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
    button{padding:10px 14px;margin-top:10px;cursor:pointer}
    pre{background:#f6f6f6;padding:10px;overflow:auto}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
    .err{color:#b00020;white-space:pre-wrap}
    .ok{color:#1b5e20}
    .hint{color:#444;font-size:0.95rem;margin-bottom:10px}
    .svgWrap{border:1px solid #eee;padding:10px;overflow:auto;margin:8px 0}
    .svgWrap svg{max-width:100%;height:auto}
    details{margin:8px 0}
    summary{cursor:pointer}
    .meta{color:#333;margin:8px 0}
  </style>
</head>
<body>
  <h2>Conversión directa: Expresión Regular → AFD</h2>
  <div class="hint">
    Operadores: <b>|</b>, <b>*</b>, <b>+</b>, <b>?</b>, <b>( )</b>. Concatenación implícita.<br/>
    Epsilon: usa <b>ε</b>. Escape: <b>\\</b> (ej: \\| literal '|').<br/>
    <b>Importante:</b> '#' está reservado (sentinela).<br/>
    SVG backend: <code>npm i viz.js</code>
  </div>

  <textarea id="re">(a|b)*abb</textarea><br/>
  <label><b>Cadena a evaluar:</b></label><br/>
  <input id="str" value="abb" style="width:100%;padding:6px;margin:6px 0" />
  <button id="run">Convertir</button>
  <div id="status"></div>
  <div id="meta" class="meta"></div>

  <h3>Diagrama AFD</h3>
  <div id="svgBox" class="svgWrap"></div>

  <h3>Simulación de cadena</h3>
  <div id="simBox"></div>
  <details><summary>Ver recorrido</summary><div id="simPath"></div></details>

  <h3>Árboles del método directo</h3>
  <div id="treesBox"></div>

  <h3>Paso 1: Expresión aumentada</h3>
  <pre id="aug"></pre>

  <h3>Paso 2: Tokens</h3>
  <pre id="toks"></pre>

  <h3>Paso 2: Tokens con concatenación (·)</h3>
  <pre id="toksC"></pre>

  <h3>Paso 2: Postfija (RPN)</h3>
  <pre id="post"></pre>

  <h3>Paso 3: Posiciones (pos→símbolo)</h3>
  <div id="posBox"></div>

  <h3>Pasos 4–6: nullable / firstpos / lastpos por nodo</h3>
  <div id="nodeBox"></div>

  <h3>Paso 7: followpos</h3>
  <div id="followBox"></div>

  <h3>Paso 9: Construcción paso a paso</h3>
  <div id="expBox"></div>

  <h3>Paso 9: Tabla de transición</h3>
  <div id="transBox"></div>

  <h3>Paso 10: Estados de aceptación</h3>
  <pre id="acc"></pre>

  <details>
    <summary>Ver pasos en JSON (debug)</summary>
    <pre id="json"></pre>
  </details>

<script>
  function esc(s){
    let out="";
    s = String(s||"");
    for(let i=0;i<s.length;i++){
      const ch=s[i];
      if(ch==="&") out+="&amp;";
      else if(ch==="<") out+="&lt;";
      else if(ch===">") out+="&gt;";
      else if(ch==='"') out+="&quot;";
      else out+=ch;
    }
    return out;
  }

  function tablePos(rows){
    let html="<table><thead><tr><th>pos</th><th>sym</th></tr></thead><tbody>";
    for(const r of rows){ html+="<tr><td>"+r.pos+"</td><td>"+esc(r.sym)+"</td></tr>"; }
    html+="</tbody></table>";
    return html;
  }

  function tableNodes(rows){
    let html="<table><thead><tr><th>nodeId</th><th>tipo</th><th>info</th><th>nullable</th><th>firstpos</th><th>lastpos</th></tr></thead><tbody>";
    for(const n of rows){
      let info="";
      if(n.kind==="leaf") info="sym="+(n.sym||"")+(n.pos?(" pos="+n.pos):"");
      else if(n.kind==="star") info="child="+n.child;
      else info="L="+n.left+" R="+n.right;
      html+="<tr><td>"+n.id+"</td><td>"+esc(n.kind)+"</td><td>"+esc(info)+"</td><td>"+(n.nullable?"true":"false")+"</td><td>{"+(n.first||[]).join(",")+"}</td><td>{"+(n.last||[]).join(",")+"}</td></tr>";
    }
    html+="</tbody></table>";
    return html;
  }

  function tableFollow(rows){
    let html="<table><thead><tr><th>pos</th><th>sym</th><th>followpos</th></tr></thead><tbody>";
    for(const r of rows){ html+="<tr><td>"+r.pos+"</td><td>"+esc(r.sym)+"</td><td>{"+(r.follow||[]).join(",")+"}</td></tr>"; }
    html+="</tbody></table>";
    return html;
  }

  function tableTrans(alpha, rows){
    let html="<table><thead><tr><th>Estado</th><th>Posiciones</th>";
    for(const a of alpha) html+="<th>"+esc(a)+"</th>";
    html+="</tr></thead><tbody>";
    for(const r of rows){
      const pos=r.positions.length?("{"+r.positions.join(",")+"}"):"∅";
      html+="<tr><td>"+esc(r.state)+(r.isAccept?" ✓":"")+"</td><td>"+esc(pos)+"</td>";
      for(const a of alpha) html+="<td>"+esc(r.row[a])+"</td>";
      html+="</tr>";
    }
    html+="</tbody></table>";
    return html;
  }

  function renderExpansion(log){
    if(!log || !log.length) return "<div class='err'>Sin log.</div>";
    let html="";
    for(const e of log){
      const pos = e.positions.length ? ("{"+e.positions.join(",")+"}") : "∅";
      html += "<details open><summary><b>"+esc(e.state)+"</b> = "+esc(pos)+"</summary>";
      html += "<table><thead><tr><th>sym</th><th>pos en S</th><th>⋃ followpos</th><th>destino</th></tr></thead><tbody>";
      for(const r of e.perSymbol){
        const pws = r.positionsWithSym.length?("{"+r.positionsWithSym.join(",")+"}"):"∅";
        const fu = r.followUnion.length?("{"+r.followUnion.join(",")+"}"):"∅";
        html += "<tr><td>"+esc(r.sym)+"</td><td>"+esc(pws)+"</td><td>"+esc(fu)+"</td><td>"+esc(r.targetState)+"</td></tr>";
      }
      html += "</tbody></table></details>";
    }
    return html;
  }

  function wrapSvg(svg, dot){
    if(svg) return "<div class='svgWrap'>"+svg+"</div>";
    return "<pre>"+esc(dot||"")+"</pre>";
  }

  function renderTrees(trees){
    if(!trees) return "<div class='err'>No hay árboles.</div>";
    let html="";
    html += "<details open><summary><b>Base</b></summary>"+wrapSvg(trees.baseSvg, trees.baseDot)+"</details>";
    html += "<details><summary><b>nullable</b></summary>"+wrapSvg(trees.nullableSvg, trees.nullableDot)+"</details>";
    html += "<details><summary><b>firstpos</b></summary>"+wrapSvg(trees.firstSvg, trees.firstDot)+"</details>";
    html += "<details><summary><b>lastpos</b></summary>"+wrapSvg(trees.lastSvg, trees.lastDot)+"</details>";
    html += "<details><summary><b>all</b></summary>"+wrapSvg(trees.allSvg, trees.allDot)+"</details>";
    return html;
  }

  async function run(){
    const re=document.getElementById("re").value;
    const s=document.getElementById("str").value;
    const status=document.getElementById("status");
    const meta=document.getElementById("meta");
    status.className="";
    status.textContent="Procesando...";
    meta.textContent="";

    const resp=await fetch("/api/convert",{
      method:"POST",
      headers:{ "content-type":"application/json" },
      body: JSON.stringify({ regex: re, input: s })
    });
    const data=await resp.json();
    if(!resp.ok){
      status.className="err";
      status.textContent=data && data.error ? data.error : "Error";
      return;
    }
    status.className="ok";
    status.textContent="OK";

    if(data.meta){
      meta.textContent =
        "Tiempo: "+data.meta.timingMs+"ms | tokens="+data.meta.counts.tokens+
        " | nodos="+data.meta.counts.nodes+" | posiciones="+data.meta.counts.positions+
        " | estados="+data.meta.counts.states+" | trans="+data.meta.counts.transitions;
    }

    document.getElementById("json").textContent=JSON.stringify(data, null, 2);

    const box=document.getElementById("svgBox");
    if(data.svg) box.innerHTML=data.svg;
    else {
      const detail = data.vizError ? ("<pre>"+esc(String(data.vizError))+"</pre>") : "";
      box.innerHTML="<div class='err'>No hay SVG. Instala en ESTE folder: <code>npm i viz.js</code></div>"+detail+"<pre>"+esc(data.dot)+"</pre>";
    }

    document.getElementById("treesBox").innerHTML = renderTrees(data.trees);

    // Simulación (si viene test)
    const simBox = document.getElementById("simBox");
    const simPath = document.getElementById("simPath");
    if (data.test && typeof data.test === "object") {
      const ok = !!data.test.accepted;
      simBox.innerHTML =
        "<div class='" + (ok ? "ok" : "err") + "'><b>" +
        (ok ? "ACEPTADA" : "RECHAZADA") +
        "</b> | fin=" + esc(String(data.test.end)) + "</div>";
      // recorrido como tabla
      let t = "<table><thead><tr><th>i</th><th>sym</th><th>from</th><th>to</th><th>nota</th></tr></thead><tbody>";
      const path = data.test.path || [];
      for (const step of path) {
        t += "<tr><td>" + step.index + "</td><td>" + esc(step.symbol) + "</td><td>" + esc(step.from) + "</td><td>" + (step.to ? esc(step.to) : "∅") + "</td><td>" + esc(step.note || "") + "</td></tr>";
      }
      t += "</tbody></table>";
      simPath.innerHTML = t;
    } else {
      simBox.innerHTML = "<div class='hint'>Envía una cadena para simular (usa el input arriba).</div>";
      simPath.innerHTML = "";
    }

    document.getElementById("aug").textContent = data.steps.step1_augmented;
    document.getElementById("toks").textContent = data.steps.step2_tokens.join(" ");
    document.getElementById("toksC").textContent = data.steps.step2_tokens_with_concat.join(" ");
    document.getElementById("post").textContent = data.steps.step2_postfix.join(" ");
    document.getElementById("posBox").innerHTML = tablePos(data.steps.step3_pos_to_sym);
    document.getElementById("nodeBox").innerHTML = tableNodes(data.steps.step4_6_node_dump);
    document.getElementById("followBox").innerHTML = tableFollow(data.steps.step7_followpos);
    document.getElementById("expBox").innerHTML = renderExpansion(data.steps.step9_expansion_log);
    document.getElementById("transBox").innerHTML = tableTrans(data.alphabet, data.steps.step9_transition_table);
    document.getElementById("acc").textContent = data.steps.step10_accepting_states.join(", ");
  }

  document.getElementById("run").addEventListener("click", run);
  run();
</script>
</body></html>`;

// ----------------------------
// Server
// ----------------------------
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  try {
    const u = new URL(req.url || "/", "http://localhost");

    // UI
    if (req.method === "GET" && u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(INDEX_HTML);
      return;
    }

    // SSR completo
    if (req.method === "GET" && u.pathname === "/render") {
      const reParam = u.searchParams.get("re") || "(a|b)*abb";
      let dfa: DFAResult;
      try {
        dfa = convertRegexToDFA(reParam);
      } catch (e: any) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Error: " + String(e?.message || e));
        return;
      }

      // Simulación opcional por query param: ?s=CADENA (o ?input=CADENA)
      const sParam = u.searchParams.get("s");
      const sParam2 = u.searchParams.get("input");
      const simStr = (sParam !== null ? sParam : sParam2);
      if (simStr !== null) {
        try { dfa.test = simulateDFA(dfa, String(simStr)); } catch { /* no throw */ }
      }

      const viz = await getVizRenderer();
      let svg: string | null = null;
      let warnNoViz = false;

      if (viz && !dfa.meta.truncated.dotTooLarge) {
        try {
          svg = await viz.render(dfa.dot);
          if (svg.length > LIMITS.MAX_SVG_CHARS) {
            dfa.meta.truncated.svgTooLarge = true;
            svg = null;
          }
          if (dfa.trees) {
            try { dfa.trees.baseSvg = await viz.render(dfa.trees.baseDot); } catch {}
            try { dfa.trees.nullableSvg = await viz.render(dfa.trees.nullableDot); } catch {}
            try { dfa.trees.firstSvg = await viz.render(dfa.trees.firstDot); } catch {}
            try { dfa.trees.lastSvg = await viz.render(dfa.trees.lastDot); } catch {}
            try { dfa.trees.allSvg = await viz.render(dfa.trees.allDot); } catch {}
          }
        } catch {
          svg = null;
          warnNoViz = true;
        }
      } else {
        warnNoViz = true;
      }

      const page = renderSSRPage(dfa, svg, warnNoViz, lastVizLoadError);

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page);
      return;
    }

    // SVG directo
    if (req.method === "GET" && u.pathname === "/dfa.svg") {
      const reParam = u.searchParams.get("re") || "(a|b)*abb";
      let dfa: DFAResult;
      try {
        dfa = convertRegexToDFA(reParam);
      } catch (e: any) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("Error: " + String(e?.message || e));
        return;
      }

      if (dfa.meta.truncated.dotTooLarge) {
        res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
        res.end("DOT demasiado grande para renderizar SVG. Reduce la regex o los límites.");
        return;
      }

      const viz = await getVizRenderer();
      if (!viz) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end("No se pudo cargar viz.js. Instala en ESTE folder: npm i viz.js\nDetalle: " + (lastVizLoadError || ""));
        return;
      }

      try {
        const svg = await viz.render(dfa.dot);
        if (svg.length > LIMITS.MAX_SVG_CHARS) {
          res.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
          res.end("SVG demasiado grande. Reduce la regex o los límites.");
          return;
        }
        res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8" });
        res.end(svg);
      } catch (e: any) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Error renderizando SVG: " + String(e?.message || e));
      }
      return;
    }

    // API JSON
    if (req.method === "POST" && u.pathname === "/api/convert") {
      const body = await readBody(req);
      let payload: any;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        sendJSON(res, 400, { error: "JSON inválido" });
        return;
      }

      const regex = payload && typeof payload.regex === "string" ? payload.regex : "";
      if (!regex) {
        sendJSON(res, 400, { error: "Falta 'regex' en el body" });
        return;
      }

      let dfa: DFAResult;
      try {
        dfa = convertRegexToDFA(regex);
      } catch (e: any) {
        sendJSON(res, 400, { error: String(e?.message || e) });
        return;
      }

      // Simulación opcional: si envías { input: "cadena" } también devuelve accepted/path
      if (payload && typeof payload.input === "string") {
        try { dfa.test = simulateDFA(dfa, String(payload.input)); } catch { /* ignore */ }
      }

      const viz = await getVizRenderer();
      if (viz && !dfa.meta.truncated.dotTooLarge) {
        try {
          const svg = await viz.render(dfa.dot);
          if (svg.length <= LIMITS.MAX_SVG_CHARS) dfa.svg = svg;
          else dfa.meta.truncated.svgTooLarge = true;

          if (dfa.trees) {
            try { dfa.trees.baseSvg = await viz.render(dfa.trees.baseDot); } catch {}
            try { dfa.trees.nullableSvg = await viz.render(dfa.trees.nullableDot); } catch {}
            try { dfa.trees.firstSvg = await viz.render(dfa.trees.firstDot); } catch {}
            try { dfa.trees.lastSvg = await viz.render(dfa.trees.lastDot); } catch {}
            try { dfa.trees.allSvg = await viz.render(dfa.trees.allDot); } catch {}
          }
        } catch {
          // ok: devolvemos DOT
        }
      } else {
        dfa.vizError = lastVizLoadError || "viz.js no pudo cargarse. Instala en ESTE folder: npm i viz.js";
      }

      sendJSON(res, 200, dfa);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (e: any) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Server error: " + String(e?.message || e));
  }
});

server.listen(PORT, () => {
  console.log("Servidor listo: http://localhost:" + PORT);
  console.log("SSR sin frontend: http://localhost:" + PORT + "/render?re=(a|b)*abb");
});

console.log('BOOT OK');

