
// Resumo do painel. Todas as métricas filtráveis usam agregações diárias.
import { banco, configurado } from '../lib/banco.js';

const PREFIXOS_ORIGEM = { cg: ['cg:'], fora: [''] };

const PREFIXOS = {
  prod: {
    cg: ['cg:'],
    fora: [''],
    todos: ['cg:', '']
  },
  preview: {
    cg: ['preview:cg:'],
    fora: ['preview:'],
    todos: ['preview:cg:', 'preview:']
  },
  todos: {
    cg: ['cg:', 'preview:cg:'],
    fora: ['', 'preview:'],
    todos: ['cg:', '', 'preview:cg:', 'preview:']
  }
};

const HASHES_DIA = [
  'eventos:dia:',
  'disp:dia:',
  'carga:dia:',
  'compras:dia:',
  'compras:noite:dia:',
  'tempo:dia:',
  'erros:cont:dia:',
  'novos:dia:',
  'ret1:dia:',
  'ret7:dia:'
];

const iso = d => d.toISOString().slice(0, 10);

const parseDia = v =>
  /^\d{4}-\d{2}-\d{2}$/.test(v || '') &&
  !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
    ? v
    : null;

const n = (o, k) => +(o?.[k] || 0);

const somaHash = (a, b) => {
  const o = { ...a };
  for (const k in b) {
    o[k] = n(o, k) + n(b, k);
  }
  return o;
};

async function coletar(pre, volta, dias, inicioPeriodo) {
  const p = banco.pipeline();

  for (const dia of dias) {
    p.pfcount(pre + `sess:dia:${dia}`);

    for (const prefixo of HASHES_DIA) {
      p.hgetall(pre + prefixo + dia);
    }

    p.lrange(pre + `erros:dia:${dia}`, 0, 199);

    if (dia < inicioPeriodo) continue;

    for (let noite = 1; noite <= 24; noite++) {
      const k = `${dia}:${volta}:${noite}`;
      p.hgetall(pre + `noite:dia:${k}`);
    }
  }

  const diasPeriodo = dias.filter(
    dia => dia >= inicioPeriodo
  );

  for (let noite = 1; noite <= 24; noite++) {
    p.pfcount(
      ...diasPeriodo.map(
        dia => pre + `jog:dia:${dia}:${volta}:${noite}`
      )
    );

    p.pfcount(
      ...diasPeriodo.map(
        dia => pre + `venc:dia:${dia}:${volta}:${noite}`
      )
    );
  }

  // Compatibilidade com o histórico anterior:
  // a versão antiga armazenava o tempo no hash `tempo`,
  // utilizando a data como campo.
  p.hgetall(pre + 'tempo');

  const r = await p.exec();
  let i = 0;

  const out = {
    dias: [],
    noites: Array.from(
      { length: 24 },
      (_, j) => ({
        n: j + 1,
        h: {},
        jogadores: 0,
        vencedores: 0
      })
    ),
    total: 0,
    erros: []
  };

  for (const dia of dias) {
    const diaOut = {
      dia,
      jogadores: r[i++] || 0,
      hashes: {}
    };

    for (const prefixo of HASHES_DIA) {
      diaOut.hashes[prefixo] = r[i++] || {};
    }

    diaOut.erros = (r[i++] || []).map(e => {
      try {
        return typeof e === 'string'
          ? JSON.parse(e)
          : e;
      } catch {
        return { m: String(e) };
      }
    });

    if (dia >= inicioPeriodo) {
      out.total += diaOut.jogadores;
      out.erros.push(...diaOut.erros);
    }

    if (dia >= inicioPeriodo) {
      for (let j = 0; j < 24; j++) {
        out.noites[j].h = somaHash(
          out.noites[j].h,
          r[i++] || {}
        );
      }
    }

    out.dias.push(diaOut);
  }

  for (let j = 0; j < 24; j++) {
    out.noites[j].jogadores = r[i++] || 0;
    out.noites[j].vencedores = r[i++] || 0;
  }

  const tempoLegado = r[i++] || {};

  // Recupera o tempo histórico sem duplicar registros.
  // Se existe agregação diária nova, ela tem prioridade.
  // Caso contrário, utiliza o hash antigo `tempo`.
  for (const diaOut of out.dias) {
    const hashTempoDia = diaOut.hashes['tempo:dia:'];

    if (
      !Object.prototype.hasOwnProperty.call(
        hashTempoDia,
        'seg'
      ) &&
      tempoLegado[diaOut.dia] != null
    ) {
      hashTempoDia.seg =
        Number(tempoLegado[diaOut.dia]) || 0;
    }
  }

  out.erros.sort(
    (a, b) => (b.t || 0) - (a.t || 0)
  );

  out.erros = out.erros.slice(0, 50);

  return out;
}

