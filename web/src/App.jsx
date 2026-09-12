import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Container,
  Typography,
  CircularProgress,
  Alert,
  Box,
  Chip,
  Button,
  Drawer,
  Menu,
  MenuItem,
  Badge,
  Tabs,
  Tab,
  useMediaQuery,
  useTheme,
  Link as MuiLink,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import Filtros from './Filtros.jsx';
import Resultados from './Resultados.jsx';
import Concursos from './Concursos.jsx';
import { ALVO_TOQUE } from './theme.js';
import { AREAS, UF_PARA_REGIAO } from './areas.js';
import { carregarIndex, carregarUf, carregarHistorico } from './dados.js';
import { tokenizar, casa, normalizar, indexar, idsQueCasam } from './busca.js';

const FILTROS_KEY = 'licitacoes:filtros';
const TRIAGEM_KEY = 'licitacoes:triagem';
const BUSCAS_KEY = 'licitacoes:buscas';
const UF_RECENTE_KEY = 'licitacoes:uf-recente';

const FILTROS_PADRAO = {
  areas: [],
  ufs: [],
  regioes: [],
  municipios: [],
  modalidades: [],
  esferas: [],
  tipo: 'todos',
  soMeEpp: false,
  soSrp: false,
  soNovas: false,
  valorMin: '',
  valorMax: '',
  incluirSemValor: true,
  incluir: '',
  excluir: '',
  diasMax: '',
  triagemView: 'ocultar-descartadas',
  objetoCompleto: false,
  incluirHistorico: false,
};

function lerLocalStorage(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    if (!bruto) return padrao;
    const lido = JSON.parse(bruto);
    return Array.isArray(padrao) ? lido : { ...padrao, ...lido };
  } catch {
    return padrao;
  }
}

function gravarLocalStorage(chave, valor) {
  // setItem lança QuotaExceededError (Safari privado, disco cheio) e um throw
  // dentro do efeito derrubaria a árvore inteira: tela branca.
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* não persistido nesta sessão — não vale quebrar a tela */
  }
}

const listaChaves = (s) =>
  s.split(',').map((k) => normalizar(k.trim())).filter(Boolean);

function diasAte(iso) {
  // Fonte pobre (diário oficial) pode não ter prazo: sem isso, NaN contamina
  // ordenação e rótulo de prazo.
  if (!iso) return null;
  const enc = new Date(iso);
  if (Number.isNaN(enc.getTime())) return null;
  const hoje = new Date();
  const encDia = new Date(enc.getFullYear(), enc.getMonth(), enc.getDate());
  const hojeDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((encDia - hojeDia) / 86400000);
}

function publicadoNasUltimas24h(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() <= 86400000;
}

// Comparadores por coluna. `null` sempre no fim, nos dois sentidos: valor
// desconhecido não é zero, e prazo ausente não é "encerra hoje".
const texto = (v) => (v || '').toString();
const COLUNAS = {
  prazo: (a, b) => cmpNum(a.dias, b.dias),
  valor: (a, b) => cmpNum(a.item.valor, b.item.valor),
  local: (a, b) => texto(a.item.municipio).localeCompare(texto(b.item.municipio), 'pt-BR'),
  orgao: (a, b) => texto(a.item.orgao).localeCompare(texto(b.item.orgao), 'pt-BR'),
  publicado: (a, b) => texto(a.item.publicado).localeCompare(texto(b.item.publicado)),
};

function cmpNum(x, y) {
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x - y;
}

