# Radar de Licitações

Encontra licitações de pequeno e médio porte no [PNCP](https://pncp.gov.br) filtrando por
valor, região, palavras-chave e modalidade.

**Coletor em Rust** roda no GitHub Actions todo dia útil às 6h (BRT), grava
`web/public/data/licitacoes.json` no repo. **Dashboard React + MUI** lê esse JSON. Sem
servidor, sem banco.

## Uso

```bash
# coletar agora (escreve web/public/data/licitacoes.json)
cargo run --manifest-path coletor/Cargo.toml

# abrir o dashboard
cd web && npm install && npm run dev
```

Filtros de coleta ficam em `config.json`. Os filtros de *visualização* (valor, palavras-chave,
prazo) ficam na própria tela e são salvos no navegador.

| campo | efeito |
|---|---|
| `ufs` | lista vazia = **Brasil inteiro** (o `uf` é opcional na API e omiti-lo troca 27 varreduras por 1) |
| `modalidades` | ids do PNCP (tabela abaixo) |
| `dias_a_frente` | janela de encerramento das propostas |
| `manter_vencidas_por_dias` | quanto tempo um edital encerrado continua na tela como histórico |
| `valor_max` | teto opcional; `null` não filtra. Valor **ausente** nunca reprova — dispensa quase sempre vem sem valor estimado |
| `palavras_chave` | lista opcional; vazia não filtra. Casa contra o objeto, sem diferenciar maiúsculas |

Os dois últimos nascem desligados de propósito: primeiro ver o volume geral, depois cortar.

### Modalidades PNCP

| id | modalidade | | id | modalidade |
|---|---|---|---|---|
| 1 | Leilão - Eletrônico | | 8 | **Dispensa de Licitação** |
| 2 | Diálogo Competitivo | | 9 | **Inexigibilidade** |
| 3 | Concurso | | 10 | Manifestação de Interesse |
| 4 | Concorrência - Eletrônica | | 11 | Pré-qualificação |
| 5 | Concorrência - Presencial | | 12 | Credenciamento |
| 6 | **Pregão - Eletrônico** | | 13 | Leilão - Presencial |
| 7 | Pregão - Presencial | | | |

Em negrito, os coletados por padrão.

## API do PNCP

Documentação de campos, parâmetros, limites e pegadinhas em
[`skills/knowledge/pncp-api.md`](../skills/knowledge/pncp-api.md) (repo `skills`).

## Créditos

A tabela de modalidades e o formato do `numeroControlePNCP` foram conferidos contra
[Licinexus/licinexus-mcp](https://github.com/Licinexus/licinexus-mcp) (MIT).
