import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
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
  return (
    // tabIndex torna a área rolável alcançável só pelo teclado (WCAG 2.1.1),
    // já que a tabela tem minWidth 900 e rola na horizontal.
    <TableContainer component={Paper} variant="outlined" tabIndex={0} role="region" aria-label="Licitações">
      <Table sx={{ minWidth: 900 }}>
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Lista de licitações filtradas, ordenadas por prazo de encerramento crescente.
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
          {rows.map(({ item, dias }) => {
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
