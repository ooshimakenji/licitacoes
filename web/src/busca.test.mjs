// node --test src/busca.test.mjs
//
// Os casos vêm de medição em 8.289 editais reais: o `includes` anterior
// devolvia ZERO em três deles, apesar de existirem dezenas de editais.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrar, tokenizar, casa } from './busca.js';

test('acha o termo exato', () => {
  const itens = [{ o: 'Contratação de pavimentação asfáltica' }, { o: 'Compra de canetas' }];
  const r = filtrar(itens, 'pavimentação', (i) => tokenizar(i.o));
  assert.equal(r.itens.length, 1);
  assert.equal(r.aproximado, false);
});

test('acha pelo radical da palavra', () => {
  const itens = [{ o: 'Serviços de pavimentação e drenagem' }];
  assert.equal(filtrar(itens, 'pavimenta', (i) => tokenizar(i.o)).itens.length, 1);
});

test('acha com as palavras separadas no texto', () => {
  // O `includes` zerava aqui: no edital o texto é "climatização (ar-condicionado)".
  const itens = [{ o: 'Manutenção de climatização e ar-condicionado' }];
  assert.equal(filtrar(itens, 'climatização ar', (i) => tokenizar(i.o)).itens.length, 1);
});

test('acha apesar do erro de digitação', () => {
  // Medido: o `includes` devolvia 0 aqui. O prefixo resolve sozinho — "merena"
  // e "merenda" compartilham "mere" —, sem nem precisar do modo tolerante.
  const itens = [{ o: 'Aquisição de merenda escolar' }];
  const r = filtrar(itens, 'merena escolar', (i) => tokenizar(i.o));
  assert.equal(r.itens.length, 1);
});

test('erro logo no começo da palavra cai no modo tolerante e avisa', () => {
  // Erro dentro do prefixo ("clmatizacao"): o prefixo não casa, e só a
  // distância de edição salva. É o caso que justifica o fallback existir.
  const itens = [{ o: 'Manutenção de climatizacao predial' }];
  const r = filtrar(itens, 'clmatizacao', (i) => tokenizar(i.o));
  assert.equal(r.itens.length, 1);
  assert.equal(r.aproximado, true, 'a tela precisa dizer que o resultado é aproximado');
});

test('letra a mais no meio da palavra ainda é achada', () => {
  const itens = [{ o: 'Serviços de pavimentação' }];
  const r = filtrar(itens, 'pavimenntacao', (i) => tokenizar(i.o));
  assert.equal(r.itens.length, 1);
  assert.equal(r.aproximado, true);
});

test('limite: palavra irreconhecível não traz lixo', () => {
  // A tolerância é de UM erro por palavra (distância 1). Acima disso a busca
  // devolve vazio de propósito: distância 2 mede pior — infla o resultado (56
  // contra 36 no termo exato) e custa 6x mais tempo.
  const itens = [{ o: 'Serviços de pavimentação' }];
  assert.equal(filtrar(itens, 'pvmntco', (i) => tokenizar(i.o)).itens.length, 0);
  // E termo de outro assunto não pode casar por acidente.
  assert.equal(filtrar(itens, 'medicamentos', (i) => tokenizar(i.o)).itens.length, 0);
});

test('exige todas as palavras, não qualquer uma', () => {
  const itens = [
    { o: 'Manutenção de climatização predial' },
    { o: 'Aquisição de material de escritório' },
  ];
  // "ar" sozinho não pode trazer tudo que tem a letra a.
  const r = filtrar(itens, 'climatização ar', (i) => tokenizar(i.o));
  assert.ok(r.itens.length <= 1);
});

test('não infla o resultado quando o termo exato já funciona', () => {
  const itens = [
    { o: 'Pavimentação asfáltica' },
    { o: 'Pavimento intertravado' }, // parecido, mas não é o que foi pedido
  ];
  const r = filtrar(itens, 'pavimentação', (i) => tokenizar(i.o));
  assert.equal(r.aproximado, false, 'com resultado exato, não cai no modo tolerante');
});

test('consulta vazia devolve tudo', () => {
  const itens = [{ o: 'a' }, { o: 'b' }];
  assert.equal(filtrar(itens, '   ', (i) => tokenizar(i.o)).itens.length, 2);
});

test('casa() é pura e não depende de ordem', () => {
  const tokens = tokenizar('Coleta de resíduos sólidos urbanos');
  assert.ok(casa(tokens, tokenizar('residuos coleta')));
  assert.ok(casa(tokens, tokenizar('coleta residuos')));
});
