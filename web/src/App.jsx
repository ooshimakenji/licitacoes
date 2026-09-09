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

const FILTROS_KEY = 'licitacoes:filtros';
const TRIAGEM_KEY = 'licitacoes:triagem';

const FILTROS_PADRAO = {
  ufs: [],
  modalidades: [],
  valorMin: '',
  valorMax: '',
  incluir: '',
  excluir: '',
  diasMax: '',
  triagemView: 'ocultar-descartadas',
};

function lerLocalStorage(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? { ...padrao, ...JSON.parse(bruto) } : padrao;
  } catch {
    return padrao;
  }
}

const normalizar = (s) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const listaChaves = (s) =>
  s.split(',').map((k) => normalizar(k.trim())).filter(Boolean);

function diasAte(iso) {
  const enc = new Date(iso);
  const hoje = new Date();
  const encDia = new Date(enc.getFullYear(), enc.getMonth(), enc.getDate());
  const hojeDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((encDia - hojeDia) / 86400000);
}

export default function App() {
  const [status, setStatus] = useState('carregando'); // carregando | ok | erro
  const [licitacoes, setLicitacoes] = useState([]);
  const [filtros, setFiltros] = useState(() => lerLocalStorage(FILTROS_KEY, FILTROS_PADRAO));
  const [triagem, setTriagem] = useState(() => lerLocalStorage(TRIAGEM_KEY, {}));

  useEffect(() => {
    fetch('data/licitacoes.json')
      .then((r) => {
        if (!r.ok) throw new Error('não encontrado');
        return r.json();
      })
      .then((d) => {
        setLicitacoes(d.licitacoes || []);
        setStatus('ok');
      })
      .catch(() => setStatus('erro'));
  }, []);

  useEffect(() => {
    localStorage.setItem(FILTROS_KEY, JSON.stringify(filtros));
  }, [filtros]);

  useEffect(() => {
    localStorage.setItem(TRIAGEM_KEY, JSON.stringify(triagem));
  }, [triagem]);

  const ufsDisponiveis = useMemo(
    () => [...new Set(licitacoes.map((l) => l.uf))].sort(),
    [licitacoes],
  );
  const modalidadesDisponiveis = useMemo(
    () => [...new Set(licitacoes.map((l) => l.modalidade))].sort(),
    [licitacoes],
  );

  const linhas = useMemo(() => {
    const incluirChaves = listaChaves(filtros.incluir);
    const excluirChaves = listaChaves(filtros.excluir);
    const temFiltroValor = filtros.valorMin !== '' || filtros.valorMax !== '';
    const min = filtros.valorMin === '' ? null : Number(filtros.valorMin);
    const max = filtros.valorMax === '' ? null : Number(filtros.valorMax);
    const diasMax = filtros.diasMax === '' ? null : Number(filtros.diasMax);

    return licitacoes
      .filter((item) => {
        if (filtros.ufs.length && !filtros.ufs.includes(item.uf)) return false;
        if (filtros.modalidades.length && !filtros.modalidades.includes(item.modalidade))
          return false;

        if (temFiltroValor) {
          if (item.valor == null) return false;
          if (min != null && item.valor < min) return false;
          if (max != null && item.valor > max) return false;
        }

        if (incluirChaves.length) {
          const objeto = normalizar(item.objeto);
          if (!incluirChaves.some((k) => objeto.includes(k))) return false;
        }
        if (excluirChaves.length) {
          const objeto = normalizar(item.objeto);
          if (excluirChaves.some((k) => objeto.includes(k))) return false;
        }

        const dias = diasAte(item.encerramento);
        if (diasMax != null && dias > diasMax) return false;

        const estado = triagem[item.id] || null;
        if (filtros.triagemView === 'so-interessa' && estado !== 'interessa') return false;
        if (filtros.triagemView === 'ocultar-descartadas' && estado === 'descartei') return false;

        return true;
      })
      .map((item) => ({ item, dias: diasAte(item.encerramento) }))
      .sort((a, b) => new Date(a.item.encerramento) - new Date(b.item.encerramento));
  }, [licitacoes, filtros, triagem]);

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
              <Filtros
                ufsDisponiveis={ufsDisponiveis}
                modalidadesDisponiveis={modalidadesDisponiveis}
                filtros={filtros}
                setFiltros={setFiltros}
                onLimpar={() => setFiltros(FILTROS_PADRAO)}
              />

              <Box aria-live="polite" sx={{ mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {linhas.length} licitaç{linhas.length === 1 ? 'ão encontrada' : 'ões encontradas'}
                </Typography>
              </Box>

              {linhas.length === 0 ? (
                <Alert severity="info">Nenhuma licitação corresponde aos filtros atuais.</Alert>
              ) : (
                <Tabela rows={linhas} triagem={triagem} setTriagem={setTriagem} />
              )}
            </>
          )}
        </Box>
      </Container>
    </>
  );
}
