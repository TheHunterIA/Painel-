// Resumo para o painel (protegido pela senha da variável PAINEL_SENHA, enviada no cabeçalho x-senha).
import { banco, configurado } from '../lib/banco.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const senha = process.env.PAINEL_SENHA;
  if (!senha) return res.status(500).json({ erro: 'Defina a variável PAINEL_SENHA no Vercel.' });
  if (req.headers['x-senha'] !== senha) return res.status(401).json({ erro: 'Senha incorreta.' });

  const volta = Math.max(1, Math.min(99, parseInt(req.query.volta, 10) || 1));
  const dias = [];
  for (let i = 13; i >= 0; i--) dias.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));

  const p = banco.pipeline();
  for (let n = 1; n <= 24; n++) { const k = volta + ':' + n; p.hgetall('noite:' + k); p.pfcount('jog:' + k); p.pfcount('venc:' + k); }
  for (const d of dias) p.pfcount('sess:dia:' + d);
  p.pfcount('sess:total'); p.hgetall('sess:aberturas'); p.hgetall('eventos'); p.lrange('erros', 0, 49); p.hgetall('erros:cont');
  const r = await p.exec();

  let i = 0; const noites = [];
  for (let n = 1; n <= 24; n++) {
    const h = r[i++] || {}, jogadores = r[i++] || 0, vencedores = r[i++] || 0, num = k => +(h[k] || 0);
    noites.push({ n, jogadores, vencedores, ini: num('ini'), vit: num('vit'), der: num('der'),
      tempoVit: num('vit') ? Math.round(num('tempoVit') / num('vit')) : null, tempoDer: num('der') ? Math.round(num('tempoDer') / num('der')) : null,
      vida: num('vit') ? Math.round(num('vida') / num('vit')) : null });
  }
  const porDia = dias.map(d => ({ dia: d, jogadores: r[i++] || 0 }));
  const total = r[i++] || 0, aberturas = r[i++] || {}, eventos = r[i++] || {};
  const erros = (r[i++] || []).map(e => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch (x) { return { m: String(e) }; } });
  const errosCont = r[i++] || {};
  for (const d of porDia) d.aberturas = +(aberturas[d.dia] || 0);
  return res.status(200).json({ configurado, volta, total, porDia, noites, eventos, erros, errosCont });
}
