import { createTheme } from '@mui/material/styles';

// Paleta MD3 própria — NÃO usar as cores default do MUI (#1976d2 sobre branco
// dá 4.6:1, reprova em AAA). Contraste calculado com a fórmula de luminância
// relativa da WCAG (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance),
// script em scratchpad/contrast.js. Todos os pares abaixo ficam >= 7:1 para
// texto normal (AAA 1.4.6) ou >= 4.5:1 quando é só ícone/borda grande.

const bg = '#F5F7FA'; // fundo padrão da página
const paper = '#FFFFFF'; // fundo de cartões/tabela

/// Face dos números: prazo, valor, data e nº de processo. Algarismo de largura
/// fixa é o que permite comparar valores de olho, descendo a lista.
export const MONO = '"IBM Plex Mono", ui-monospace, "Cascadia Mono", monospace';

/// Altura mínima de alvo no toque. A AAA pede 44 (2.5.5) e o Material 3
/// recomenda 48 — no celular vale o maior dos dois.
export const ALVO_TOQUE = 48;

export const theme = createTheme({
  palette: {
    background: { default: bg, paper },
    primary: {
      // #0B4F6C sobre #FFFFFF = 8.94:1 · sobre #F5F7FA = 8.33:1 (ambos >7:1)
      main: '#0B4F6C',
      contrastText: '#FFFFFF', // branco sobre #0B4F6C = 8.94:1
    },
    text: {
      primary: '#1A1C1E', // sobre #FFFFFF = 17.09:1
      secondary: '#3A4750', // sobre #FFFFFF = 9.56:1 (pedido: secondary >= 7:1)
    },
    error: {
      // "Descartei" — #7A0C1E sobre #FFFFFF = 11.06:1
      main: '#7A0C1E',
    },
    success: {
      // "Interessa" — #0F5C2E sobre #FFFFFF = 8.11:1
      main: '#0F5C2E',
    },
    warning: {
      // prazo crítico — #7A4A00 sobre #FFFFFF = 7.48:1
      main: '#7A4A00',
    },
    divider: '#C6CCD1', // borda decorativa, não carrega estado sozinha
  },
  shape: { borderRadius: 8 },
  typography: {
    // IBM Plex: o vocabulário desta tela é protocolo, número de processo e
    // valor unitário. O Mono entra só nos números (prazo, dinheiro, datas),
    // onde algarismo de largura fixa faz a coluna ficar legível na varredura.
    fontFamily: '"IBM Plex Sans", "Segoe UI", Roboto, Arial, sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // AAA 2.4.7 foco visível: outline 3px, deslocado para cair sobre o
        // fundo claro ao redor do elemento (funciona atrás de botões
        // escuros também, já que o outline nasce fora da caixa).
        '*:focus-visible': {
          outline: '3px solid #0B4F6C', // contraste vs #FFFFFF/#F5F7FA = 8.94:1 / 8.33:1
          outlineOffset: '2px',
        },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.001ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.001ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: false },
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44, // AAA 2.5.5 alvo de toque
          // O ButtonBase do MUI aplica `outline: 0` com a mesma especificidade
          // da regra global do CssBaseline e vence pela ordem de inserção do
          // Emotion — sem repetir aqui, botão nenhum teria foco visível.
          '&:focus-visible': { outline: '3px solid #0B4F6C', outlineOffset: 2 },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: 44, minHeight: 44 } },
    },
    MuiAutocomplete: {
      styleOverrides: {
        // Os indicadores do Autocomplete são IconButton: com 44px cada eles
        // estouram o espaço reservado (65px) e cobrem os chips selecionados.
        clearIndicator: { minWidth: 'auto', minHeight: 'auto' },
        popupIndicator: { minWidth: 'auto', minHeight: 'auto' },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        // Default do MUI é rgba(0,0,0,0.23) = 1.74:1, reprova em 1.4.11
        // (contorno de componente precisa de 3:1). #6B7480 = 4.6:1.
        notchedOutline: { borderColor: '#6B7480' },
        // 16px é o mínimo que o iOS aceita sem dar zoom automático no campo
        // ao focar — abaixo disso a página inteira salta a cada toque.
        input: { fontSize: 16 },
      },
    },
    MuiChip: {
      styleOverrides: {
        // Chip é alvo de toque nesta tela (áreas, buscas salvas), não enfeite.
        root: { '@media (pointer: coarse)': { minHeight: ALVO_TOQUE } },
      },
    },
  },
});
