import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  Chip,
  Collapse,
  IconButton,
  Link,
  Paper,
  Box,
  Stack,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import Detalhes, { dataTexto } from './Detalhes.jsx';
import { MONO } from './theme.js';

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
function prazoTexto(dias) {
  if (dias == null) return 'prazo não informado';
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

const CABECALHOS = [
  { id: 'prazo', label: 'Prazo', ordenavel: true },
  { id: 'valor', label: 'Valor', ordenavel: true },
  { id: 'local', label: 'Órgão / Município-UF', ordenavel: true },
  { id: 'objeto', label: 'Objeto', ordenavel: false },
  { id: 'links', label: 'Links', ordenavel: false },
  { id: 'triagem', label: 'Triagem', ordenavel: false },
];

export default function Tabela({ rows, triagem, setTriagem, ordem, setOrdem, objetoCompleto }) {
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(25);
  const [aberta, setAberta] = useState(null);

  // Um filtro mais estreito pode encurtar a lista para menos que a página
  // atual. Limitar em vez de zerar: `rows` também muda a cada clique de
  // triagem, e resetar jogaria o usuário de volta ao topo toda vez.
  const ultimaPagina = Math.max(0, Math.ceil(rows.length / porPagina) - 1);
  const paginaAtual = Math.min(pagina, ultimaPagina);
  const visiveis = rows.slice(paginaAtual * porPagina, paginaAtual * porPagina + porPagina);

  const ordenarPor = (coluna) => {
    setOrdem((o) => ({ coluna, desc: o.coluna === coluna ? !o.desc : false }));
    setPagina(0);
  };

  return (
    <TableContainer component={Paper} variant="outlined" tabIndex={0} role="region" aria-label="Licitações">
      <Table sx={{ minWidth: 900 }}>
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Lista de licitações filtradas, {porPagina} por página. Colunas com seta podem ser
          ordenadas; encerradas ficam sempre no fim.
        </caption>
        <TableHead>
          <TableRow>
            <TableCell component="th" scope="col" sx={{ width: 48 }}>
              <Box component="span" sx={visuallyHidden}>Detalhes</Box>
            </TableCell>
            {CABECALHOS.map((c) =>
              c.ordenavel ? (
                <TableCell
                  key={c.id}
                  component="th"
                  scope="col"
                  aria-sort={ordem.coluna === c.id ? (ordem.desc ? 'descending' : 'ascending') : 'none'}
                >
                  <TableSortLabel
                    active={ordem.coluna === c.id}
                    direction={ordem.coluna === c.id && ordem.desc ? 'desc' : 'asc'}
                    onClick={() => ordenarPor(c.id)}
                  >
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ) : (
                <TableCell key={c.id} component="th" scope="col">
                  {c.label}
                </TableCell>
              ),
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {visiveis.map(({ item, dias }) => {
            const critico = dias != null && dias <= 3 && dias >= 0;
            const nova = ehNova(item.visto);
            const estado = triagem[item.id] || null;
            const expandida = aberta === item.id;
            const meEpp = /ME\/EPP/i.test(item.beneficio || '');
            return [
              <TableRow key={item.id} hover>
                <TableCell>
                  <IconButton
                    aria-label={expandida ? 'Ocultar detalhes' : 'Ver detalhes'}
                    aria-expanded={expandida}
                    aria-controls={`detalhes-${item.id}`}
                    onClick={() => setAberta(expandida ? null : item.id)}
                  >
                    {expandida ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                  </IconButton>
                </TableCell>
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
                      {dataTexto(item.encerramento)}
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
                  {item.valor == null ? (
                    <Typography variant="body2" color="text.secondary">
                      não informado
                    </Typography>
                  ) : (
                    <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                      {moeda.format(item.valor)}
                    </Box>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{item.orgao}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {item.municipio}-{item.uf}
                    {item.esfera ? ` · ${item.esfera}` : ''}
                  </Typography>
                </TableCell>
                <TableCell sx={{ maxWidth: objetoCompleto ? 520 : 320 }}>
                  <Tooltip title={objetoCompleto ? '' : item.objeto}>
                    <Typography
                      variant="body2"
                      sx={
                        objetoCompleto
                          ? undefined
                          : {
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }
                      }
                    >
                      {item.objeto}
                    </Typography>
                  </Tooltip>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                    {item.tipo && item.tipo !== 'não informado' && (
                      <Chip label={item.tipo} size="small" variant="outlined" />
                    )}
                    {meEpp && <Chip label="Exclusivo ME/EPP" size="small" color="success" />}
                    {item.srp && <Chip label="Registro de preços" size="small" variant="outlined" />}
                  </Stack>
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
                    onChange={(_, v) => setTriagem((t) => ({ ...t, [item.id]: v }))}
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
              </TableRow>,
              <TableRow key={`${item.id}-detalhes`}>
                <TableCell colSpan={7} sx={{ py: 0, borderBottom: expandida ? undefined : 'none' }}>
                  <Collapse in={expandida} timeout="auto" unmountOnExit>
                    <Box id={`detalhes-${item.id}`}>
                      <Detalhes item={item} />
                    </Box>
                  </Collapse>
                </TableCell>
              </TableRow>,
            ];
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
        getItemAriaLabel={(tipo) => (tipo === 'next' ? 'Próxima página' : 'Página anterior')}
      />
    </TableContainer>
  );
}

function Detalhe({ rotulo, valor }) {
  if (!valor) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {rotulo}
      </Typography>
      <Typography variant="body2">{valor}</Typography>
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
};
