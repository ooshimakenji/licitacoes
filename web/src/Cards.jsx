import { useState } from 'react';
import { Box, Paper, Typography, Chip, Stack, Button, Collapse, Link } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Detalhes, { dataTexto } from './Detalhes.jsx';
import { MONO, ALVO_TOQUE } from './theme.js';

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const POR_LEVA = 20;

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaMes = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

/// A guia de prazo. É a lombada do protocolo: o que você lê descendo a lista.
/// Quando a lista está agrupada por dia, o dia já foi dito no cabeçalho do
/// grupo — então aqui vale **a hora**, que é o que ainda decide se dá tempo.
function guia({ dias, encerramento }, agrupado) {
  if (dias == null) return { forte: '—', fraco: 'sem prazo', bg: '#EEF0F2', cor: '#3A4750' };

  const d = new Date(encerramento);
  const horaTexto = Number.isNaN(d.getTime()) ? '—' : hora.format(d);
  const urgente = dias >= 0 && dias <= 3;
  const cores = urgente
    ? { bg: '#7A4A00', cor: '#FFFFFF' } // 7,48:1 com branco
    : { bg: '#E7EDF2', cor: '#0B4F6C' }; // 8,1:1

  if (agrupado) {
    // Só a hora: o dia está no cabeçalho do grupo, e a cor de urgência também.
    return dias < 0
      ? { forte: horaTexto, fraco: 'encerrada', bg: '#EEF0F2', cor: '#3A4750' }
      : { forte: horaTexto, fraco: '', bg: '#E7EDF2', cor: '#0B4F6C' };
  }
  if (dias < 0) return { forte: 'fim', fraco: 'encerrada', bg: '#EEF0F2', cor: '#3A4750' };
  if (dias === 0) return { forte: horaTexto, fraco: 'hoje', ...cores };
  return { forte: dias, fraco: dias === 1 ? 'dia' : 'dias', ...cores };
}

/// Rótulo do grupo. Só faz sentido quando a lista está ordenada por prazo —
/// em "maior valor" agrupar por dia embaralharia o que você pediu.
function grupoDe(dias, encerramento) {
  if (dias == null) return 'Sem prazo informado';
  if (dias < 0) return 'Encerradas';
  if (dias === 0) return 'Encerram hoje';
  if (dias === 1) return 'Encerram amanhã';
  const d = new Date(encerramento);
  const data = Number.isNaN(d.getTime()) ? '' : diaMes.format(d);
  return `Em ${dias} dias · ${data}`;
}

/// Urgência é do grupo, não de cada card: dita uma vez, ela volta a ser sinal.
const urgenteGrupo = (dias) => dias != null && dias >= 0 && dias <= 3;

export default function Cards({ rows, triagem, setTriagem, objetoCompleto, ordem }) {
  const [visiveis, setVisiveis] = useState(POR_LEVA);
  const lista = rows.slice(0, visiveis);
  const agrupado = (ordem?.coluna || 'prazo') === 'prazo';

  let grupoAtual = null;

  return (
    <Box>
      <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {lista.map(({ item, dias }) => {
          const grupo = agrupado ? grupoDe(dias, item.encerramento) : null;
          const novoGrupo = grupo && grupo !== grupoAtual;
          if (novoGrupo) grupoAtual = grupo;
          const quantos = novoGrupo
            ? rows.filter((r) => grupoDe(r.dias, r.item.encerramento) === grupo).length
            : 0;

          return (
            <Box component="li" key={item.id} sx={{ listStyle: 'none' }}>
              {novoGrupo && (
                <Box
                  sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    bgcolor: 'background.default',
                    py: 0.75,
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    component="h2"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.75,
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      ...(urgenteGrupo(dias)
                        ? { bgcolor: '#7A4A00', color: '#FFFFFF' }
                        : { color: 'text.secondary' }),
                    }}
                  >
                    {urgenteGrupo(dias) && <WarningAmberIcon fontSize="small" aria-hidden="true" />}
                    {grupo} · {quantos}
                  </Typography>
                </Box>
              )}
              <Card
                item={item}
                dias={dias}
                agrupado={agrupado}
                estado={triagem[item.id] || null}
                setTriagem={setTriagem}
                objetoCompleto={objetoCompleto}
              />
            </Box>
          );
        })}
      </Stack>

      {visiveis < rows.length && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => setVisiveis((v) => v + POR_LEVA)}
          sx={{ mt: 2, minHeight: ALVO_TOQUE }}
        >
          Carregar mais {Math.min(POR_LEVA, rows.length - visiveis)} de {rows.length - visiveis}
        </Button>
      )}
    </Box>
  );
}