export default function App() {
  const [status, setStatus] = useState('carregando'); // carregando | ok | erro
  const [licitacoes, setLicitacoes] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [filtros, setFiltros] = useState(() => lerLocalStorage(FILTROS_KEY, FILTROS_PADRAO));
  const [triagem, setTriagem] = useState(() => lerLocalStorage(TRIAGEM_KEY, {}));
  const [buscas, setBuscas] = useState(() => lerLocalStorage(BUSCAS_KEY, []));
  const [ordem, setOrdem] = useState({ coluna: 'prazo', desc: false });
  const [carregandoUfs, setCarregandoUfs] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [menuOrdem, setMenuOrdem] = useState(null);
  const [avisosAbertos, setAvisosAbertos] = useState(false);
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('md'));

  const [indice, setIndice] = useState(null);
  // A aba fica no hash para o link poder ser guardado.
  const [aba, setAba] = useState(() =>
    window.location.hash === '#concursos' ? 'concursos' : 'licitacoes',
  );

  useEffect(() => {
    window.location.hash = aba === 'concursos' ? '#concursos' : '';
  }, [aba]);

  useEffect(() => {
    carregarIndex()
      .then((idx) => {
        setIndice(idx);
        setAvisos(idx.avisos || []);
        setStatus('ok');
      })
      .catch(() => setStatus('erro'));
  }, []);

  // Todas as UFs da coleta, começando pela que você mais usa. Comprimidas elas
  // somam ~2,3 MB no total, então exigir uma escolha antes de mostrar qualquer
  // coisa era uma barreira que não protegia nada.
  const ufsParaCarregar = useMemo(() => {
    const existentes = Object.keys(indice?.por_uf || {});
    if (!existentes.length) return [];

    const pedidas = new Set(filtros.ufs);
    for (const [uf, regiao] of Object.entries(UF_PARA_REGIAO)) {
      if (filtros.regioes.includes(regiao)) pedidas.add(uf);
    }

    // O que você filtrou vem primeiro; depois a última UF usada; depois as
    // maiores, que é onde está a maior chance de ter o que você procura.
    const prioridade = (uf) => {
      if (pedidas.has(uf)) return 0;
      if (uf === localStorage.getItem(UF_RECENTE_KEY)) return 1;
      return 2;
    };
    return existentes.sort(
      (a, b) => prioridade(a) - prioridade(b) || (indice.por_uf[b] || 0) - (indice.por_uf[a] || 0),
    );
  }, [filtros.ufs, filtros.regioes, indice]);

  // Carga progressiva: cada UF que chega entra na tela na hora, em vez de
  // esperar todas. Acumula por id porque a UF que chega depois não pode
  // sobrescrever o que você já está lendo.
  useEffect(() => {
    if (!indice || ufsParaCarregar.length === 0) return;
    let cancelado = false;
    setLicitacoes([]);
    setCarregandoUfs(true);

    (async () => {
      for (const uf of ufsParaCarregar) {
        const lics = await carregarUf(uf);
        if (cancelado) return;
        setLicitacoes((anterior) => {
          const porId = new Map(anterior.map((l) => [l.id, l]));
          for (const l of lics) porId.set(l.id, l);
          return [...porId.values()];
        });
      }

      if (filtros.incluirHistorico) {
        const meses = (indice.meses || []).slice(0, 12);
        const historico = await carregarHistorico(ufsParaCarregar, meses);
        if (cancelado) return;
        setLicitacoes((anterior) => {
          // O aberto vence o histórico: é o registro com itens e enriquecimento.
          const porId = new Map(historico.map((l) => [l.id, l]));
          for (const l of anterior) porId.set(l.id, l);
          return [...porId.values()];
        });
      }
      if (!cancelado) setCarregandoUfs(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [indice, ufsParaCarregar, filtros.incluirHistorico]);

  // Lembra a UF que você mais filtra, para ela vir primeiro na próxima visita.
  useEffect(() => {
    if (filtros.ufs.length === 1) {
      try {
        localStorage.setItem(UF_RECENTE_KEY, filtros.ufs[0]);
      } catch {
        /* sem persistência nesta sessão */
      }
    }
  }, [filtros.ufs]);

  useEffect(() => gravarLocalStorage(FILTROS_KEY, filtros), [filtros]);
  useEffect(() => gravarLocalStorage(TRIAGEM_KEY, triagem), [triagem]);
  useEffect(() => gravarLocalStorage(BUSCAS_KEY, buscas), [buscas]);

  // Vem do index, não dos dados carregados: você precisa poder escolher uma UF
  // que ainda não baixou.
  const ufsDisponiveis = useMemo(
    () => Object.keys(indice?.por_uf || {}).sort(),
    [indice],
  );
  const modalidadesDisponiveis = useMemo(
    () => [...new Set(licitacoes.map((l) => l.modalidade).filter(Boolean))].sort(),
    [licitacoes],
  );
  const municipiosDisponiveis = useMemo(
    () =>
      [...new Set(licitacoes.map((l) => (l.municipio ? `${l.municipio}-${l.uf}` : null)).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, 'pt-BR'),
      ),
    [licitacoes],
  );

  // Índice invertido (prefixo -> ids), construído uma vez por lista. Varrer os
  // 13.928 editais a cada tecla dava 566 ms no pior frame — medido no browser.
  const indiceBusca = useMemo(
    () => indexar(licitacoes, (l) => l.id, (l) => l.objeto),
    [licitacoes],
  );

  // A digitação não espera o filtro: o React mantém a tela responsiva e aplica
  // o resultado quando fica pronto.
  const incluirAdiado = useDeferredValue(filtros.incluir);

  const linhas = useMemo(() => {
    const incluirChaves = listaChaves(incluirAdiado);
    const excluirChaves = listaChaves(filtros.excluir);
    // Palavras das áreas selecionadas: somam-se às suas, não as substituem.
    const areaChaves = filtros.areas.flatMap((a) => listaChaves(AREAS[a] || ''));
    // Uma consulta ao índice resolve todos os editais de uma vez.
    const idsBusca = incluirChaves.length
      ? incluirChaves.reduce((acc, frase) => {
          const ids = idsQueCasam(indiceBusca, frase) || new Set();
          return acc === null ? ids : new Set([...acc, ...ids]);
        }, null)
      : null;
    const temFiltroValor = filtros.valorMin !== '' || filtros.valorMax !== '';
    const min = filtros.valorMin === '' ? null : Number(filtros.valorMin);
    const max = filtros.valorMax === '' ? null : Number(filtros.valorMax);
    const diasMax = filtros.diasMax === '' ? null : Number(filtros.diasMax);

    const filtradas = licitacoes
      .filter((item) => {
        // A busca por texto vem primeiro: é o filtro mais seletivo (uma consulta
        // ao índice já reduziu 13.928 a dezenas), e sair aqui evita rodar os
        // outros doze testes em cada edital descartado.
        if (idsBusca && !idsBusca.has(item.id)) return false;
        if (filtros.ufs.length && !filtros.ufs.includes(item.uf)) return false;
        if (filtros.regioes.length && !filtros.regioes.includes(UF_PARA_REGIAO[item.uf]))
          return false;
        if (filtros.municipios.length && !filtros.municipios.includes(`${item.municipio}-${item.uf}`))
          return false;
        if (filtros.modalidades.length && !filtros.modalidades.includes(item.modalidade))
          return false;
        if (filtros.esferas.length && !filtros.esferas.includes(item.esfera)) return false;

        // "Misto" conta como serviço e como material: tem os dois dentro.
        if (filtros.tipo !== 'todos') {
          const tipo = item.tipo || '';
          if (tipo !== filtros.tipo && tipo !== 'Misto') return false;
        }
        if (filtros.soMeEpp && !/ME\/EPP/i.test(item.beneficio || '')) return false;
        if (filtros.soSrp && !item.srp) return false;
        if (filtros.soNovas && !publicadoNasUltimas24h(item.publicado)) return false;

        if (temFiltroValor) {
          if (item.valor == null) {
            // Orçamento sigiloso: descartar por padrão esconderia edital bom.
            if (!filtros.incluirSemValor) return false;
          } else {
            if (min != null && item.valor < min) return false;
            if (max != null && item.valor > max) return false;
          }
        }

        const objeto = normalizar(item.objeto || '');
        if (areaChaves.length && !areaChaves.some((k) => objeto.includes(k))) return false;
        if (excluirChaves.length && excluirChaves.some((k) => objeto.includes(k))) return false;


        const dias = diasAte(item.encerramento);
        if (diasMax != null && (dias == null || dias > diasMax)) return false;

        const estado = triagem[item.id] || null;
        if (filtros.triagemView === 'so-interessa' && estado !== 'interessa') return false;
        if (filtros.triagemView === 'ocultar-descartadas' && estado === 'descartei') return false;

        return true;
      })
      .map((item) => ({ item, dias: diasAte(item.encerramento) }));

    const cmp = COLUNAS[ordem.coluna] || COLUNAS.prazo;
    return filtradas.sort((a, b) => {
      // Encerradas (histórico de 30 dias) sempre depois das abertas, qualquer
      // que seja a coluna ordenada — senão a primeira tela é só passado.
      const encerradaA = a.dias != null && a.dias < 0;
      const encerradaB = b.dias != null && b.dias < 0;
      if (encerradaA !== encerradaB) return encerradaA ? 1 : -1;
      const r = cmp(a, b);
      return ordem.desc ? -r : r;
    });
  }, [licitacoes, filtros, triagem, ordem, incluirAdiado, indiceBusca]);

  const filtrosAtivos = useMemo(() => {
    const p = FILTROS_PADRAO;
    return Object.keys(p).filter((k) => {
      const v = filtros[k];
      const d = p[k];
      return Array.isArray(v) ? v.length > 0 : v !== d;
    }).length;
  }, [filtros]);

  const salvarBusca = (nome) =>
    setBuscas((bs) => [...bs.filter((b) => b.nome !== nome), { nome, filtros }]);
  const excluirBusca = (nome) => setBuscas((bs) => bs.filter((b) => b.nome !== nome));

  return (
    <>
      <MuiLink
        href="#conteudo"
        sx={{
          position: 'absolute',
          left: -9999,
          top: 0,
          zIndex: 100,
          bgcolor: 'background.paper',
          p: 1,
          minHeight: ALVO_TOQUE,
          display: 'inline-flex',
          alignItems: 'center',
          '&:focus': { left: 8, top: 8 },
        }}
      >
        Pular para o conteúdo
      </MuiLink>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Typography variant="h1" sx={{ fontSize: { xs: '1.25rem', md: '1.75rem' }, mb: { xs: 0.5, md: 1 } }}>
          Radar público
        </Typography>

        <Tabs
          value={aba}
          onChange={(_, v) => setAba(v)}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Licitações" value="licitacoes" sx={{ minHeight: ALVO_TOQUE }} />
          <Tab label="Concursos" value="concursos" sx={{ minHeight: ALVO_TOQUE }} />
        </Tabs>

        <Box id="conteudo">
          {aba === 'concursos' && <Concursos />}

          {aba === 'licitacoes' && status === 'carregando' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
              <CircularProgress aria-hidden="true" />
              <Typography>Carregando dados…</Typography>
            </Box>
          )}

          {aba === 'licitacoes' && status === 'erro' && (
            <Alert severity="info">Nenhuma coleta ainda — rode o coletor.</Alert>
          )}

          {aba === 'licitacoes' && status === 'ok' && (
            <>
              {/* Coleta parcial precisa aparecer: sem isso a ausência de uma
                  modalidade inteira passa por "não há licitações hoje". */}
              {/* Um aviso por UF×modalidade enche a tela: quando a API do PNCP
                  cai, são 19 linhas antes do primeiro edital. A mensagem vira
                  uma frase, e a lista completa fica a um clique. */}
              {avisos.length > 0 && (
                <Alert
                  severity="warning"
                  sx={{ mb: 2 }}
                  action={
                    avisos.length > 1 && (
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => setAvisosAbertos((a) => !a)}
                        sx={{ minHeight: ALVO_TOQUE }}
                      >
                        {avisosAbertos ? 'Ocultar' : 'Ver quais'}
                      </Button>
                    )
                  }
                >
                  Coleta incompleta: {avisos.length} consulta
                  {avisos.length === 1 ? '' : 's'} ao PNCP falhou
                  {avisos.length === 1 ? '' : 'ram'}, então pode faltar edital na lista.
                  {avisosAbertos && (
                    <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
                      {avisos.map((aviso) => (
                        <li key={aviso}>{aviso}</li>
                      ))}
                    </Box>
                  )}
                </Alert>
              )}

              {/* No celular os filtros são muitos para ficar empilhados acima
                  da lista: viram folha inferior, aberta pela barra de ações
                  que fica ao alcance do polegar. */}
              {estreito ? (
                <Drawer
                  anchor="bottom"
                  open={filtrosAbertos}
                  onClose={() => setFiltrosAbertos(false)}
                  PaperProps={{
                    sx: {
                      maxHeight: '88vh',
                      borderTopLeftRadius: 16,
                      borderTopRightRadius: 16,
                      px: 2,
                      pt: 1,
                      pb: `calc(16px + env(safe-area-inset-bottom))`,
                    },
                  }}
                >
                  <Box
                    aria-hidden="true"
                    sx={{ width: 32, height: 4, bgcolor: 'divider', borderRadius: 2, mx: 'auto', mb: 1 }}
                  />
                  <Filtros
                    semMoldura
                    ufsDisponiveis={ufsDisponiveis}
                    modalidadesDisponiveis={modalidadesDisponiveis}
                    municipiosDisponiveis={municipiosDisponiveis}
                    filtros={filtros}
                    setFiltros={setFiltros}
                    onLimpar={() => setFiltros(FILTROS_PADRAO)}
                    buscas={buscas}
                    onSalvarBusca={salvarBusca}
                    onExcluirBusca={excluirBusca}
                  />
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={() => setFiltrosAbertos(false)}
                    sx={{
                      minHeight: ALVO_TOQUE,
                      position: 'sticky',
                      bottom: 0,
                      // Sombra separa o botão do conteúdo que passa atrás dele.
                      boxShadow: '0 -8px 12px -8px rgba(0,0,0,0.35)',
                    }}
                  >
                    Ver {linhas.length} resultado{linhas.length === 1 ? '' : 's'}
                  </Button>
                </Drawer>
              ) : (
                <Filtros
                  ufsDisponiveis={ufsDisponiveis}
                  modalidadesDisponiveis={modalidadesDisponiveis}
                  municipiosDisponiveis={municipiosDisponiveis}
                  filtros={filtros}
                  setFiltros={setFiltros}
                  onLimpar={() => setFiltros(FILTROS_PADRAO)}
                  buscas={buscas}
                  onSalvarBusca={salvarBusca}
                  onExcluirBusca={excluirBusca}
                />
              )}

              <Box aria-live="polite" sx={{ mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {`${linhas.length} licitaç${linhas.length === 1 ? 'ão' : 'ões'}`}
                  {carregandoUfs && ' · carregando as demais UFs…'}
                  {filtros.incluir !== incluirAdiado && ' · buscando…'}
                  {` · coleta de ${indice?.gerado_em?.slice(0, 10) || ''}`}
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {' · '}dados do PNCP; confirme sempre no edital antes de decidir
                  </Box>
                </Typography>
              </Box>

              {linhas.length === 0 && !carregandoUfs ? (
                <Alert severity="info">Nenhuma licitação corresponde aos filtros atuais.</Alert>
              ) : (
                <Resultados
                  rows={linhas}
                  triagem={triagem}
                  setTriagem={setTriagem}
                  ordem={ordem}
                  setOrdem={setOrdem}
                  objetoCompleto={filtros.objetoCompleto}
                />
              )}
            </>
          )}
        </Box>
      </Container>

      {/* Barra de ações do celular: filtro e ordenação ficam embaixo, onde o
          polegar alcança, e não no topo da página. */}
      {estreito && aba === 'licitacoes' && status === 'ok' && (
        <Box
          component="nav"
          aria-label="Ações da lista"
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            display: 'flex',
            gap: 1,
            px: 2,
            pt: 1,
            pb: `calc(8px + env(safe-area-inset-bottom))`,
            bgcolor: 'background.paper',
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Badge
            badgeContent={filtrosAtivos}
            color="primary"
            sx={{ flex: 1, '& .MuiBadge-badge': { top: 6, right: 10 } }}
          >
            <Button
              fullWidth
              variant="contained"
              startIcon={<TuneIcon />}
              onClick={() => setFiltrosAbertos(true)}
              sx={{ minHeight: ALVO_TOQUE }}
            >
              Filtros
            </Button>
          </Badge>
          <Button
            variant="outlined"
            startIcon={<SwapVertIcon />}
            onClick={(e) => setMenuOrdem(e.currentTarget)}
            sx={{ minHeight: ALVO_TOQUE, flex: 1, bgcolor: 'background.paper' }}
          >
            {ORDENS.find((o) => o.id === ordem.coluna)?.curto || 'Ordenar'}
          </Button>
          <Menu anchorEl={menuOrdem} open={Boolean(menuOrdem)} onClose={() => setMenuOrdem(null)}>
            {ORDENS.map((o) => (
              <MenuItem
                key={`${o.id}-${o.desc}`}
                selected={ordem.coluna === o.id && ordem.desc === o.desc}
                onClick={() => {
                  setOrdem({ coluna: o.id, desc: o.desc });
                  setMenuOrdem(null);
                }}
                sx={{ minHeight: ALVO_TOQUE }}
              >
                {o.label}
              </MenuItem>
            ))}
          </Menu>
        </Box>
      )}

      {/* Espaço para a barra fixa não cobrir o último card. */}
      {estreito && <Box sx={{ height: `calc(72px + env(safe-area-inset-bottom))` }} />}
    </>
  );
}

/// Sem cabeçalho de tabela no celular, a ordenação precisa estar dita por
/// extenso — inclusive o sentido, que numa seta é adivinhação.
const ORDENS = [
  { id: 'prazo', desc: false, label: 'Encerra primeiro', curto: 'Prazo' },
  { id: 'prazo', desc: true, label: 'Encerra por último', curto: 'Prazo' },
  { id: 'valor', desc: true, label: 'Maior valor', curto: 'Valor' },
  { id: 'valor', desc: false, label: 'Menor valor', curto: 'Valor' },
  { id: 'publicado', desc: true, label: 'Publicado mais recente', curto: 'Publicação' },
  { id: 'local', desc: false, label: 'Município (A–Z)', curto: 'Município' },
];
