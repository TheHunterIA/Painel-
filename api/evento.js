// Recebe um evento do jogo (navigator.sendBeacon, corpo JSON em texto): { s: sessão, e: nome, x: dados, t: hora }.
// Guarda só contadores agregados e anônimos; nada pessoal. Qualquer um pode enviar, então tudo é validado e limitado.
// Cada contador é gravado duas vezes: no total geral (chaves antigas) e no dia (chaves dn:/dm:/djog:/dvenc:), para o painel filtrar por dia.
import { banco } from '../lib/banco.js';

const NOME = /^[a-z][a-z0-9_]{0,31}$/;
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max ? v : null;
// tempos podem chegar com decimais (ex.: 12.4 s): arredonda antes de validar
const tempo = (v, min, max) => typeof v === 'number' && isFinite(v) ? inteiro(Math.round(v), min, max) : null;

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
  // origem: CrazyGames ('cg:' na frente de cada chave) ou fora (sem prefixo; os dados de antes da separação ficam aqui)
  const pre = d.o === 'cg' ? 'cg:' : '';
  const pl = banco.pipeline();
  const p = { exec: () => pl.exec() };
  for (const m of ['hincrby', 'pfadd', 'lpush', 'ltrim']) p[m] = (k, ...a) => { pl[m](pre + k, ...a); return p; };
  const dm = 'dm:' + dia;                       // contadores diversos do dia (campos com prefixo: ev:, dp:, ca:, cp:, cpn:, er:)
  p.hincrby('eventos', e, 1); p.hincrby(dm, 'ev:' + e, 1);
  // contador de uma noite: total geral + dia
  const noite = (n, volta) => (campo, v) => { p.hincrby('noite:' + volta + ':' + n, campo, v); p.hincrby('dn:' + dia + ':' + volta, n + ':' + campo, v); };

  if (e === 'sessao') {
    p.pfadd('sess:dia:' + dia, s); p.pfadd('sess:total', s); p.hincrby('sess:aberturas', dia, 1);
    p.hincrby('d:dias', dia, 1);                // marca os dias que já têm detalhe por dia
    if (x.novo === true) p.hincrby('novos', dia, 1);
    const dias = inteiro(x.dias, 0, 3650);
    const volta1 = x.novo !== true && x.pd === true;                                  // só a 1ª abertura do dia de quem já jogava
    if (volta1 && dias === 1) p.hincrby('ret1', dia, 1);                                // voltou no dia seguinte à primeira vez
    if (volta1 && dias === 7) p.hincrby('ret7', dia, 1);                                // voltou 7 dias depois
    if (x.disp === 'cel' || x.disp === 'pc') { p.hincrby('disp', x.disp, 1); p.hincrby(dm, 'dp:' + x.disp, 1); }
  }
  else if (e === 'tempo') { const seg = tempo(x.seg, 1, 4 * 3600); if (seg) p.hincrby('tempo', dia, seg); }
  else if (e === 'carregou') {
    const ms = tempo(x.ms, 1, 180000), dp = x.disp === 'cel' ? 'cel' : 'pc';
    if (ms) { p.hincrby('carga', dp + ':soma', ms); p.hincrby('carga', dp + ':n', 1); p.hincrby(dm, 'ca:' + dp + ':soma', ms); p.hincrby(dm, 'ca:' + dp + ':n', 1); }
  }
  else if (e === 'compra') {
    const k = typeof x.k === 'string' && /^[a-z]{2,10}$/.test(x.k) ? x.k : null, n = inteiro(x.n, 1, 25);
    if (k) { p.hincrby('compras', k, 1); p.hincrby(dm, 'cp:' + k, 1); if (n) { p.hincrby('compras:noite', k, n); p.hincrby(dm, 'cpn:' + k, n); } }
  }
  else if (e === 'noite_abandono') {
    const n = inteiro(x.n, 1, 24), volta = inteiro(x.volta, 1, 99), t = tempo(x.t, 0, 3600);
    if (n && volta) { const c = noite(n, volta); c('aband', 1); if (t !== null) c('tempoAband', t); }
  }
  else if (e === 'noite_inicio' || e === 'noite_fim') {
    const n = inteiro(x.n, 1, 24), volta = inteiro(x.volta, 1, 99);
    if (n && volta) {
      const k = volta + ':' + n, c = noite(n, volta);
      if (e === 'noite_inicio') { c('ini', 1); p.pfadd('jog:' + k, s); p.pfadd('djog:' + dia + ':' + k, s); p.pfadd('sess:dia:' + dia, s); }
      else {
        c(x.vitoria ? 'vit' : 'der', 1);
        const t = tempo(x.tempo, 0, 3600); if (t !== null) c(x.vitoria ? 'tempoVit' : 'tempoDer', t);
        if (x.vitoria) { const des = inteiro(x.des, 0, 2); if (des !== null) c('des', des);
          p.pfadd('venc:' + k, s); p.pfadd('dvenc:' + dia + ':' + k, s);
          const vida = typeof x.vida === 'number' && isFinite(x.vida) ? Math.round(Math.max(0, Math.min(1, x.vida)) * 100) : null; if (vida !== null) c('vida', vida); }
      }
    }
  } else if (e === 'erro') {
    const m = typeof x.m === 'string' ? x.m.slice(0, 160) : '?';
    p.lpush('erros', JSON.stringify({ t: Date.now(), m }));
    p.ltrim('erros', 0, 199);
    p.hincrby('erros:cont', m.slice(0, 80), 1); p.hincrby(dm, 'er:' + m.slice(0, 80), 1);
  }
  try { await p.exec(); } catch (err) { console.error('banco', err); return res.status(500).end(); }
  return res.status(204).end();
}
