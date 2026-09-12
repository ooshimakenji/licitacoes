import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
  Autocomplete,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { carregarConcursos } from './dados.js';
import { tokenizar, casa } from './busca.js';
import { MONO, ALVO_TOQUE } from './theme.js';
import { NOMES_REGIOES, UF_PARA_REGIAO } from './areas.js';

const TRIAGEM_KEY = 'concursos:triagem';
const FILTROS_KEY = 'concursos:filtros';
const POR_LEVA = 25;

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const NIVEIS = ['Fundamental', 'Médio', 'Técnico', 'Superior'];

const PADRAO = {
  ufs: [],
  regioes: [],
  niveis: [],
  salarioMin: '',
  soComVagas: false,
  busca: '',
  ocultarDescartados: true,
};

function ler(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? { ...padrao, ...JSON.parse(bruto) } : padrao;
  } catch {
    return padrao;
  }
}

/// Dias até o fim das inscrições. O site escreve "21/09/2026" ou "14 a 28/09/2026"
/// — o que importa é sempre a última data do texto.
function diasAteFim(inscricoes) {
  const datas = (inscricoes || '').match(/\d{2}\/\d{2}\/\d{4}/g);
  if (!datas?.length) return null;
  const [d, m, a] = datas[datas.length - 1].split('/').map(Number);
  const fim = new Date(a, m - 1, d);
  const hoje = new Date();
  return Math.round((fim - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 86400000);
}

export default function Concursos() {
  const [lista, setLista] = useState(null);
  const [filtros, setFiltros] = useState(() => ler(FILTROS_KEY, PADRAO));
  const [triagem, setTriagem] = useState(() => ler(TRIAGEM_KEY, {}));
  const [visiveis, setVisiveis] = useState(POR_LEVA);

  useEffect(() => {
    carregarConcursos().then(setLista);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTROS_KEY, JSON.stringify(filtros));
      localStorage.setItem(TRIAGEM_KEY, JSON.stringify(triagem));
    } catch {
      /* não persistido nesta sessão */
    }
  }, [filtros, triagem]);

  const set = (campo) => (valor) => setFiltros((f) => ({ ...f, [campo]: valor }));

  const ufsDisponiveis = useMemo(
    () => [...new Set((lista || []).map((c) => c.uf).filter(Boolean))].sort(),
    [lista],
  );

  const tokensPorId = useMemo(() => {
    const mapa = new Map();
    for (const c of lista || []) mapa.set(c.id, tokenizar(`${c.orgao} ${c.cargos}`));
    return mapa;
  }, [lista]);

  const filtrados = useMemo(() => {
    if (!lista) return [];
    const alvos = tokenizar(filtros.busca);
    const salarioMin = filtros.salarioMin === '' ? null : Number(filtros.salarioMin);

    return lista
      .filter((c) => {
        if (filtros.ufs.length && !filtros.ufs.includes(c.uf)) return false;
        if (filtros.regioes.length && !filtros.regioes.includes(UF_PARA_REGIAO[c.uf])) return false;
        if (filtros.niveis.length && !filtros.niveis.some((n) => c.escolaridade?.includes(n)))
          return false;
        if (salarioMin != null && (c.salario_ate || 0) < salarioMin) return false;
        // Cadastro de reserva não garante vaga: quem quer nomeação filtra fora.
        if (filtros.soComVagas && /cadastro/i.test(c.vagas)) return false;
        if (alvos.length && !casa(tokensPorId.get(c.id) || [], alvos)) return false;
        if (filtros.ocultarDescartados && triagem[c.id] === 'descartei') return false;
        return true;
      })
      .map((c) => ({ c, dias: diasAteFim(c.inscricoes) }))
      .sort((a, b) => {
        // Encerrados no fim; entre abertos, quem fecha antes primeiro.
        const fimA = a.dias == null || a.dias < 0;
        const fimB = b.dias == null || b.dias < 0;
        if (fimA !== fimB) return fimA ? 1 : -1;
        return (a.dias ?? 9999) - (b.dias ?? 9999);
      });
  }, [lista, filtros, triagem, tokensPorId]);

  if (lista === null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
        <CircularProgress aria-hidden="true" />
        <Typography>Carregando concursos…</Typography>
      </Box>
    );
  }

  return (
    <>
      <Box component="fieldset" sx={{ border: 'none', p: 0, m: 0, mb: 2 }}>
        <Typography component="legend" variant="h2" sx={{ fontSize: '1.1rem', mb: 1 }}>
          Filtros
        </Typography>
        <Stack spacing={2}>
          <Box role="group" aria-label="Escolaridade">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Escolaridade
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {NIVEIS.map((n) => {
                const ativo = filtros.niveis.includes(n);
                return (
                  <Chip
                    key={n}
                    label={n}
                    onClick={() =>
                      set('niveis')(
                        ativo ? filtros.niveis.filter((x) => x !== n) : [...filtros.niveis, n],
                      )
                    }
                    color={ativo ? 'primary' : 'default'}
                    variant={ativo ? 'filled' : 'outlined'}
                    aria-pressed={ativo}
                    sx={{ minHeight: 44 }}
                  />
                );
              })}
            </Stack>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Autocomplete
              multiple
              options={NOMES_REGIOES}
              value={filtros.regioes}
              onChange={(_, v) => set('regioes')(v)}
              sx={{ flex: 1, minWidth: 170 }}
              renderInput={(p) => <TextField {...p} label="Região" placeholder="Todas" />}
            />
            <Autocomplete
              multiple
              options={ufsDisponiveis}
              value={filtros.ufs}
              onChange={(_, v) => set('ufs')(v)}
              sx={{ flex: 1, minWidth: 140 }}
              renderInput={(p) => <TextField {...p} label="UF" placeholder="Todas" />}
            />
            <TextField
              label="Salário mínimo (R$)"
              type="number"
              value={filtros.salarioMin}
              onChange={(e) => set('salarioMin')(e.target.value)}
              sx={{ flex: 1 }}
              inputProps={{ min: 0 }}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              label="Buscar por órgão ou cargo"
              value={filtros.busca}
              onChange={(e) => set('busca')(e.target.value)}
              sx={{ flex: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={filtros.soComVagas}
                  onChange={(e) => set('soComVagas')(e.target.checked)}
                />
              }
              label="Só com vagas (sem cadastro de reserva)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={filtros.ocultarDescartados}
                  onChange={(e) => set('ocultarDescartados')(e.target.checked)}
                />
              }
              label="Ocultar descartados"
            />
          </Stack>
        </Stack>
      </Box>

      <Box aria-live="polite" sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {filtrados.length} concurso{filtrados.length === 1 ? '' : 's'} de {lista.length} ·
          dados do PCI Concursos; confirme sempre no edital do órgão
        </Typography>
      </Box>

      {filtrados.length === 0 ? (
        <Alert severity="info">Nenhum concurso corresponde aos filtros atuais.</Alert>
      ) : (
        <>
          <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {filtrados.slice(0, visiveis).map(({ c, dias }) => (
              <Card
                key={c.id}
                c={c}
                dias={dias}
                estado={triagem[c.id] || null}
                setTriagem={setTriagem}
              />
            ))}
          </Stack>
          {visiveis < filtrados.length && (
            <Button
              fullWidth
              variant="outlined"
              onClick={() => setVisiveis((v) => v + POR_LEVA)}
              sx={{ mt: 2, minHeight: ALVO_TOQUE }}
            >
              Carregar mais {Math.min(POR_LEVA, filtrados.length - visiveis)} de{' '}
              {filtrados.length - visiveis}
            </Button>
          )}
        </>
      )}
    </>
  );
}

