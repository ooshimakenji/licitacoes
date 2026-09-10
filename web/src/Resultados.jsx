import { useMediaQuery, useTheme } from '@mui/material';
import Tabela from './Tabela.jsx';
import Cards from './Cards.jsx';

/// Tabela no desktop, cards no celular. A tabela tem `minWidth: 900` — em tela
/// estreita ela rolaria de lado, que é o pior jeito de ler esta informação:
/// você precisa comparar prazo e valor, e nenhum dos dois cabe junto.
export default function Resultados(props) {
  const tema = useTheme();
  const estreito = useMediaQuery(tema.breakpoints.down('md'));

  return estreito ? <Cards {...props} /> : <Tabela {...props} />;
}
