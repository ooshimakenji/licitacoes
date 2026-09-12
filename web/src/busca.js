// Busca que perdoa o jeito como as pessoas realmente digitam.
//
// O `includes` que usávamos exige o termo exato e **zera** em três casos
// comuns, medidos em 8.289 editais: "climatização ar" (palavras separadas no
// objeto), "merena escolar" (erro de digitação) e "coleta residuos" (idem, sem
// acento) devolviam 0 resultados apesar de existirem dezenas de editais.

export const normalizar = (s) =>
  (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const tokenizar = (s) => normalizar(s).match(/[a-z0-9]{2,}/g) || [];

/// Prefixo de no mínimo 4 letras: "pavimenta" acha "pavimentação" sem que "ar"
/// ache tudo que tem a letra a.
const PREFIXO_MIN = 4;

function casaPorPrefixo(tokens, alvo) {
  const prefixo = alvo.slice(0, Math.max(PREFIXO_MIN, alvo.length - 2));
  return tokens.some((t) => t.startsWith(prefixo));
}

/// Distância de edição com corte: só interessa saber se é ≤ limite.
function perto(a, b, limite = 1) {
  if (Math.abs(a.length - b.length) > limite) return false;
  if (a === b) return true;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(
        anterior[j] + 1,
        atual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      menor = Math.min(menor, atual[j]);
    }
    if (menor > limite) return false;
    anterior = atual;
  }
  return anterior[b.length] <= limite;
}

/// Todas as palavras da consulta precisam casar (E, não OU) — senão
/// "climatização ar" viraria tudo que tem "ar".
export function casa(tokensDoTexto, alvos, comEdicao = false) {
  return alvos.every(
    (a) =>
      casaPorPrefixo(tokensDoTexto, a) ||
      (comEdicao && tokensDoTexto.some((t) => perto(t, a))),
  );
}

/// Filtra uma lista já tokenizada. Tenta primeiro só por prefixo; se **nada**
/// for encontrado, repete aceitando um erro de digitação. Medido: a edição
/// isolada custa 6× mais tempo e infla o resultado (56 contra 36 no termo
/// exato), então ela é rede de segurança, não o caminho normal.
export function filtrar(itens, consulta, tokensDe) {
  const alvos = tokenizar(consulta);
  if (!alvos.length) return { itens, aproximado: false };

  const exatos = itens.filter((i) => casa(tokensDe(i), alvos));
  if (exatos.length) return { itens: exatos, aproximado: false };

  const aproximados = itens.filter((i) => casa(tokensDe(i), alvos, true));
  return { itens: aproximados, aproximado: aproximados.length > 0 };
}

/// Índice invertido: prefixo de 4 letras → ids que o contêm.
///
/// Sem ele, cada tecla varria os 13.928 editais token a token — medi **566 ms
/// no pior frame**, com 15 frames acima de 100 ms, o que faz a digitação
/// engasgar visivelmente. Com o índice, a busca vira interseção de conjuntos.
export function indexar(itens, idDe, textoDe) {
  const indice = new Map();
  for (const item of itens) {
    const id = idDe(item);
    for (const token of tokenizar(textoDe(item))) {
      // Todo prefixo de 4+ letras do token aponta para este id, então
      // "pavimenta" e "pavimentacao" caem no mesmo balde inicial.
      for (let n = PREFIXO_MIN; n <= token.length; n++) {
        const chave = token.slice(0, n);
        let baldes = indice.get(chave);
        if (!baldes) indice.set(chave, (baldes = new Set()));
        baldes.add(id);
      }
    }
  }
  return indice;
}

/// Ids que casam com a consulta, usando o índice. `null` = sem consulta.
export function idsQueCasam(indice, consulta) {
  const alvos = tokenizar(consulta);
  if (!alvos.length) return null;

  let resultado = null;
  for (const alvo of alvos) {
    const chave = alvo.slice(0, Math.max(PREFIXO_MIN, Math.min(alvo.length, alvo.length - 2)));
    const encontrados = indice.get(chave) || new Set();
    // E, não OU: "climatização ar" não pode virar tudo que tem "ar".
    resultado =
      resultado === null
        ? new Set(encontrados)
        : new Set([...resultado].filter((id) => encontrados.has(id)));
    if (!resultado.size) break;
  }
  return resultado;
}
