// Resumo para o painel (protegido pela senha da variável PAINEL_SENHA, enviada no cabeçalho x-senha).
import { banco, configurado } from '../lib/banco.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const senha = process.env.PAINEL_SENHA;
  if (!senha) return res.status(500).json({ erro: 'Defina a variável PAINEL_SENHA no Vercel.' });
  if (req.headers['x-senha'] !== senha) return res.status(401).json({ erro: 'Senha incorreta.' });

  const volta = Math.max(1, Math.min(99, parseInt(req.query.volta, 10) || 1));
  const dias = [];
  for (let i = 14; i >= 0; i--) dias.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

  const p = banco.pipeline();
  for (let n = 1; n <= 24; n++) { const k = volta + ':' + n; p.hgetall('noite:' + k); p.pfcount('jog:' + k); p.pfcount('venc:' + k); }
  for (const d of dias) p.pfcount('sess:dia:' + d);
  p.pfcount('sess:total'); p.hgetall('sess:aberturas'); p.hgetall('eventos'); p.lrange('erros', 0, 49); p.hgetall('erros:cont');
  p.hgetall('novos'); p.hgetall('ret1'); p.hgetall('ret7'); p.hgetall('tempo'); p.hgetall('disp'); p.hgetall('carga'); p.hgetall('compras'); p.hgetall('compras:noite');
  const r = await p.exec();

  let i = 0; const noites = [];
  for (let n = 1; n <= 24; n++) {
    const h = r[i++] || {}, jogadores = r[i++] || 0, vencedores = r[i++] || 0, num = k => +(h[k] || 0);
    noites.push({ n, jogadores, vencedores, ini: num('ini'), vit: num('vit'), der: num('der'), aband: num('aband'),
      tempoAband: num('aband') ? Math.round(num('tempoAband') / num('aband')) : null, desafios: num('vit') ? Math.round(num('des') / (num('vit') * 2) * 100) : null,
      tempoVit: num('vit') ? Math.round(num('tempoVit') / num('vit')) : null, tempoDer: num('der') ? Math.round(num('tempoDer') / num('der')) : null,
      vida: num('vit') ? Math.round(num('vida') / num('vit')) : null });
  }
  let porDia = dias.map(d => ({ dia: d, jogadores: r[i++] || 0 }));
  const total = r[i++] || 0, aberturas = r[i++] || {}, eventos = r[i++] || {};
  const erros = (r[i++] || []).map(e => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch (x) { return { m: String(e) }; } });
  const errosCont = r[i++] || {};
  const [novos, ret1, ret7, tempo, disp, carga, compras, comprasNoite] = [r[i++], r[i++], r[i++], r[i++], r[i++], r[i++], r[i++], r[i++]].map(o => o || {});
  const nOf = (o, k) => +(o[k] || 0), diaAntes = (d, k) => new Date(Date.parse(d) - k * 864e5).toISOString().slice(0, 10);
  for (const d of porDia) {
    d.aberturas = nOf(aberturas, d.dia); d.novos = nOf(novos, d.dia); d.ret1 = nOf(ret1, d.dia); d.ret7 = nOf(ret7, d.dia);
    d.minutos = d.jogadores ? Math.round(nOf(tempo, d.dia) / d.jogadores / 6) / 10 : null;          // tempo médio por jogador naquele dia
    const base1 = nOf(novos, diaAntes(d.dia, 1)), base7 = nOf(novos, diaAntes(d.dia, 7));
    d.d1 = base1 ? Math.round(d.ret1 / base1 * 100) : null;                                          // dos novos de ontem, quantos voltaram hoje
    d.d7 = base7 ? Math.round(d.ret7 / base7 * 100) : null;
  }
  porDia = porDia.slice(1);                                                                          // o 1º dia era só a base do D1
  const media = (pt, fn) => { const v = pt.map(fn).filter(x => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const ult7 = porDia.slice(-7);
  const resumo = {
    minutos: (() => { const j = ult7.reduce((a, d) => a + d.jogadores, 0), t = ult7.reduce((a, d) => a + nOf(tempo, d.dia), 0); return j ? Math.round(t / j / 6) / 10 : null; })(),
    d1: media(ult7, d => d.d1), d7: media(ult7, d => d.d7),
    celular: nOf(disp, 'cel') + nOf(disp, 'pc') ? Math.round(nOf(disp, 'cel') / (nOf(disp, 'cel') + nOf(disp, 'pc')) * 100) : null,
    cargaCel: nOf(carga, 'cel:n') ? Math.round(nOf(carga, 'cel:soma') / nOf(carga, 'cel:n') / 100) / 10 : null,
    cargaPc: nOf(carga, 'pc:n') ? Math.round(nOf(carga, 'pc:soma') / nOf(carga, 'pc:n') / 100) / 10 : null,
  };
  const listaCompras = Object.keys(compras).map(k => ({ k, vezes: nOf(compras, k), noiteMedia: nOf(compras, k) ? Math.round(nOf(comprasNoite, k) / nOf(compras, k) * 10) / 10 : null })).sort((a, b) => b.vezes - a.vezes);
  return res.status(200).json({ configurado, volta, total, resumo, porDia, noites, eventos, erros, errosCont, compras: listaCompras });
}
