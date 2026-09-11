import { useState } from 'react';
import {
  Autocomplete,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Button,
  Stack,
  Box,
  Typography,
  Chip,
  FormControlLabel,
  Checkbox,
  IconButton,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { AREAS, NOMES_REGIOES } from './areas.js';

export default function Filtros({
  semMoldura = false,
  ufsDisponiveis,
  modalidadesDisponiveis,
  municipiosDisponiveis,
  filtros,
  setFiltros,
  onLimpar,
  buscas,
  onSalvarBusca,
  onExcluirBusca,
}) {
  const [nomeBusca, setNomeBusca] = useState('');
  const set = (campo) => (valor) => setFiltros((f) => ({ ...f, [campo]: valor }));

  const alternarArea = (area) =>
    setFiltros((f) => ({
      ...f,
      areas: f.areas.includes(area)
        ? f.areas.filter((a) => a !== area)
        : [...f.areas, area],
    }));

  return (
    <Box
      component="fieldset"
      sx={{
        border: semMoldura ? 'none' : '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: semMoldura ? 0 : 2,
        m: 0,
        mb: semMoldura ? 1 : 3,
      }}
    >
      <Typography
        component="legend"
        variant="h2"
        sx={{ fontSize: '1.1rem', px: semMoldura ? 0 : 1, mb: semMoldura ? 1 : 0 }}
      >
        Filtros
      </Typography>

      <Stack spacing={2}>
        {/* Área é o primeiro filtro porque é como se procura de verdade:
            "quero serviços de engenharia", não "quero a palavra pavimentação". */}
        <Box role="group" aria-label="Filtrar por área">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Área
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {Object.keys(AREAS).map((area) => {
              const ativa = filtros.areas.includes(area);
              return (
                <Chip
                  key={area}
                  label={area}
                  onClick={() => alternarArea(area)}
                  color={ativa ? 'primary' : 'default'}
                  variant={ativa ? 'filled' : 'outlined'}
                  aria-pressed={ativa}
                  sx={{ minHeight: 44, fontSize: '0.9rem' }}
                />
              );
            })}
          </Stack>
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box role="group" aria-label="Serviço ou material">
            <ToggleButtonGroup
              value={filtros.tipo}
              exclusive
              onChange={(_, v) => v && set('tipo')(v)}
              aria-label="Serviço ou material"
              size="small"
            >
              <ToggleButton value="todos" sx={{ minHeight: 44, px: 2 }}>
                Todos
              </ToggleButton>
              <ToggleButton value="Serviço" sx={{ minHeight: 44, px: 2 }}>
                Serviços
              </ToggleButton>
              <ToggleButton value="Material" sx={{ minHeight: 44, px: 2 }}>
                Materiais
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <FormControlLabel
            control={
              <Checkbox
                checked={filtros.soMeEpp}
                onChange={(e) => set('soMeEpp')(e.target.checked)}
              />
            }
            label="Só exclusivo ME/EPP"
          />
          <FormControlLabel
            control={
              <Checkbox checked={filtros.soSrp} onChange={(e) => set('soSrp')(e.target.checked)} />
            }
            label="Só registro de preços"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={filtros.soNovas}
                onChange={(e) => set('soNovas')(e.target.checked)}
              />
            }
            label="Publicados nas últimas 24h"
          />
        </Stack>

        {/* Por padrão a tela mostra o que dá para disputar. O histórico é o
            que enxerga a dispensa que abriu e fechou entre duas coletas. */}
        <FormControlLabel
          control={
            <Checkbox
              checked={filtros.incluirHistorico}
              onChange={(e) => set('incluirHistorico')(e.target.checked)}
            />
          }
          label="Incluir histórico (editais já encerrados, para pesquisar preço praticado)"
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Autocomplete
            multiple
            options={NOMES_REGIOES}
            value={filtros.regioes}
            onChange={(_, v) => set('regioes')(v)}
            sx={{ flex: 1, minWidth: 180 }}
            renderInput={(params) => (
              <TextField {...params} label="Região" placeholder="Todas" />
            )}
          />
          <Autocomplete
            multiple
            options={ufsDisponiveis}
            value={filtros.ufs}
            onChange={(_, v) => set('ufs')(v)}
            sx={{ flex: 1, minWidth: 140 }}
            renderInput={(params) => <TextField {...params} label="UF" placeholder="Todas" />}
          />
          <Autocomplete
            multiple
            options={municipiosDisponiveis}
            value={filtros.municipios}
            onChange={(_, v) => set('municipios')(v)}
            sx={{ flex: 2, minWidth: 200 }}
            renderInput={(params) => (
              <TextField {...params} label="Município" placeholder="Todos" />
            )}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
          <Autocomplete
            multiple
            options={['Municipal', 'Estadual', 'Federal']}
            value={filtros.esferas}
            onChange={(_, v) => set('esferas')(v)}
            sx={{ flex: 1, minWidth: 180 }}
            renderInput={(params) => (
              <TextField {...params} label="Esfera" placeholder="Todas" />
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

        {/* Sem isso, filtrar por valor esconderia os ~8% de editais com
            orçamento sigiloso, que são justamente candidatos legítimos. */}
        <FormControlLabel
          control={
            <Checkbox
              checked={filtros.incluirSemValor}
              onChange={(e) => set('incluirSemValor')(e.target.checked)}
            />
          }
          label="Incluir editais sem valor informado (orçamento sigiloso) ao filtrar por valor"
        />

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

          <Stack direction="row" spacing={2} alignItems="center">
            <FormControlLabel
              control={
                <Checkbox
                  checked={filtros.objetoCompleto}
                  onChange={(e) => set('objetoCompleto')(e.target.checked)}
                />
              }
              label="Objeto completo"
            />
            <Button onClick={onLimpar} startIcon={<ClearIcon />} variant="outlined" sx={{ minHeight: 44 }}>
              Limpar filtros
            </Button>
          </Stack>
        </Stack>

        {/* Buscas salvas: guarda o conjunto inteiro de filtros com um nome, que
            é como "engenharia do jeito que eu procuro" volta em um clique. */}
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <TextField
              label="Salvar esta busca como"
              size="small"
              value={nomeBusca}
              onChange={(e) => setNomeBusca(e.target.value)}
              sx={{ maxWidth: 280 }}
            />
            <Button
              onClick={() => {
                if (!nomeBusca.trim()) return;
                onSalvarBusca(nomeBusca.trim());
                setNomeBusca('');
              }}
              startIcon={<BookmarkAddIcon />}
              variant="outlined"
              sx={{ minHeight: 44 }}
            >
              Salvar
            </Button>
          </Stack>
          {buscas.length > 0 && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }} role="group" aria-label="Buscas salvas">
              {buscas.map((b) => (
                <Chip
                  key={b.nome}
                  label={b.nome}
                  onClick={() => setFiltros(b.filtros)}
                  onDelete={() => onExcluirBusca(b.nome)}
                  deleteIcon={
                    <IconButton size="small" aria-label={`Excluir busca ${b.nome}`}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  }
                  variant="outlined"
                  sx={{ minHeight: 44 }}
                />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
}
