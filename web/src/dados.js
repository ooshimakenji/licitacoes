// De onde a tela lê os dados.
//
// Em produção eles NÃO estão no build: vivem no branch órfão `dados` do repo,
// servido pelo raw do GitHub (que manda `access-control-allow-origin: *`).
// Assim atualizar a coleta não redeploya o site, e o histórico do repositório
// não engorda dezenas de MB por dia.
const RAW = 'https://raw.githubusercontent.com/ooshimakenji/licitacoes/dados';

/// Os arquivos grandes vão comprimidos: medi 93% de redução nestes dados, o que
/// é a diferença entre baixar 5 MB e 350 KB por UF. `DecompressionStream` é
/// nativo do navegador — nada de biblioteca.
async function descomprimir(resposta) {
  const fluxo = resposta.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(fluxo).json();
}

async function buscar(arquivo) {
  const caminhos = import.meta.env.DEV ? [`data/${arquivo}`, `${RAW}/${arquivo}`] : [`${RAW}/${arquivo}`];
  for (const caminho of caminhos) {
    try {
      const r = await fetch(caminho);
      if (!r.ok) continue;
      return caminho.endsWith('.gz') ? descomprimir(r) : r.json();
    } catch {
      /* tenta o próximo caminho */
    }
  }
  throw new Error(`${arquivo}: não encontrado`);
}

export const carregarIndex = () => buscar('index.json');

/// Editais com proposta aberta — o que a tela mostra por padrão. Uma UF sem
/// arquivo (nenhum edital hoje) não pode derrubar as outras.
export async function carregarUfs(ufs) {
  const partes = await Promise.all(
    ufs.map((uf) =>
      buscar(`abertos/${uf}.json.gz`)
        .then((d) => d.licitacoes || [])
        .catch(() => []),
    ),
  );
  return partes.flat();
}

/// Histórico: tudo que foi publicado naquele mês, aberto ou não. É o que enxerga
/// a dispensa de cidade pequena, que abre e fecha entre duas coletas.
export async function carregarHistorico(ufs, meses) {
  const pedidos = [];
  for (const uf of ufs) {
    for (const mes of meses) {
      pedidos.push(
        buscar(`${mes}/${uf}.json.gz`)
          .then((d) => d.licitacoes || [])
          .catch(() => []),
      );
    }
  }
  return (await Promise.all(pedidos)).flat();
}

// Os itens vivem em arquivo separado — só de SP eles respondiam por metade dos
// 8,3 MB, e só fazem falta quando você expande uma linha. Uma UF é baixada uma
// vez por sessão; o cache guarda a promessa, então dois cliques rápidos na mesma
// UF não viram dois downloads.
const cacheItens = new Map();

export function carregarItens(uf) {
  if (!cacheItens.has(uf)) {
    cacheItens.set(
      uf,
      buscar(`itens/${uf}.json.gz`).catch(() => ({})),
    );
  }
  return cacheItens.get(uf);
}
