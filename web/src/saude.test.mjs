// node --test src/saude.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { dadosVelhos, diasDesde } from './saude.js';

const AGORA = new Date('2026-09-14T00:00:00Z').getTime();

test('coleta de hoje não alerta', () => {
  assert.equal(dadosVelhos({ ultima_coleta: '2026-09-14T09:00:00Z' }, AGORA), null);
});

test('coleta de ontem não alerta', () => {
  assert.equal(dadosVelhos({ ultima_coleta: '2026-09-13T09:00:00Z' }, AGORA), null);
});

test('coleta de 3 dias atrás alerta com a contagem certa', () => {
  assert.equal(dadosVelhos({ ultima_coleta: '2026-09-11T00:00:00Z' }, AGORA), 3);
});

test('index antigo, sem ultima_coleta, cai no gerado_em', () => {
  // Os arquivos publicados antes das datas por etapa não têm o campo novo.
  assert.equal(dadosVelhos({ gerado_em: '2026-09-08T09:00:00Z' }, AGORA), 5);
});

test('ultima_coleta vence gerado_em', () => {
  // O gerado_em avança a cada execução (inclusive enriquecimento); só a data
  // da coleta diz se a COLETA parou.
  const idx = { ultima_coleta: '2026-09-08T09:00:00Z', gerado_em: '2026-09-14T00:00:00Z' };
  assert.equal(dadosVelhos(idx, AGORA), 5, 'um enriquecimento recente mascararia a coleta parada');
});

test('sem data nenhuma não inventa alerta', () => {
  assert.equal(dadosVelhos({}, AGORA), null);
  assert.equal(dadosVelhos(null, AGORA), null);
  assert.equal(diasDesde('data inválida', AGORA), null);
});
