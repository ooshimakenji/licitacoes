import { useEffect, useMemo, useState } from 'react';
import {
  Container,
  Typography,
  CircularProgress,
  Alert,
  Box,
  Link as MuiLink,
} from '@mui/material';
import Filtros from './Filtros.jsx';
import Tabela from './Tabela.jsx';
import { AREAS, UF_PARA_REGIAO } from './areas.js';

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

  useEffect(() => {
    fetch('data/licitacoes.json')
      .then((r) => {
        if (!r.ok) throw new Error('não encontrado');
        return r.json();
      })
      .then((d) => {
        setLicitacoes(d.licitacoes || []);
        setAvisos(d.avisos || []);
        setStatus('ok');
      })
      .catch(() => setStatus('erro'));
  }, []);

  useEffect(() => gravarLocalStorage(FILTROS_KEY, filtros), [filtros]);
  useEffect(() => gravarLocalStorage(TRIAGEM_KEY, triagem), [triagem]);
  useEffect(() => gravarLocalStorage(BUSCAS_KEY, buscas), [buscas]);

  const ufsDisponiveis = useMemo(
    () => [...new Set(licitacoes.map((l) => l.uf).filter(Boolean))].sort(),
    [licitacoes],
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
          '&:focus': { left: 8, top: 8 },
        }}
      >
        Pular para o conteúdo
      </MuiLink>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Typography variant="h1" sx={{ fontSize: '1.75rem', fontWeight: 700, mb: 2 }}>
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

              <Box aria-live="polite" sx={{ mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {linhas.length} licitaç{linhas.length === 1 ? 'ão encontrada' : 'ões encontradas'}
                  {' · '}os dados vêm do PNCP; confirme sempre no edital antes de decidir
                </Typography>
              </Box>

              {linhas.length === 0 ? (
                <Alert severity="info">Nenhuma licitação corresponde aos filtros atuais.</Alert>
              ) : (
                <Tabela
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
    </>
  );
}