function somarPartes(a, b) {
  return {
    total: a.total + b.total,

    dias: a.dias.map((d, i) => {
      const x = b.dias[i];

      return {
        ...d,
        jogadores: d.jogadores + x.jogadores,

        hashes: Object.fromEntries(
          HASHES_DIA.map(k => [
            k,
            somaHash(d.hashes[k], x.hashes[k])
          ])
        ),

        erros: d.erros.concat(x.erros)
      };
    }),

    noites: a.noites.map((x, i) => ({
      ...x,
      h: somaHash(x.h, b.noites[i].h),
      jogadores: x.jogadores + b.noites[i].jogadores,
      vencedores: x.vencedores + b.noites[i].vencedores
    })),

    erros: a.erros
      .concat(b.erros)
      .sort((x, y) => (y.t || 0) - (x.t || 0))
      .slice(0, 50)
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const senha = process.env.PAINEL_SENHA;

  if (!senha) {
    return res.status(500).json({
      erro: 'Defina a variável PAINEL_SENHA no Vercel.'
    });
  }

  if (req.headers['x-senha'] !== senha) {
    return res.status(401).json({
      erro: 'Senha incorreta.'
    });
  }

  const volta = Math.max(
    1,
    Math.min(99, parseInt(req.query.volta, 10) || 1)
  );

  const origem = PREFIXOS_ORIGEM[req.query.origem]
    ? req.query.origem
    : 'todos';

  const ambiente = PREFIXOS[req.query.ambiente]
    ? req.query.ambiente
    : 'prod';

  const hoje = iso(new Date());

  const padraoInicio = iso(
    new Date(Date.now() - 13 * 864e5)
  );

  let inicio = parseDia(req.query.de) || padraoInicio;
  let fim = parseDia(req.query.ate) || hoje;

  if (inicio > fim) {
    [inicio, fim] = [fim, inicio];
  }

  if (fim > hoje) fim = hoje;
  if (inicio > hoje) inicio = hoje;

  const diff = Math.floor(
    (
      Date.parse(fim + 'T00:00:00Z') -
      Date.parse(inicio + 'T00:00:00Z')
    ) / 864e5
  );

  if (diff > 89) {
    inicio = iso(
      new Date(
        Date.parse(fim + 'T00:00:00Z') -
        89 * 864e5
      )
    );
  }

  const dias = [];

  const inicioConsulta = iso(
    new Date(
      Date.parse(inicio + 'T00:00:00Z') -
      7 * 864e5
    )
  );

  for (
    let t = Date.parse(inicioConsulta + 'T00:00:00Z');
    t <= Date.parse(fim + 'T00:00:00Z');
    t += 864e5
  ) {
    dias.push(iso(new Date(t)));
  }

  const partes = await Promise.all(
    PREFIXOS[ambiente][origem].map(
      pre => coletar(pre, volta, dias, inicio)
    )
  );

  const b = partes.reduce(somarPartes);

  const getDia = (d, prefixo) =>
    b.dias.find(x => x.dia === d)?.hashes[prefixo] || {};

  const diaAntes = (d, k) =>
    iso(
      new Date(
        Date.parse(d + 'T00:00:00Z') -
        k * 864e5
      )
    );

  const periodo = b.dias.filter(
    d => d.dia >= inicio
  );

  const porDia = periodo.map(d => {
    const H = d.hashes;

    const novos = n(H['novos:dia:'], 'n');
    const ret1 = n(H['ret1:dia:'], 'n');
    const ret7 = n(H['ret7:dia:'], 'n');

    const baseD1 = n(
      getDia(diaAntes(d.dia, 1), 'novos:dia:'),
      'n'
    );

    const baseD7 = n(
      getDia(diaAntes(d.dia, 7), 'novos:dia:'),
      'n'
    );

    const tempo = n(H['tempo:dia:'], 'seg');

    return {
      dia: d.dia,
      jogadores: d.jogadores,
      aberturas: n(H['eventos:dia:'], 'sessao'),
      novos,
      ret1,
      ret7,

      minutos: d.jogadores
        ? Math.round(tempo / d.jogadores / 6) / 10
        : null,

      d1: baseD1
        ? Math.round(ret1 / baseD1 * 100)
        : null,

      d7: baseD7
        ? Math.round(ret7 / baseD7 * 100)
        : null
    };
  });

  const noiteDados = b.noites.map(x => {
    const h = x.h;
    const num = k => n(h, k);

    return {
      n: x.n,
      jogadores: x.jogadores,
      vencedores: x.vencedores,
      ini: num('ini'),
      vit: num('vit'),
      der: num('der'),
      aband: num('aband'),

      tempoAband: num('aband')
        ? Math.round(num('tempoAband') / num('aband'))
        : null,

      desafios: num('vit')
        ? Math.round(
            num('des') / (num('vit') * 2) * 100
          )
        : null,

      tempoVit: num('vit')
        ? Math.round(num('tempoVit') / num('vit'))
        : null,

      tempoDer: num('der')
        ? Math.round(num('tempoDer') / num('der'))
        : null,

      vida: num('vit')
        ? Math.round(num('vida') / num('vit'))
        : null
    };
  });

  const somarCampo = (prefixo, campo) =>
    periodo.reduce(
      (a, d) => a + n(d.hashes[prefixo], campo),
      0
    );

  const cel = somarCampo('disp:dia:', 'cel');
  const pc = somarCampo('disp:dia:', 'pc');

  const cargaCelN = somarCampo('carga:dia:', 'cel:n');
  const cargaPcN = somarCampo('carga:dia:', 'pc:n');

  const tempoTotal = somarCampo('tempo:dia:', 'seg');

  const d1Base = periodo.reduce(
    (a, d) =>
      a + n(
        getDia(diaAntes(d.dia, 1), 'novos:dia:'),
        'n'
      ),
    0
  );

  const d7Base = periodo.reduce(
    (a, d) =>
      a + n(
        getDia(diaAntes(d.dia, 7), 'novos:dia:'),
        'n'
      ),
    0
  );

  const ret1 = porDia.reduce(
    (a, d) => a + d.ret1,
    0
  );

  const ret7 = porDia.reduce(
    (a, d) => a + d.ret7,
    0
  );

  const compras = {};

  for (const d of periodo) {
    for (
      const [k, v] of Object.entries(
        d.hashes['compras:dia:']
      )
    ) {
      compras[k] ||= {
        k,
        vezes: 0,
        somaNoite: 0
      };

      compras[k].vezes += +v;

      compras[k].somaNoite += n(
        d.hashes['compras:noite:dia:'],
        k
      );
    }
  }

  const comprasOut = Object.values(compras)
    .map(x => ({
      k: x.k,
      vezes: x.vezes,

      noiteMedia: x.vezes
        ? Math.round(
            x.somaNoite / x.vezes * 10
          ) / 10
        : null
    }))
    .sort((a, b) => b.vezes - a.vezes);

  const errosCont = {};

  for (const d of periodo) {
    for (
      const [k, v] of Object.entries(
        d.hashes['erros:cont:dia:']
      )
    ) {
      errosCont[k] = (errosCont[k] || 0) + +v;
    }
  }

  const eventos = {};

  for (const d of periodo) {
    for (
      const [k, v] of Object.entries(
        d.hashes['eventos:dia:']
      )
    ) {
      eventos[k] = (eventos[k] || 0) + +v;
    }
  }

  const carga = (dp, count) =>
    count
      ? Math.round(
          somarCampo('carga:dia:', dp + ':soma') /
          count / 100
        ) / 10
      : null;

  const resumo = {
    minutos: b.total
      ? Math.round(tempoTotal / b.total / 6) / 10
      : null,

    d1: d1Base
      ? Math.round(ret1 / d1Base * 100)
      : null,

    d7: d7Base
      ? Math.round(ret7 / d7Base * 100)
      : null,

    celular: cel + pc
      ? Math.round(cel / (cel + pc) * 100)
      : null,

    cargaCel: carga('cel', cargaCelN),
    cargaPc: carga('pc', cargaPcN)
  };

  return res.status(200).json({
    configurado,
    origem,
    ambiente,
    volta,
    inicio,
    fim,
    diasSelecionados: periodo.length,
    limiteDias: 90,
    total: b.total,
    resumo,
    porDia,
    noites: noiteDados,
    eventos,
    erros: b.erros,
    errosCont,
    compras: comprasOut,
    historicoAnterior: true
  });
}
