// Recebe um evento do jogo (navigator.sendBeacon, corpo JSON em texto): { s: sessão, e: nome, x: dados, t: hora }.
// Guarda só contadores agregados e anônimos; nada pessoal. Qualquer um pode enviar, então tudo é validado e limitado.
import { banco } from '../lib/banco.js';

const NOME = /^[a-z][a-z0-9_]{0,31}$/;
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max ? v : null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  let d = req.body;
  try {
    if (Buffer.isBuffer(d)) d = d.toString('utf8');
    if (typeof d === 'string') { if (d.length > 2000) return res.status(413).end(); d = JSON.parse(d); }
  } catch (e) { return res.status(400).end(); }
  if (!d || typeof d !== 'object') return res.status(400).end();

  const s = typeof d.s === 'string' && /^[a-z0-9]{4,16}$/.test(d.s) ? d.s : null;
  const e = typeof d.e === 'string' && NOME.test(d.e) ? d.e : null;
  const x = d.x && typeof d.x === 'object' ? d.x : {};
  if (!s || !e) return res.status(400).end();

  const dia = new Date().toISOString().slice(0, 10);   // UTC, igual ao jogo
  const p = banco.pipeline();
  p.hincrby('eventos', e, 1);

  if (e === 'sessao') { p.pfadd('sess:dia:' + dia, s); p.pfadd('sess:total', s); p.hincrby('sess:aberturas', dia, 1); }
  else if (e === 'noite_inicio' || e === 'noite_fim') {
    const n = inteiro(x.n, 1, 24), volta = inteiro(x.volta, 1, 99);
    if (n && volta) {
      const k = volta + ':' + n;
      if (e === 'noite_inicio') { p.hincrby('noite:' + k, 'ini', 1); p.pfadd('jog:' + k, s); p.pfadd('sess:dia:' + dia, s); }
      else {
        p.hincrby('noite:' + k, x.vitoria ? 'vit' : 'der', 1);
        const tempo = inteiro(x.tempo, 0, 3600); if (tempo !== null) p.hincrby('noite:' + k, x.vitoria ? 'tempoVit' : 'tempoDer', tempo);
        if (x.vitoria) { p.pfadd('venc:' + k, s); const vida = typeof x.vida === 'number' ? Math.round(Math.max(0, Math.min(1, x.vida)) * 100) : null; if (vida !== null) p.hincrby('noite:' + k, 'vida', vida); }
      }
    }
  } else if (e === 'erro') {
    const m = typeof x.m === 'string' ? x.m.slice(0, 160) : '?';
    p.lpush('erros', JSON.stringify({ t: Date.now(), m }));
    p.ltrim('erros', 0, 199);
    p.hincrby('erros:cont', m.slice(0, 80), 1);
  }
  try { await p.exec(); } catch (err) { console.error('banco', err); return res.status(500).end(); }
  return res.status(204).end();
}
