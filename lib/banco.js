// Banco: Upstash Redis (instalado pela integração do Vercel). Sem as variáveis, usa memória (só para testar localmente).
import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

function memoria() {
  const h = new Map(), sets = new Map(), listas = new Map();
  const hash = k => h.get(k) || h.set(k, {}).get(k);
  const api = {
    async hincrby(k, f, n) { const o = hash(k); o[f] = (o[f] || 0) + n; return o[f]; },
    async hgetall(k) { return h.has(k) ? { ...h.get(k) } : null; },
    async pfadd(k, ...v) { const s = sets.get(k) || sets.set(k, new Set()).get(k); v.forEach(x => s.add(x)); return 1; },
    async pfcount(...keys) { const uniao = new Set(); for (const k of keys) for (const v of (sets.get(k) || new Set())) uniao.add(v); return uniao.size; },
    async lpush(k, ...v) { const l = listas.get(k) || listas.set(k, []).get(k); l.unshift(...v); return l.length; },
    async ltrim(k, a, b) { const l = listas.get(k) || []; listas.set(k, l.slice(a, b + 1)); return 'OK'; },
    async lrange(k, a, b) { return (listas.get(k) || []).slice(a, b + 1); },
    pipeline() { const fila = []; const p = new Proxy({}, { get: (_, nome) => nome === 'exec' ? async () => Promise.all(fila.map(f => f())) : (...a) => { fila.push(() => api[nome](...a)); return p; } }); return p; },
  };
  return api;
}

export const banco = url && token ? new Redis({ url, token }) : (globalThis.__bancoMemoria ||= memoria());
export const configurado = !!(url && token);
