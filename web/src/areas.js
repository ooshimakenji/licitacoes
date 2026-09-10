// Presets de área. O vocabulário de cada uma foi medido contra os 3.374 objetos
// realmente coletados em 09/09/2026 — os números são quantos editais cada uma
// pegava naquela base, para não inventar categoria que não existe na prática.
export const AREAS = {
  'Engenharia e obras': // 299 editais
    'obra,reforma,construcao,pavimenta,drenagem,terraplan,engenharia,projeto executivo,edifica,calcada,ponte,galeria,infraestrutura,recapea',
  'Limpeza e conservação': // 287
    'limpeza,conserva,higieniza,mao de obra,terceiriza,copeiragem,portaria,vigilancia',
  Saúde: // 227
    'medicamento,hospitalar,exame,orteses,protese,odontolog,ambulancia,insumo',
  'TI e software': // 200
    'software,licenca de uso,computador,notebook,servidor,link de internet,sistema de gestao,informatica,nobreak,impressora',
  'Manutenção predial': // 192
    'climatiza,ar-condicionado,ar condicionado,eletrica,hidraulic,elevador,manutencao predial,predial,alvenaria,pintura',
  'Frota e transporte': // 155
    'veiculo,combustivel,pneu,transporte escolar,manutencao de frota,oleo lubrificante',
  Alimentação: // 127
    'alimentac,generos alimenticios,merenda,hortifruti,carne',
  'Ambiental e saneamento': // 80
    'ambiental,residuo,licenciamento,saneamento,esgoto,efluente,arboriza,poda,varricao',
};

// Regiões do IBGE. Usado para filtrar sem depender de coordenada nenhuma.
const REGIOES = {
  Norte: 'AC,AP,AM,PA,RO,RR,TO',
  Nordeste: 'AL,BA,CE,MA,PB,PE,PI,RN,SE',
  'Centro-Oeste': 'DF,GO,MT,MS',
  Sudeste: 'ES,MG,RJ,SP',
  Sul: 'PR,RS,SC',
};

export const NOMES_REGIOES = Object.keys(REGIOES);

export const UF_PARA_REGIAO = Object.fromEntries(
  Object.entries(REGIOES).flatMap(([regiao, ufs]) =>
    ufs.split(',').map((uf) => [uf, regiao]),
  ),
);
