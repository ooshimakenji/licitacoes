// De onde a tela lê os dados.
//
// Em produção eles NÃO estão no build: vivem no branch órfão `dados` do repo,
// servido pelo raw do GitHub (que manda `access-control-allow-origin: *`).
// Assim atualizar a coleta não redeploya o site, e o histórico do repositório
// não engorda dezenas de MB por dia.
const RAW = 'https://raw.githubusercontent.com/ooshimakenji/licitacoes/dados';

// Em dev tenta o diretório local primeiro (permite mexer nos dados à mão) e
// cai para o raw quando não há coleta local — senão `npm run dev` num clone
// novo abriria a tela vazia.
async function json(arquivo) {
  if (import.meta.env.DEV) {
    try {
      const local = await fetch(`data/${arquivo}`);
      if (local.ok) return local.json();
    } catch {
      /* sem coleta local: segue para o raw */
    }
  }
  const r = await fetch(`${RAW}/${arquivo}`);
  if (!r.ok) throw new Error(`${arquivo}: ${r.status}`);
  return r.json();
}

export const carregarIndex = () => json('index.json');

/// Baixa só as UFs pedidas. Uma UF que ainda não existe no branch (nenhum
/// edital hoje) não pode derrubar as outras, então falha vira lista vazia.
export async function carregarUfs(ufs) {
  const partes = await Promise.all(
    ufs.map((uf) =>
      json(`${uf}.json`)
        .then((d) => d.licitacoes || [])
        .catch(() => []),
    ),
  );
  return partes.flat();
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
      json(`itens/${uf}.json`).catch(() => ({})),
    );
  }
  return cacheItens.get(uf);
}
