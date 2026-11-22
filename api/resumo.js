// Resumo para o painel (protegido pela senha da variável PAINEL_SENHA, enviada no cabeçalho x-senha).
// ?origem=cg (CrazyGames), fora (fora dela) ou todos (soma das duas). ?volta=N escolhe a volta do funil.
import { banco, configurado } from '../lib/banco.js';

const PREFIXOS = { cg: ['cg:'], fora: [''], todos: ['cg:', ''] };
const HASHES = ['sess:aberturas', 'eventos', 'erros:cont', 'novos', 'ret1', 'ret7', 'tempo', 'disp', 'carga', 'compras', 'compras:noite'];

// lê os dados brutos de uma origem (prefixo das chaves)
async function coletar(pre, volta, dias) {
  const p = banco.pipeline();
  for (let n = 1; n <= 24; n++) { const k = volta + ':' + n; p.hgetall(pre + 'noite:' + k); p.pfcount(pre + 'jog:' + k); p.pfcount(pre + 'venc:' + k); }
  for (const d of dias) p.pfcount(pre + 'sess:dia:' + d);
  p.pfcount(pre + 'sess:total'); p.lrange(pre + 'erros', 0, 49);
  for (const h of HASHES) p.hgetall(pre + h);
  const r = await p.exec(); let i = 0;
  const bruto = { noites: [], dias: [], hashes: {} };
  for (let n = 1; n <= 24; n++) bruto.noites.push({ h: r[i++] || {}, jog: r[i++] || 0, venc: r[i++] || 0 });
  for (let j = 0; j < dias.length; j++) bruto.dias.push(r[i++] || 0);
  bruto.total = r[i++] || 0;
  bruto.erros = (r[i++] || []).map(e => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch (x) { return { m: String(e) }; } });
  for (const h of HASHES) bruto.hashes[h] = r[i++] || {};
  return bruto;
}
// soma duas origens (uma sessão só existe numa delas, então somar as contagens não duplica ninguém)
const somarHash = (a, b) => { const o = { ...a }; for (const k in b) o[k] = +(o[k] || 0) + +(b[k] || 0); return o; };
function somar(a, b) {
  return {
    noites: a.noites.map((x, i) => ({ h: somarHash(x.h, b.noites[i].h), jog: x.jog + b.noites[i].jog, venc: x.venc + b.noites[i].venc })),
    dias: a.dias.map((x, i) => x + b.dias[i]), total: a.total + b.total,
    erros: a.erros.concat(b.erros).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 50),
    hashes: Object.fromEntries(HASHES.map(h => [h, somarHash(a.hashes[h], b.hashes[h])])),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const senha = process.env.PAINEL_SENHA;
  if (!senha) return res.status(500).json({ erro: 'Defina a variável PAINEL_SENHA no Vercel.' });
  if (req.headers['x-senha'] !== senha) return res.status(401).json({ erro: 'Senha incorreta.' });

  const volta = Math.max(1, Math.min(99, parseInt(req.query.volta, 10) || 1));
  const origem = PREFIXOS[req.query.origem] ? req.query.origem : 'todos';
  const dias = [];
  for (let i = 14; i >= 0; i--) dias.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));   // 15 dias: o 1º só serve de base para o D1

  const partes = await Promise.all(PREFIXOS[origem].map(pre => coletar(pre, volta, dias)));
  const b = partes.reduce(somar);
  const H = b.hashes, nOf = (o, k) => +(o[k] || 0);

  const noites = b.noites.map((x, i) => {
    const num = k => nOf(x.h, k);
    return { n: i + 1, jogadores: x.jog, vencedores: x.venc, ini: num('ini'), vit: num('vit'), der: num('der'), aband: num('aband'),
      tempoAband: num('aband') ? Math.round(num('tempoAband') / num('aband')) : null, desafios: num('vit') ? Math.round(num('des') / (num('vit') * 2) * 100) : null,
      tempoVit: num('vit') ? Math.round(num('tempoVit') / num('vit')) : null, tempoDer: num('der') ? Math.round(num('tempoDer') / num('der')) : null,
      vida: num('vit') ? Math.round(num('vida') / num('vit')) : null };
  });
  const diaAntes = (d, k) => new Date(Date.parse(d) - k * 864e5).toISOString().slice(0, 10);
  let porDia = dias.map((dia, j) => {
    const jogadores = b.dias[j], base1 = nOf(H.novos, diaAntes(dia, 1)), base7 = nOf(H.novos, diaAntes(dia, 7));
    return { dia, jogadores, aberturas: nOf(H['sess:aberturas'], dia), novos: nOf(H.novos, dia), ret1: nOf(H.ret1, dia), ret7: nOf(H.ret7, dia),
      minutos: jogadores ? Math.round(nOf(H.tempo, dia) / jogadores / 6) / 10 : null,
      d1: base1 ? Math.round(nOf(H.ret1, dia) / base1 * 100) : null, d7: base7 ? Math.round(nOf(H.ret7, dia) / base7 * 100) : null };
  }).slice(1);
  const ult7 = porDia.slice(-7);
  const media = fn => { const v = ult7.map(fn).filter(x => x !== null); return v.length ? Math.round(v.reduce((a, c) => a + c, 0) / v.length) : null; };
  const cel = nOf(H.disp, 'cel'), pc = nOf(H.disp, 'pc');
  const resumo = {
    minutos: (() => { const j = ult7.reduce((a, d) => a + d.jogadores, 0), t = ult7.reduce((a, d) => a + nOf(H.tempo, d.dia), 0); return j ? Math.round(t / j / 6) / 10 : null; })(),
    d1: media(d => d.d1), d7: media(d => d.d7), celular: cel + pc ? Math.round(cel / (cel + pc) * 100) : null,
    cargaCel: nOf(H.carga, 'cel:n') ? Math.round(nOf(H.carga, 'cel:soma') / nOf(H.carga, 'cel:n') / 100) / 10 : null,
    cargaPc: nOf(H.carga, 'pc:n') ? Math.round(nOf(H.carga, 'pc:soma') / nOf(H.carga, 'pc:n') / 100) / 10 : null,
  };
  const compras = Object.keys(H.compras).map(k => ({ k, vezes: nOf(H.compras, k), noiteMedia: nOf(H.compras, k) ? Math.round(nOf(H['compras:noite'], k) / nOf(H.compras, k) * 10) / 10 : null })).sort((x, y) => y.vezes - x.vezes);
  return res.status(200).json({ configurado, origem, volta, total: b.total, resumo, porDia, noites, eventos: H.eventos, erros: b.erros, errosCont: H['erros:cont'], compras });
}
