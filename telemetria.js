/* Telemetria leve e anônima: contadores por noite e por evento, guardados no próprio save da plataforma.
   Sem dados pessoais. Para enviar a um servidor, preencha ENDPOINT (POST JSON via sendBeacon).
   Para ver os números: abra o jogo com ?stats na URL (Ajustes → Estatísticas). */
window.Telemetria = (() => {
  'use strict';
  // endereço do painel (projeto no Vercel): '' = só contadores locais. Ex.: 'https://seu-painel.vercel.app/api/evento'
  // não envia em testes, depuração, modo de gravação, arquivo local, localhost nem na prévia do Claude: o painel fica só com jogadores
  const DEV = window.__TESTE || /[?&](debug|gravar|stats)\b/.test(location.search) || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /claude/.test(location.hostname);
  // Ambiente: defina window.__TELEMETRIA_AMBIENTE = 'preview' no build de Preview
  // para classificar esses eventos sem depender do domínio/iframe da plataforma.
  const params = new URLSearchParams(location.search);
  const previewMarcado = window.__TELEMETRIA_AMBIENTE === 'preview' ||
    ['preview', 'cg_preview', 'isPreview'].some(k => ['1', 'true', 'preview'].includes((params.get(k) || '').toLowerCase())) ||
    (params.get('env') || '').toLowerCase() === 'preview' ||
    /(^|[-.])(preview|staging|sandbox)([-.]|$)/i.test(location.hostname) ||
    String(window.CrazyGames?.SDK?.environment || '').toLowerCase() === 'preview';
  const ambiente = previewMarcado ? 'preview' : 'prod';
  const ENDPOINT = window.__TELEMETRIA_URL || (DEV ? '' : 'https://painel-two-kappa.vercel.app/api/evento');   // painel no Vercel (__TELEMETRIA_URL: só para testes)
  // origem: dentro da CrazyGames (janela embutida no site deles) ou fora (endereço direto, link compartilhado...)
  const origem = (() => {
    try { const anc = location.ancestorOrigins; if (anc && [].some.call(anc, a => /crazygames/i.test(a))) return 'cg'; } catch (e) {}
    let emb = true; try { emb = window.top !== window.self; } catch (e) {}
    return (emb && /crazygames/i.test(document.referrer)) || /crazygames/i.test(location.hostname) ? 'cg' : 'fora';
  })();
  const CHAVE = 'telemetria', sid = Math.random().toString(36).slice(2, 10);
  let d = { v: 1, sessoes: 0, eventos: {}, noites: {}, erros: [] };
  try { const b = Plataforma.armazenamento.get(CHAVE); if (b) { const x = JSON.parse(b); if (x && x.v === 1 && x.noites) d = x; } } catch (e) { /* começa do zero */ }
  d.sessoes++;
  // abertura: novo ou retorno (dias desde a primeira vez, em UTC), celular ou computador
  const hoje = new Date().toISOString().slice(0, 10);
  if (!d.primeira) d.primeira = hoje;
  const dias = Math.max(0, Math.round((Date.parse(hoje) - Date.parse(d.primeira)) / 864e5));
  const disp = (window.matchMedia && matchMedia('(pointer: coarse)').matches) ? 'cel' : 'pc';
  const primeiraDoDia = d.ultimoDia !== hoje; d.ultimoDia = hoje;   // retorno conta uma vez por dia, mesmo abrindo o jogo várias vezes
  setTimeout(() => { enviar('sessao', { novo: d.sessoes === 1, dias, disp, pd: primeiraDoDia }); gravar(); }, 0);
  // tempo de jogo: só o tempo com a aba visível; envia o trecho ao esconder a aba ou fechar a página
  let ativoDesde = document.hidden ? 0 : performance.now();
  const reportarTempo = () => { if (!ativoDesde) return; const seg = Math.round((performance.now() - ativoDesde) / 1000); ativoDesde = 0; if (seg > 0) enviar('tempo', { seg }); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) reportarTempo(); else ativoDesde = performance.now(); });
  window.addEventListener('pagehide', reportarTempo);
  let adiado = 0;
  const gravar = () => { clearTimeout(adiado); adiado = setTimeout(() => { try { Plataforma.armazenamento.set(CHAVE, JSON.stringify(d)); } catch (e) { /* sem espaço */ } }, 1000); };
  const enviar = (e, x) => { if (!ENDPOINT || !navigator.sendBeacon) return; try { navigator.sendBeacon(ENDPOINT, JSON.stringify({ s: sid, e, x, t: Date.now(), o: origem, a: ambiente })); } catch (err) { /* ignora */ } };
  const chaveNoite = (volta, n) => volta + ':' + n;
  function evento(nome, extra) { d.eventos[nome] = (d.eventos[nome] || 0) + 1; gravar(); enviar(nome, extra); }
  function inicio(n, volta) {
    const o = d.noites[chaveNoite(volta, n)] || (d.noites[chaveNoite(volta, n)] = { ini: 0, vit: 0, der: 0, tempo: 0, vida: 0 });
    o.ini++; gravar(); enviar('noite_inicio', { n, volta });
  }
  function fim(r) {                         // r: { n, volta, vitoria, vida (0..1), tempo (s), des (desafios cumpridos) }
    const o = d.noites[chaveNoite(r.volta, r.n)] || (d.noites[chaveNoite(r.volta, r.n)] = { ini: 1, vit: 0, der: 0, tempo: 0, vida: 0 });
    if (r.vitoria) { o.vit++; o.vida += r.vida; } else o.der++;
    o.tempo += r.tempo || 0; gravar(); enviar('noite_fim', r);
  }
  function carregou(ms) { enviar('carregou', { ms: Math.round(ms), disp }); }               // tempo até o menu
  function abandono(n, volta, t) { enviar('noite_abandono', { n, volta, t: Math.round(t) }); }   // saiu no meio da noite
  function compra(k, nv, noite) { enviar('compra', { k, nv, n: noite }); }                    // melhoria comprada na Oficina
  function erro(msg) { d.erros.push({ t: Date.now(), m: String(msg).slice(0, 200) }); if (d.erros.length > 20) d.erros.shift(); gravar(); enviar('erro', { m: String(msg).slice(0, 120) }); }
  return { evento, inicio, fim, erro, carregou, abandono, compra, resumo: () => d, sessao: sid, origem, ambiente };
})();
