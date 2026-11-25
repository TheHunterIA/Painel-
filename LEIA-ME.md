# Painel do Save the Holidays

Recebe eventos anônimos do jogo (noites iniciadas, vencidas e perdidas, tempo, erros) e mostra um painel com o funil por noite.
Nada pessoal é enviado: só um código de sessão aleatório, que muda a cada vez que o jogo abre.

## O que tem aqui

| Arquivo | Para quê |
|---|---|
| `api/evento.js` | Recebe os eventos do jogo (`POST /api/evento`) e soma os contadores |
| `api/resumo.js` | Entrega os números ao painel (`GET /api/resumo`), só com a senha |
| `public/index.html` | O painel (abre na raiz do site) |
| `lib/banco.js` | Conexão com o banco (Upstash Redis) |

## Publicar no Vercel (uma vez)

1. **Coloque estes arquivos num repositório novo no GitHub** (por exemplo `save-the-holidays-painel`): descompacte o zip e envie a pasta inteira.
   Alternativa sem GitHub: instale o Vercel CLI (`npm i -g vercel`), entre na pasta e rode `vercel`.
2. **No Vercel:** *Add New → Project*, escolha o repositório e clique em *Deploy*. Não precisa mudar nenhuma configuração.
3. **Banco de dados (grátis):** no projeto, aba *Storage* → *Create Database* (ou *Marketplace*) → **Upstash** → *Redis* → plano gratuito → *Connect* ao projeto.
   Isso cria sozinho as variáveis `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` (ou `KV_REST_API_URL` e `KV_REST_API_TOKEN`; as duas formas funcionam).
4. **Senha do painel:** *Settings → Environment Variables* → adicione `PAINEL_SENHA` com uma senha sua.
5. **Publique de novo** (*Deployments* → *Redeploy*) para as variáveis valerem.
6. Abra o endereço do projeto (ex.: `https://save-the-holidays-painel.vercel.app`), digite a senha e o painel aparece (vazio até chegarem dados).

Sem o banco conectado o painel mostra um aviso vermelho: os números ficam só na memória e somem.

## Ligar o jogo ao painel

No jogo, em `telemetria.js`, preencha o endereço do painel com `/api/evento` no fim:

```js
const ENDPOINT = window.__TELEMETRIA_URL || 'https://save-the-holidays-painel.vercel.app/api/evento';
```

Depois de publicar o jogo, abra-o, jogue uma noite e atualize o painel: os números devem aparecer em segundos.

## Como ler o funil

- **Jogadores:** quantas sessões começaram aquela noite (cada sessão conta uma vez, mesmo tentando várias vezes).
- **Seguiram:** dos que venceram a noite, quantos começaram a seguinte. Abaixo de 60% fica vermelho: é ali que as pessoas param.
- **% vitória:** das partidas terminadas naquela noite, quantas foram vencidas (muito baixo = noite difícil demais).
- **Tempo e vida ao vencer:** médias das vitórias.

A Noite do dia não entra no funil; aparece em *Outros eventos* (`noite_dia_inicio`, `noite_dia_vitoria`, `noite_dia_derrota`).

## Origem: CrazyGames ou fora

No topo do painel, **Origem** escolhe entre *Todos*, *CrazyGames* (o jogo aberto dentro do site da CrazyGames) e *Fora da CrazyGames* (endereço direto, link compartilhado, outro site).
O jogo descobre sozinho de onde está sendo jogado. O que chegou antes dessa separação aparece como *fora*.

## Os outros números

- **Tempo médio por jogador:** minutos de jogo por jogador, contando só o tempo com o jogo visível (últimos 7 dias no cartão; por dia na tabela).
- **D1 e D7:** dos jogadores novos de um dia, quantos voltaram 1 dia (D1) ou 7 dias (D7) depois. Cada pessoa conta uma vez por dia, mesmo abrindo o jogo várias vezes.
- **Jogando no celular:** parte das aberturas em celular ou tablet (tela de toque).
- **Carregamento médio:** tempo da abertura da página até o jogo ficar pronto, separado em celular e computador.
- **Abandonos:** saíram no meio da noite (voltaram ao menu ou fecharam o jogo) e, entre parênteses, em média aos quantos segundos.
- **Desafios:** dos desafios possíveis nas vitórias (2 por noite), quantos foram cumpridos.
- **Compras na Oficina:** quantas vezes cada melhoria foi comprada e em que noite da campanha, em média.

Como o jogo não guarda nenhuma identificação, "jogador" no painel é uma sessão (cada abertura do jogo).

## Limites

- O plano grátis do Upstash comporta dezenas de milhares de eventos por dia; cada noite jogada gera 2 eventos.
- O endereço de envio é público (qualquer um pode mandar eventos). Os dados são validados e só somam contadores, mas números muito estranhos podem ser alguém enviando lixo.
- Confira se a CrazyGames permite que o jogo envie dados para um servidor próprio antes de ligar em produção.


## Filtro por período e métricas diárias

O painel agora permite escolher data inicial e final, com atalhos de 7, 14 e 30 dias. O intervalo máximo consultável é de 90 dias. Os filtros de origem (CrazyGames/externa) e volta da campanha continuam funcionando junto com as datas. Todas as datas usam UTC.

A partir desta versão, o endpoint grava agregações diárias para sessões, eventos, dispositivos, carregamento, tempo de jogo, compras, erros e estatísticas de cada noite. O resumo consulta apenas o intervalo escolhido (mais os sete dias anteriores, usados como base de cálculo de retenção D1/D7).

**Importante sobre o histórico:** os contadores antigos continuam no Redis, mas não guardavam uma dimensão diária para todas as métricas. Não é possível reconstruir em quais dias ocorreram compras, erros, partidas e carregamentos antigos. Por isso, as métricas detalhadas filtradas por data começam a ser preenchidas após a implantação desta versão. Os dados antigos não são apagados, mas não entram retroativamente nos novos recortes diários.

O total apresentado é a soma de sessões/jogadores-dia únicos em cada dia do intervalo, não uma contagem de pessoas únicas ao longo de todo o período. O jogo gera um identificador de sessão diferente a cada abertura.

Para publicar, substitua os arquivos do projeto pelos desta versão e faça um novo deploy no Vercel. Não é necessário apagar nem recriar o Redis.
