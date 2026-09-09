import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  Chip,
  Link,
  Paper,
  Box,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const dataCurta = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function prazoTexto(dias) {
  if (dias < 0) return 'encerrada';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

function ehNova(visto) {
  if (!visto) return false;
  const hoje = new Date();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return visto === fmt(hoje) || visto === fmt(ontem);
}

export default function Tabela({ rows, triagem, setTriagem }) {
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(25);

  // Um filtro mais estreito pode encurtar a lista para menos que a página
  // atual. Limitar em vez de zerar: `rows` também muda a cada clique de
  // triagem, e resetar jogaria o usuário de volta ao topo toda vez.
  const ultimaPagina = Math.max(0, Math.ceil(rows.length / porPagina) - 1);
  const paginaAtual = Math.min(pagina, ultimaPagina);
  const visiveis = rows.slice(paginaAtual * porPagina, paginaAtual * porPagina + porPagina);

  return (
    // tabIndex torna a área rolável alcançável só pelo teclado (WCAG 2.1.1),
    // já que a tabela tem minWidth 900 e rola na horizontal.
    <TableContainer component={Paper} variant="outlined" tabIndex={0} role="region" aria-label="Licitações">
      <Table sx={{ minWidth: 900 }}>
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Lista de licitações filtradas, ordenadas por prazo de encerramento crescente,
          {porPagina} por página.
        </caption>
        <TableHead>
          <TableRow>
            <TableCell component="th" scope="col">Prazo</TableCell>
            <TableCell component="th" scope="col">Valor</TableCell>
            <TableCell component="th" scope="col">Órgão / Município-UF</TableCell>
            <TableCell component="th" scope="col">Objeto</TableCell>
            <TableCell component="th" scope="col">Links</TableCell>
            <TableCell component="th" scope="col">Triagem</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visiveis.map(({ item, dias }) => {
            const critico = dias <= 3 && dias >= 0;
            const nova = ehNova(item.visto);
            const estado = triagem[item.id] || null;
            return (
              <TableRow key={item.id} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Typography
                      variant="body2"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontWeight: critico ? 700 : 400,
                        color: critico ? 'warning.main' : 'text.primary',
                      }}
                    >
                      {critico && <WarningAmberIcon fontSize="small" aria-hidden="true" />}
                      {prazoTexto(dias)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {dataCurta.format(new Date(item.encerramento))}
                    </Typography>
                    {nova && (
                      <Chip
                        icon={<FiberNewIcon aria-hidden="true" />}
                        label="NOVA"
                        size="small"
                        color="primary"
                        sx={{ width: 'fit-content' }}
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  {item.valor == null ? '—' : moeda.format(item.valor)}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{item.orgao}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.municipio}-{item.uf}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: 320 }}>
                  <Tooltip title={item.objeto}>
                    <Typography
                      variant="body2"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {item.objeto}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Link
                      href={item.link_pncp}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 44 }}
                    >
                      PNCP <OpenInNewIcon fontSize="inherit" aria-hidden="true" />
                      <Box component="span" sx={visuallyHidden}>
                        {' '}(abre em nova aba)
                      </Box>
                    </Link>
                    {/* Dispensa e inexigibilidade costumam vir sem link de
                        origem; href="" recarregaria a própria página. */}
                    {item.link && (
                      <Link
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 44 }}
                      >
                        Sistema de origem <OpenInNewIcon fontSize="inherit" aria-hidden="true" />
                        <Box component="span" sx={visuallyHidden}>
                          {' '}(abre em nova aba)
                        </Box>
                      </Link>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <ToggleButtonGroup
                    value={estado}
                    exclusive
                    onChange={(_, v) =>
                      setTriagem((t) => ({ ...t, [item.id]: v }))
                    }
                    aria-label={`Triagem da licitação ${item.orgao}`}
                    size="small"
                  >
                    <ToggleButton
                      value="interessa"
                      aria-label="Marcar como interessa"
                      sx={{ minWidth: 44, minHeight: 44 }}
                      color="success"
                    >
                      <CheckCircleIcon fontSize="small" aria-hidden="true" />
                    </ToggleButton>
                    <ToggleButton
                      value="descartei"
                      aria-label="Marcar como descartei"
                      sx={{ minWidth: 44, minHeight: 44 }}
                      color="error"
                    >
                      <CancelIcon fontSize="small" aria-hidden="true" />
                    </ToggleButton>
                  </ToggleButtonGroup>
                  <Typography variant="caption" component="div" color="text.secondary">
                    {estado === 'interessa' && 'Interessa'}
                    {estado === 'descartei' && 'Descartei'}
                    {!estado && 'Sem marca'}
                  </Typography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={rows.length}
        page={paginaAtual}
        onPageChange={(_, p) => setPagina(p)}
        rowsPerPage={porPagina}
        rowsPerPageOptions={[25, 50, 100]}
        onRowsPerPageChange={(e) => {
          setPorPagina(Number(e.target.value));
          setPagina(0);
        }}
        labelRowsPerPage="Linhas por página"
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
        getItemAriaLabel={(tipo) =>
          tipo === 'next' ? 'Próxima página' : 'Página anterior'
        }
      />
    </TableContainer>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
};
