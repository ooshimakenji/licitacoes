// node --test src/areas.test.mjs
// Trava o que pode silenciosamente apodrecer: o vocabulário das áreas. Se um
// preset deixar de casar editais reais, o chip vira um botão que não faz nada —
// e isso não aparece em nenhum erro de build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { AREAS, UF_PARA_REGIAO, NOMES_REGIOES } from './areas.js';

const normalizar = (s) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const chaves = (s) => s.split(',').map((k) => normalizar(k.trim())).filter(Boolean);

const CAMINHO = new URL('../public/data/licitacoes.json', import.meta.url);

test('toda área tem vocabulário não vazio', () => {
  for (const [area, palavras] of Object.entries(AREAS)) {
    assert.ok(chaves(palavras).length >= 3, `${area} tem vocabulário curto demais`);
  }
});

test('regiões cobrem as 27 UFs, sem repetir', () => {
  assert.equal(Object.keys(UF_PARA_REGIAO).length, 27);
  assert.equal(NOMES_REGIOES.length, 5);
  assert.equal(UF_PARA_REGIAO.SC, 'Sul');
  assert.equal(UF_PARA_REGIAO.SP, 'Sudeste');
});

test('cada área casa editais na coleta real', (t) => {
  if (!existsSync(CAMINHO)) {
    t.skip('sem licitacoes.json coletado — nada a medir');
    return;
  }
  const { licitacoes } = JSON.parse(readFileSync(CAMINHO, 'utf-8'));
  const objetos = licitacoes.map((l) => normalizar(l.objeto || ''));

  for (const [area, palavras] of Object.entries(AREAS)) {
    const ks = chaves(palavras);
    const n = objetos.filter((o) => ks.some((k) => o.includes(k))).length;
    // Piso baixo de propósito: o teste existe para pegar preset que casa ZERO
    // (vocabulário quebrado), não para congelar os números da coleta de um dia.
    assert.ok(n > 0, `área "${area}" não casou nenhum edital em ${licitacoes.length}`);
    console.log(`  ${area}: ${n} editais`);
  }
});
