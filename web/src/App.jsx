import { useEffect, useMemo, useState } from 'react';
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
  useMediaQuery,
  useTheme,
  Link as MuiLink,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import Filtros from './Filtros.jsx';
import Resultados from './Resultados.jsx';
import { ALVO_TOQUE } from './theme.js';
import { AREAS, UF_PARA_REGIAO } from './areas.js';
import { carregarIndex, carregarUfs } from './dados.js';

const FILTROS_KEY = 'licitacoes:filtros';
const TRIAGEM_KEY = 'licitacoes:triagem';
const BUSCAS_KEY = 'licitacoes:buscas';

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

const normalizar = (s) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

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
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('md'));

  const [indice, setIndice] = useState(null);

  useEffect(() => {
    carregarIndex()
      .then((idx) => {
        setIndice(idx);
        setAvisos(idx.avisos || []);
        setStatus('ok');
      })
      .catch(() => setStatus('erro'));
  }, []);

  // As UFs que você filtra são as que a tela baixa: a base inteira passa de
  // 36 MB, e baixar tudo para depois filtrar era o que travava a tela.
  const ufsParaCarregar = useMemo(() => {
    const das = new Set(filtros.ufs);
    if (filtros.regioes.length) {
      for (const [uf, regiao] of Object.entries(UF_PARA_REGIAO)) {
        if (filtros.regioes.includes(regiao)) das.add(uf);
      }
    }
    // Só as que existem na coleta, para não pedir arquivo inexistente.
    const existentes = indice ? Object.keys(indice.por_uf || {}) : [];
    return [...das].filter((uf) => existentes.includes(uf)).sort();
  }, [filtros.ufs, filtros.regioes, indice]);

  useEffect(() => {
    if (!indice || ufsParaCarregar.length === 0) {
      setLicitacoes([]);
      return;
    }
    let cancelado = false;
    setCarregandoUfs(true);
    carregarUfs(ufsParaCarregar)
      .then((lics) => {
        if (!cancelado) setLicitacoes(lics);
      })
      .finally(() => {
        if (!cancelado) setCarregandoUfs(false);
      });
    return () => {
      cancelado = true;
    };
  }, [indice, ufsParaCarregar]);

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

  const linhas = useMemo(() => {
    const incluirChaves = listaChaves(filtros.incluir);
    const excluirChaves = listaChaves(filtros.excluir);
    // Palavras das áreas selecionadas: somam-se às suas, não as substituem.
    const areaChaves = filtros.areas.flatMap((a) => listaChaves(AREAS[a] || ''));
    const temFiltroValor = filtros.valorMin !== '' || filtros.valorMax !== '';
    const min = filtros.valorMin === '' ? null : Number(filtros.valorMin);
    const max = filtros.valorMax === '' ? null : Number(filtros.valorMax);
    const diasMax = filtros.diasMax === '' ? null : Number(filtros.diasMax);

    const filtradas = licitacoes
      .filter((item) => {
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
        if (incluirChaves.length && !incluirChaves.some((k) => objeto.includes(k))) return false;
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
  }, [licitacoes, filtros, triagem, ordem]);

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
        <Typography variant="h1" sx={{ fontSize: { xs: '1.25rem', md: '1.75rem' }, mb: { xs: 1, md: 2 } }}>
          Painel de licitações
        </Typography>

        <Box id="conteudo">
          {status === 'carregando' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
              <CircularProgress aria-hidden="true" />
              <Typography>Carregando dados…</Typography>
            </Box>
          )}

          {status === 'erro' && (
            <Alert severity="info">Nenhuma coleta ainda — rode o coletor.</Alert>
          )}

          {status === 'ok' && (
            <>
              {/* Coleta parcial precisa aparecer: sem isso a ausência de uma
                  modalidade inteira passa por "não há licitações hoje". */}
              {avisos.length > 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  Coleta incompleta — a lista abaixo pode estar faltando editais:
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    {avisos.map((aviso) => (
                      <li key={aviso}>{aviso}</li>
                    ))}
                  </Box>
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
                  {carregandoUfs
                    ? `Baixando ${ufsParaCarregar.join(', ')}…`
                    : ufsParaCarregar.length === 0
                      ? `${indice?.total?.toLocaleString('pt-BR')} editais na coleta de ${indice?.gerado_em?.slice(0, 10)}`
                      : `${linhas.length} licitaç${linhas.length === 1 ? 'ão' : 'ões'} em ${ufsParaCarregar.join(', ')} · coleta de ${indice?.gerado_em?.slice(0, 10)}`}
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {' · '}dados do PNCP; confirme sempre no edital antes de decidir
                  </Box>
                </Typography>
              </Box>

              {/* A base inteira passa de 36 MB: a tela baixa só as UFs que você
                  filtra, então sem escolha não há o que mostrar. */}
              {ufsParaCarregar.length === 0 ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Escolha uma <strong>UF</strong> ou uma <strong>região</strong> nos filtros para
                  carregar os editais — a base nacional é grande demais para baixar de uma vez.
                  <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {Object.entries(indice?.por_uf || {})
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([uf, n]) => (
                        <Chip
                          key={uf}
                          label={`${uf} (${n.toLocaleString('pt-BR')})`}
                          onClick={() => setFiltros((f) => ({ ...f, ufs: [...f.ufs, uf] }))}
                          sx={{ minHeight: 44 }}
                        />
                      ))}
                  </Box>
                </Alert>
              ) : linhas.length === 0 && !carregandoUfs ? (
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
      {estreito && status === 'ok' && (
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
