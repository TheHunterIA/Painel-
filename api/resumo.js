// Resumo para o painel (protegido pela senha da variável PAINEL_SENHA, enviada no cabeçalho x-senha).
// ?origem=cg (CrazyGames), fora (fora dela) ou todos (soma das duas). ?volta=N escolhe a volta do funil.
// ?de=AAAA-MM-DD&ate=AAAA-MM-DD filtra por dia (UTC); sem eles, mostra o total geral desde o começo.
import { banco, configurado } from '../lib/banco.js';

const PREFIXOS = { cg: ['cg:'], fora: [''], todos: ['cg:', ''] };
const HASHES = ['sess:aberturas', 'eventos', 'erros:cont', 'novos', 'ret1', 'ret7', 'tempo', 'disp', 'carga', 'compras', 'compras:noite'];
// no filtro por dia, estes vêm dos contadores diários (dm:AAAA-MM-DD, campos com prefixo)
const DO_DIA = { eventos: 'ev:', 'erros:cont': 'er:', disp: 'dp:', carga: 'ca:', compras: 'cp:', 'compras:noite': 'cpn:' };
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const valido = s => typeof s === 'string' && DIA.test(s) && !isNaN(Date.parse(s));
const iso = t => new Date(t).toISOString().slice(0, 10);
const somaDias = (d, k) => iso(Date.parse(d) + k * 864e5);
const lista = (de, ate) => { const o = []; for (let d = de; d <= ate; d = somaDias(d, 1)) o.push(d); return o; };
const nOf = (o, k) => +(o[k] || 0);

