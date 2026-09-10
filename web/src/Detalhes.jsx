import { useEffect, useState } from 'react';
import { Box, Typography, Skeleton } from '@mui/material';
import { MONO } from './theme.js';
import { carregarItens } from './dados.js';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataCurta = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function dataTexto(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataCurta.format(d);
}

/// Detalhes de um edital. Mesmo conteúdo na tabela (linha expansível) e no
/// card do celular — um componente só para as duas telas não divergirem.
export default function Detalhes({ item }) {
  // Os itens não vêm no {UF}.json: são buscados na primeira vez que uma linha
  // daquela UF é expandida. Como este componente só monta ao expandir, o efeito
  // aqui é exatamente "sob demanda".
  const [itens, setItens] = useState(item.itens?.length ? item.itens : null);

  useEffect(() => {
    if (itens || !item.uf) return;
    let vivo = true;
    carregarItens(item.uf).then((mapa) => {
      if (vivo) setItens(mapa[item.id] || []);
    });
    return () => {
      vivo = false;
    };
  }, [item.id, item.uf, itens]);

  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Objeto completo
      </Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {item.objeto}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: '1fr 1fr 1fr' },
          gap: 1.5,
          mb: 2,
        }}
      >
        <Campo rotulo="Unidade" valor={item.unidade} />
        <Campo rotulo="Modalidade" valor={item.modalidade} />
        <Campo rotulo="Situação" valor={item.situacao} />
        <Campo rotulo="Modo de disputa" valor={item.disputa} />
        <Campo rotulo="Critério" valor={item.criterio} />
        <Campo rotulo="Base legal" valor={item.amparo} />
        <Campo rotulo="Benefício" valor={item.beneficio} />
        <Campo rotulo="Abertura" valor={dataTexto(item.abertura)} mono />
        <Campo rotulo="Publicado" valor={dataTexto(item.publicado)} mono />
      </Box>

      {itens === null && <Skeleton variant="rounded" height={64} />}

      {itens?.length > 0 && (
        <>
          <Typography variant="subtitle2" gutterBottom>
            Itens ({itens.length})
          </Typography>
          {/* Em edital com orçamento sigiloso o preço vem zerado, mas a
              quantidade continua pública — é o que dá noção de porte. */}
          {item.valor == null && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Orçamento sigiloso: a quantidade é pública, o preço não.
            </Typography>
          )}
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {itens.map((it, i) => (
              <li key={i}>
                <Typography variant="body2">
                  {it.descricao}
                  <Box component="span" sx={{ fontFamily: MONO, whiteSpace: 'nowrap' }}>
                    {' '}
                    — {it.quantidade} {it.unidade}
                    {it.valor_unitario != null ? ` · ${moeda.format(it.valor_unitario)}/un` : ''}
                  </Box>
                </Typography>
              </li>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

function Campo({ rotulo, valor, mono }) {
  if (!valor || valor === '—') return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {rotulo}
      </Typography>
      <Typography variant="body2" sx={mono ? { fontFamily: MONO } : undefined}>
        {valor}
      </Typography>
    </Box>
  );
}
