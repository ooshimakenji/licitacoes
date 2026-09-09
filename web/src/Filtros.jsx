import {
  Autocomplete,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Button,
  Stack,
  Box,
  Typography,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';

export default function Filtros({
  ufsDisponiveis,
  modalidadesDisponiveis,
  filtros,
  setFiltros,
  onLimpar,
}) {
  const set = (campo) => (valor) =>
    setFiltros((f) => ({ ...f, [campo]: valor }));

  return (
    <Box
      component="fieldset"
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2,
        m: 0,
        mb: 3,
      }}
    >
      <Typography component="legend" variant="h2" sx={{ fontSize: '1.1rem', px: 1 }}>
        Filtros
      </Typography>

      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Autocomplete
            multiple
            options={ufsDisponiveis}
            value={filtros.ufs}
            onChange={(_, v) => set('ufs')(v)}
            sx={{ flex: 1, minWidth: 200 }}
            renderInput={(params) => (
              <TextField {...params} label="UF" placeholder="Todas" />
            )}
          />
          <Autocomplete
            multiple
            options={modalidadesDisponiveis}
            value={filtros.modalidades}
            onChange={(_, v) => set('modalidades')(v)}
            sx={{ flex: 1, minWidth: 200 }}
            renderInput={(params) => (
              <TextField {...params} label="Modalidade" placeholder="Todas" />
            )}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Valor mínimo (R$)"
            type="number"
            value={filtros.valorMin}
            onChange={(e) => set('valorMin')(e.target.value)}
            sx={{ flex: 1 }}
            inputProps={{ min: 0 }}
          />
          <TextField
            label="Valor máximo (R$)"
            type="number"
            value={filtros.valorMax}
            onChange={(e) => set('valorMax')(e.target.value)}
            sx={{ flex: 1 }}
            inputProps={{ min: 0 }}
          />
          <TextField
            label="Encerra em até (dias)"
            type="number"
            value={filtros.diasMax}
            onChange={(e) => set('diasMax')(e.target.value)}
            sx={{ flex: 1 }}
            inputProps={{ min: 0 }}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Incluir palavras-chave (separadas por vírgula)"
            value={filtros.incluir}
            onChange={(e) => set('incluir')(e.target.value)}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Excluir palavras-chave (separadas por vírgula)"
            value={filtros.excluir}
            onChange={(e) => set('excluir')(e.target.value)}
            sx={{ flex: 1 }}
          />
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
        >
          <Box role="group" aria-label="Filtro rápido de triagem">
            <ToggleButtonGroup
              value={filtros.triagemView}
              exclusive
              onChange={(_, v) => v && set('triagemView')(v)}
              aria-label="Filtro rápido de triagem"
              size="small"
            >
              <ToggleButton value="todas" sx={{ minHeight: 44, px: 2 }}>
                Todas
              </ToggleButton>
              <ToggleButton value="so-interessa" sx={{ minHeight: 44, px: 2 }}>
                Só interessa
              </ToggleButton>
              <ToggleButton value="ocultar-descartadas" sx={{ minHeight: 44, px: 2 }}>
                Ocultar descartadas
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Button
            onClick={onLimpar}
            startIcon={<ClearIcon />}
            variant="outlined"
            sx={{ minHeight: 44 }}
          >
            Limpar filtros
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