// lê os dados brutos de uma origem (prefixo das chaves). sel = dias do filtro (ou null = total geral); graf = dias do gráfico
async function coletar(pre, volta, sel, graf) {
  const p = banco.pipeline();
  if (sel) {
    for (const d of sel) p.hgetall(pre + 'dn:' + d + ':' + volta);
    for (let n = 1; n <= 24; n++) { const k = volta + ':' + n; p.pfcount(...sel.map(d => pre + 'djog:' + d + ':' + k)); p.pfcount(...sel.map(d => pre + 'dvenc:' + d + ':' + k)); }
    for (const d of sel) p.hgetall(pre + 'dm:' + d);
    p.pfcount(...sel.map(d => pre + 'sess:dia:' + d));
  } else {
    for (let n = 1; n <= 24; n++) { const k = volta + ':' + n; p.hgetall(pre + 'noite:' + k); p.pfcount(pre + 'jog:' + k); p.pfcount(pre + 'venc:' + k); }
    p.pfcount(pre + 'sess:total');
  }
  for (const d of graf) p.pfcount(pre + 'sess:dia:' + d);
  p.lrange(pre + 'erros', 0, 199); p.hgetall(pre + 'd:dias');
  for (const h of HASHES) p.hgetall(pre + h);
  const r = await p.exec(); let i = 0;
  const bruto = { noites: [], dias: [], hashes: {} };
  const diario = {};                                     // somas dos contadores diários (filtro)
  if (sel) {
    const hs = sel.map(() => r[i++] || {});
    const ns = Array.from({ length: 24 }, () => ({}));
    for (const h of hs) for (const f in h) { const [n, campo] = f.split(':'); if (ns[n - 1]) ns[n - 1][campo] = (ns[n - 1][campo] || 0) + +h[f]; }
    for (let n = 0; n < 24; n++) bruto.noites.push({ h: ns[n], jog: r[i++] || 0, venc: r[i++] || 0 });
    for (const _ of sel) { const h = r[i++] || {}; for (const f in h) diario[f] = (diario[f] || 0) + +h[f]; }
    bruto.total = r[i++] || 0;
  } else {
    for (let n = 1; n <= 24; n++) bruto.noites.push({ h: r[i++] || {}, jog: r[i++] || 0, venc: r[i++] || 0 });
    bruto.total = r[i++] || 0;
  }
  for (let j = 0; j < graf.length; j++) bruto.dias.push(r[i++] || 0);
  bruto.erros = (r[i++] || []).map(e => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch (x) { return { m: String(e) }; } });
  bruto.primeiro = Object.keys(r[i++] || {}).sort()[0] || null;   // 1º dia com detalhe por dia
  for (const h of HASHES) bruto.hashes[h] = r[i++] || {};
  if (sel) for (const h in DO_DIA) {
    const pf = DO_DIA[h], o = {};
    for (const f in diario) if (f.startsWith(pf)) o[f.slice(pf.length)] = diario[f];
    bruto.hashes[h] = o;
  }
  return bruto;
}
// soma duas origens (uma sessão só existe numa delas, então somar as contagens não duplica ninguém)
const somarHash = (a, b) => { const o = { ...a }; for (const k in b) o[k] = +(o[k] || 0) + +(b[k] || 0); return o; };
function somar(a, b) {
  return {
    noites: a.noites.map((x, i) => ({ h: somarHash(x.h, b.noites[i].h), jog: x.jog + b.noites[i].jog, venc: x.venc + b.noites[i].venc })),
    dias: a.dias.map((x, i) => x + b.dias[i]), total: a.total + b.total,
    erros: a.erros.concat(b.erros).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 200),
    primeiro: [a.primeiro, b.primeiro].filter(Boolean).sort()[0] || null,
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
  const hoje = iso(Date.now());
  // período: com ?de/?ate filtra por dia (no máximo 92 dias); sem eles, total geral
  let de = valido(req.query.de) ? req.query.de : null, ate = valido(req.query.ate) ? req.query.ate : null;
  const filtrado = !!(de || ate);
  if (filtrado) {
    if (!ate) ate = hoje; if (!de) de = ate;
    if (ate > hoje) ate = hoje; if (de > ate) de = ate;
    if (Date.parse(ate) - Date.parse(de) > 91 * 864e5) de = somaDias(ate, -91);
  }
  const sel = filtrado ? lista(de, ate) : null;
  const graf = filtrado ? sel : lista(somaDias(hoje, -29), hoje);   // total geral: gráfico dos últimos 30 dias

  const partes = await Promise.all(PREFIXOS[origem].map(pre => coletar(pre, volta, sel, graf)));
  const b = partes.reduce(somar);
  const H = b.hashes;

  const noites = b.noites.map((x, i) => {
    const num = k => nOf(x.h, k);
    return { n: i + 1, jogadores: x.jog, vencedores: x.venc, ini: num('ini'), vit: num('vit'), der: num('der'), aband: num('aband'),
      tempoAband: num('aband') ? Math.round(num('tempoAband') / num('aband')) : null, desafios: num('vit') ? Math.round(num('des') / (num('vit') * 2) * 100) : null,
      tempoVit: num('vit') ? Math.round(num('tempoVit') / num('vit')) : null, tempoDer: num('der') ? Math.round(num('tempoDer') / num('der')) : null,
      vida: num('vit') ? Math.round(num('vida') / num('vit')) : null };
  });
  const porDia = graf.map((dia, j) => {
    const jogadores = b.dias[j], base1 = nOf(H.novos, somaDias(dia, -1)), base7 = nOf(H.novos, somaDias(dia, -7));
    return { dia, jogadores, aberturas: nOf(H['sess:aberturas'], dia), novos: nOf(H.novos, dia), ret1: nOf(H.ret1, dia), ret7: nOf(H.ret7, dia),
      minutos: jogadores ? Math.round(nOf(H.tempo, dia) / jogadores / 6) / 10 : null,
      d1: base1 ? Math.round(nOf(H.ret1, dia) / base1 * 100) : null, d7: base7 ? Math.round(nOf(H.ret7, dia) / base7 * 100) : null };
  });
  // cartões do topo: valem para o período mostrado (no total geral, os últimos 30 dias)
  const soma = fn => graf.reduce((a, d) => a + fn(d), 0);
  const jogs = b.dias.reduce((a, c) => a + c, 0), seg = soma(d => nOf(H.tempo, d));
  const r1 = soma(d => nOf(H.ret1, d)), b1 = soma(d => nOf(H.novos, somaDias(d, -1)));
  const r7 = soma(d => nOf(H.ret7, d)), b7 = soma(d => nOf(H.novos, somaDias(d, -7)));
  const cel = nOf(H.disp, 'cel'), pc = nOf(H.disp, 'pc');
  const resumo = {
    minutos: jogs ? Math.round(seg / jogs / 6) / 10 : null,
    d1: b1 ? Math.round(r1 / b1 * 100) : null, d7: b7 ? Math.round(r7 / b7 * 100) : null, celular: cel + pc ? Math.round(cel / (cel + pc) * 100) : null,
    cargaCel: nOf(H.carga, 'cel:n') ? Math.round(nOf(H.carga, 'cel:soma') / nOf(H.carga, 'cel:n') / 100) / 10 : null,
    cargaPc: nOf(H.carga, 'pc:n') ? Math.round(nOf(H.carga, 'pc:soma') / nOf(H.carga, 'pc:n') / 100) / 10 : null,
  };
  const compras = Object.keys(H.compras).map(k => ({ k, vezes: nOf(H.compras, k), noiteMedia: nOf(H.compras, k) ? Math.round(nOf(H['compras:noite'], k) / nOf(H.compras, k) * 10) / 10 : null })).sort((x, y) => y.vezes - x.vezes);
  let erros = b.erros;
  if (filtrado) { const t0 = Date.parse(de), t1 = Date.parse(ate) + 864e5; erros = erros.filter(e => e.t >= t0 && e.t < t1); }
  return res.status(200).json({ configurado, origem, volta, periodo: { filtrado, de, ate, hoje, primeiroDetalhe: b.primeiro },
    total: b.total, resumo, porDia, noites, eventos: H.eventos, erros: erros.slice(0, 50), errosCont: H['erros:cont'], compras });
}