/// Mesma guia lateral do radar de licitações: o número que decide se dá tempo
/// de se inscrever é o que se lê descendo a lista.
function guia(dias) {
  if (dias == null) return { forte: '—', fraco: 'sem prazo', bg: '#EEF0F2', cor: '#3A4750' };
  if (dias < 0) return { forte: 'fim', fraco: 'encerrado', bg: '#EEF0F2', cor: '#3A4750' };
  if (dias === 0) return { forte: 'hoje', fraco: 'último dia', bg: '#7A4A00', cor: '#FFFFFF' };
  if (dias <= 7)
    return { forte: dias, fraco: dias === 1 ? 'dia' : 'dias', bg: '#7A4A00', cor: '#FFFFFF' };
  return { forte: dias, fraco: 'dias', bg: '#E7EDF2', cor: '#0B4F6C' };
}

function Card({ c, dias, estado, setTriagem }) {
  const g = guia(dias);
  const reserva = /cadastro/i.test(c.vagas);

  return (
    <Paper component="li" variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box sx={{ display: 'flex' }}>
        <Box
          aria-hidden="true"
          sx={{
            width: 56,
            flexShrink: 0,
            bgcolor: g.bg,
            color: g.cor,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 1.5,
          }}
        >
          <Typography
            sx={{ fontFamily: MONO, fontSize: String(g.forte).length > 3 ? 15 : 24, fontWeight: 600, lineHeight: 1 }}
          >
            {g.forte}
          </Typography>
          <Typography sx={{ fontSize: 11, mt: 0.25 }}>{g.fraco}</Typography>
        </Box>

        <Box sx={{ p: 1.5, minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {c.uf === 'BR' ? 'Nacional' : c.uf} · inscrições {c.inscricoes}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 500, mt: 0.25 }}>
            {c.orgao}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontWeight: 600, mt: 0.75 }}>
            {c.salario_ate ? `até ${moeda.format(c.salario_ate)}` : 'salário não informado'}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
            {c.vagas} · {c.cargos}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
            {reserva && <Chip label="Cadastro de reserva" size="small" variant="outlined" />}
            {c.escolaridade?.map((n) => (
              <Chip key={n} label={n} size="small" variant="outlined" />
            ))}
          </Stack>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          flexWrap: 'wrap',
        }}
      >
        <Button
          onClick={() =>
            setTriagem((t) => ({ ...t, [c.id]: estado === 'interessa' ? null : 'interessa' }))
          }
          aria-pressed={estado === 'interessa'}
          variant={estado === 'interessa' ? 'contained' : 'outlined'}
          color="success"
          startIcon={<CheckCircleIcon />}
          sx={{ minHeight: ALVO_TOQUE }}
        >
          Interessa
        </Button>
        <Button
          onClick={() =>
            setTriagem((t) => ({ ...t, [c.id]: estado === 'descartei' ? null : 'descartei' }))
          }
          aria-pressed={estado === 'descartei'}
          variant={estado === 'descartei' ? 'contained' : 'outlined'}
          color="error"
          startIcon={<CancelIcon />}
          sx={{ minHeight: ALVO_TOQUE }}
        >
          Descartar
        </Button>
        <Box sx={{ flex: 1 }} />
        <Link
          href={c.link}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: ALVO_TOQUE }}
        >
          Ver edital <OpenInNewIcon fontSize="inherit" aria-hidden="true" />
        </Link>
      </Box>
    </Paper>
  );
}