function Card({ item, dias, agrupado, estado, setTriagem, objetoCompleto }) {
  const [aberto, setAberto] = useState(false);
  const g = guia({ dias, encerramento: item.encerramento }, agrupado);
  const meEpp = /ME\/EPP/i.test(item.beneficio || '');

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
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
            sx={{
              fontFamily: MONO,
              fontSize: String(g.forte).length > 3 ? 15 : 24,
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {g.forte}
          </Typography>
          {g.fraco && <Typography sx={{ fontSize: 11, mt: 0.25 }}>{g.fraco}</Typography>}
        </Box>

        <Box sx={{ p: 1.5, minWidth: 0, flex: 1 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {item.modalidade}
            {item.municipio ? ` · ${item.municipio}-${item.uf}` : ''}
          </Typography>

          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              mt: 0.25,
              ...(objetoCompleto
                ? {}
                : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
            }}
          >
            {item.objeto}
          </Typography>

          <Typography sx={{ fontFamily: MONO, fontWeight: 600, mt: 0.75 }}>
            {item.valor == null ? (
              <Box component="span" sx={{ fontFamily: 'inherit', color: 'text.secondary', fontWeight: 400, fontSize: 14 }}>
                valor não informado
              </Box>
            ) : (
              moeda.format(item.valor)
            )}
          </Typography>

          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
            {item.orgao}
          </Typography>

          {(item.tipo || meEpp || item.srp) && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
              {item.tipo && item.tipo !== 'não informado' && (
                <Chip label={item.tipo} size="small" variant="outlined" sx={{ '@media (pointer: coarse)': { minHeight: 28 } }} />
              )}
              {meEpp && <Chip label="ME/EPP" size="small" color="success" sx={{ '@media (pointer: coarse)': { minHeight: 28 } }} />}
              {item.srp && <Chip label="SRP" size="small" variant="outlined" sx={{ '@media (pointer: coarse)': { minHeight: 28 } }} />}
            </Stack>
          )}
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
        }}
      >
        <Button
          onClick={() => setTriagem((t) => ({ ...t, [item.id]: estado === 'interessa' ? null : 'interessa' }))}
          aria-pressed={estado === 'interessa'}
          variant={estado === 'interessa' ? 'contained' : 'outlined'}
          color="success"
          startIcon={<CheckCircleIcon />}
          sx={{ minHeight: ALVO_TOQUE }}
        >
          Interessa
        </Button>
        <Button
          onClick={() => setTriagem((t) => ({ ...t, [item.id]: estado === 'descartei' ? null : 'descartei' }))}
          aria-pressed={estado === 'descartei'}
          variant={estado === 'descartei' ? 'contained' : 'outlined'}
          color="error"
          startIcon={<CancelIcon />}
          sx={{ minHeight: ALVO_TOQUE }}
        >
          Descartar
        </Button>

        <Box sx={{ flex: 1 }} />

        <Button
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          aria-controls={`detalhes-${item.id}`}
          endIcon={aberto ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          sx={{ minHeight: ALVO_TOQUE }}
        >
          Detalhes
        </Button>
      </Box>

      <Collapse in={aberto} timeout="auto" unmountOnExit>
        <Box id={`detalhes-${item.id}`} sx={{ px: 1.5, pb: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Detalhes item={item} />
          <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
            <Link
              href={item.link_pncp}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: ALVO_TOQUE }}
            >
              Abrir no PNCP <OpenInNewIcon fontSize="inherit" aria-hidden="true" />
            </Link>
            {item.link && (
              <Link
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: ALVO_TOQUE }}
              >
                Sistema de origem <OpenInNewIcon fontSize="inherit" aria-hidden="true" />
              </Link>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div">
            Encerra em {dataTexto(item.encerramento)}
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  );
}
