//! Concursos públicos. Diferente das licitações, **não existe PNCP para
//! concurso**: cada órgão publica no seu diário ou site. Medi as alternativas —
//! o PNCP só revela quem terceiriza a banca (58 menções em 13.928 editais, com
//! 2 concursos reais entre 12 inspecionados) e o Querido Diário devolveu
//! nomeação de aprovado, não edital aberto. O PCI Concursos agrega o que
//! interessa e libera acesso automatizado (`robots.txt` com `Allow: /`).

use crate::pncp;
use serde::{Deserialize, Serialize};
use std::error::Error;
use std::thread;
use std::time::{Duration, Instant};

const BASE: &str = "https://www.pciconcursos.com.br/concursos";

/// Cada regional entrega tudo numa página só — confirmei que não há paginação.
const SECOES: [&str; 6] = [
    "nacional",
    "sul",
    "sudeste",
    "centrooeste",
    "nordeste",
    "norte",
];

/// Identificação honesta em vez de fingir ser navegador. Testado: o site
/// responde igual (118 concursos no Sul, mesmo número).
const UA: &str = "RadarLicitacoes/1.0 (+https://github.com/ooshimakenji/licitacoes; uso pessoal)";

/// Abaixo disso a extração é considerada quebrada (layout mudou) e o arquivo
/// anterior é mantido. Medido: 295 na página raiz, 118 no Sul.
const PISO: usize = 50;

const PRAZO_POR_PAGINA: u64 = 60;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Concurso {
    pub id: String,
    pub orgao: String,
    pub uf: String,
    /// Texto, não número: pode ser "31 vagas" ou "Cadastro reserva".
    pub vagas: String,
    pub salario_ate: Option<f64>,
    pub cargos: String,
    pub escolaridade: Vec<String>,
    pub inscricoes: String,
    pub link: String,
    #[serde(default)]
    pub visto: String,

    // Vêm da página de detalhe, buscada só uma vez por concurso. Todos com
    // `default` porque o arquivo de ontem não os tem — regra da casa.
    #[serde(default)]
    pub taxa: String,
    #[serde(default)]
    pub periodo: String,
    #[serde(default)]
    pub tipo_prova: String,
    #[serde(default)]
    pub data_prova: String,
    /// Só quando inequívoca: medi que casar "Objetiva" com o texto pega
    /// "prova objetiva" em 10 de 12 páginas, o que seria informação errada.
    #[serde(default)]
    pub banca: String,
    #[serde(default)]
    pub cargos_detalhe: String,
    #[serde(default)]
    pub resumo: String,
    /// Marca que o detalhe já foi buscado, mesmo que nada tenha sido extraído —
    /// sem isso a página voltaria para a fila todos os dias.
    #[serde(default)]
    pub detalhado: bool,
}

/// Siglas que só existem como nome de banca. "Objetiva" ficou de fora de
/// propósito: casaria com "prova objetiva" e escreveria a banca errada.
const BANCAS: [&str; 18] = [
    "Cebraspe", "CESPE", "FGV", "Vunesp", "IBFC", "Quadrix", "Fundatec", "AOCP",
    "IDECAN", "Consulplan", "IBAM", "FUNDEP", "FUNCERN", "Instituto Tupy",
    "IESES", "FEPESE", "Selecon", "CONSESP",
];

/// Texto máximo do resumo. É o primeiro parágrafo, não a notícia inteira: o
/// arquivo cresce ~7x com os campos novos e não há motivo para guardar tudo.
const MAX_RESUMO: usize = 400;

/// Conteúdo de uma tag pelo atributo de classe, a partir de uma posição.
fn bloco(html: &str, classe: &str) -> Option<String> {
    let marca = format!("class=\"{classe}\">");
    let inicio = html.find(&marca)? + marca.len();
    let resto = &html[inicio..];
    let fim = resto.find("</div>")?;
    Some(resto[..fim].to_string())
}

fn sem_tags(s: &str) -> String {
    let s = &s.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ");
    let mut saida = String::new();
    let mut dentro = false;
    for c in s.chars() {
        match c {
            '<' => dentro = true,
            '>' => dentro = false,
            _ if !dentro => saida.push(c),
            _ => {}
        }
    }
    saida
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// "até R$ 15.471,12" → 15471.12. Formato brasileiro: ponto é milhar.
fn salario(texto: &str) -> Option<f64> {
    let pos = texto.find("R$")? + 2;
    let numero: String = texto[pos..]
        .chars()
        .skip_while(|c| c.is_whitespace())
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    numero.replace('.', "").replace(',', ".").parse().ok()
}

/// O link é a única chave estável. Hash dos campos quebraria na prorrogação de
/// inscrição — o período muda, o hash muda, e o concurso voltaria como NOVA
/// todo dia com a triagem antiga órfã.
fn id_do_link(link: &str) -> String {
    link.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(link)
        .to_string()
}

pub fn extrair(html: &str) -> Vec<Concurso> {
    let mut concursos = Vec::new();

    for pedaco in html.split("class=\"ca\">").skip(1) {
        let Some(link) = pedaco
            .find("href=\"")
            .map(|i| &pedaco[i + 6..])
            .and_then(|r| r.find('"').map(|f| r[..f].to_string()))
        else {
            continue;
        };

        // O nome do órgão é o texto do próprio link.
        let orgao = pedaco
            .find('>')
            .map(|i| &pedaco[i + 1..])
            .and_then(|r| r.find("</a>").map(|f| sem_tags(&r[..f])))
            .unwrap_or_default();

        // Órgão federal não tem UF no site (Transpetro, AgSUS...). Dizer
        // "Nacional" é melhor que deixar em branco, e é o que permite filtrar.
        let uf = match bloco(pedaco, "cc").map(|b| sem_tags(&b)).unwrap_or_default() {
            u if u.is_empty() => "BR".to_string(),
            u => u,
        };
        let detalhes = bloco(pedaco, "cd").unwrap_or_default();
        // Intervalo vem separado por <br> ("14 a<br>28/09/2026"): sem trocar
        // por espaço, o texto sai colado como "14 a28/09/2026".
        let inscricoes = bloco(pedaco, "ce")
            .map(|b| sem_tags(&b.replace("<br>", " ")))
            .unwrap_or_default();

        // O bloco cd traz, separados por <br>: vagas/salário, cargos e níveis.
        let linhas: Vec<String> = detalhes
            .split("<br>")
            .map(sem_tags)
            .filter(|l| !l.is_empty())
            .collect();

        let primeira = linhas.first().cloned().unwrap_or_default();
        let escolaridade = linhas
            .get(2)
            .map(|l| l.split('/').map(|e| e.trim().to_string()).collect())
            .unwrap_or_default();

        if orgao.is_empty() || link.is_empty() {
            continue;
        }

        concursos.push(Concurso {
            id: id_do_link(&link),
            orgao,
            uf,
            vagas: primeira
                .split("até R$")
                .next()
                .unwrap_or(&primeira)
                .trim()
                .to_string(),
            salario_ate: salario(&primeira),
            cargos: linhas.get(1).cloned().unwrap_or_default(),
            escolaridade,
            inscricoes,
            link,
            visto: String::new(),
            // Campos da página de detalhe: preenchidos depois, por `detalhar`.
            ..Default::default()
        });
    }

    concursos
}

/// Remove blocos inteiros (script, style) preservando o resto da página.
fn sem_blocos(html: &str, abre: &str, fecha: &str) -> String {
    let mut saida = String::with_capacity(html.len());
    let mut resto = html;
    while let Some(i) = resto.find(abre) {
        saida.push_str(&resto[..i]);
        resto = match resto[i..].find(fecha) {
            Some(j) => &resto[i + j + fecha.len()..],
            None => "",
        };
    }
    saida.push_str(resto);
    saida
}

/// Recorta uma frase a partir de um gatilho até o primeiro ponto final.
fn frase(texto: &str, gatilhos: &[&str], max: usize) -> String {
    for gatilho in gatilhos {
        let Some(pos) = texto.to_lowercase().find(&gatilho.to_lowercase()) else {
            continue;
        };
        let resto = &texto[pos..];
        // Ponto só encerra a frase quando vem seguido de espaço: sem isso,
        // "pelo site www.fundacao.org.br" era cortado em "pelo site www".
        let bytes = resto.as_bytes();
        let fim = resto
            .char_indices()
            .take(max)
            .find(|(i, c)| {
                *c == '.' && bytes.get(i + 1).map(|b| *b == b' ').unwrap_or(true)
            })
            .map(|(i, _)| i)
            .unwrap_or_else(|| {
                // Sem ponto no trecho: corta em fronteira de caractere, não de
                // byte — acento no limite causaria pânico.
                resto.char_indices().take(max).last().map(|(i, _)| i).unwrap_or(0)
            });
        let recorte = resto[..fim].trim();
        if recorte.len() > gatilho.len() {
            return recorte.to_string();
        }
    }
    String::new()
}

/// Campos que a página de detalhe acrescenta. Medido em 8-12 páginas reais:
/// período 8/8, tipo de prova 8/8, cargos 8/8, taxa 7/8, data da prova 7/12,
/// banca 6/12.
pub fn extrair_detalhe(html: &str) -> Concurso {
    // Remover os blocos de script, não cortar no primeiro: na página real o
    // primeiro <script> vem no byte 4.603 e a notícia só começa no 21.686 —
    // truncar ali descartava exatamente o conteúdo que interessa.
    let texto = sem_tags(&sem_blocos(html, "<script", "</script>").replace("</p>", ". "));

    let banca = BANCAS
        .iter()
        .find(|b| {
            texto
                .to_lowercase()
                .contains(&format!(" {}", b.to_lowercase()))
        })
        .map(|b| b.to_string())
        .unwrap_or_else(|| site_da_organizadora(&texto));

    Concurso {
        taxa: frase(&texto, &["taxa de inscrição", "taxas de inscrição"], 140),
        periodo: frase(
            &texto,
            &["inscrições deverão", "inscrições devem", "inscrições poderão", "inscrições estarão"],
            170,
        ),
        tipo_prova: frase(&texto, &["prova objetiva", "provas objetivas", "prova escrita"], 110),
        data_prova: frase(&texto, &["prevista para", "previstas para", "está prevista"], 90),
        banca,
        cargos_detalhe: frase(&texto, &["cargos de:", "cargo de:", "cargos de", "cargo de"], 300),
        resumo: texto.chars().take(MAX_RESUMO).collect(),
        detalhado: true,
        ..Default::default()
    }
}

/// O domínio onde se inscreve identifica a organizadora quando o nome não
/// aparece. Ignora o próprio PCI e sites .gov do órgão.
fn site_da_organizadora(texto: &str) -> String {
    for marca in [" site ", " portal ", " endereço eletrônico "] {
        let Some(pos) = texto.to_lowercase().find(marca) else {
            continue;
        };
        let resto: String = texto[pos + marca.len()..].chars().take(60).collect();
        let dominio: String = resto
            .trim_start_matches("www.")
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
            .collect();
        if dominio.contains('.')
            && !dominio.contains("pciconcursos")
            && !dominio.contains("gov.br")
            && dominio.len() > 6
        {
            return dominio.trim_end_matches('.').to_string();
        }
    }
    String::new()
}

/// Busca o detalhe de quem ainda não tem, respeitando um teto por execução.
pub fn detalhar(concursos: &mut [Concurso], maximo: usize) {
    let mut feitos = 0;
    for c in concursos.iter_mut() {
        if feitos >= maximo || c.detalhado {
            continue;
        }
        let url = c.link.clone();
        match pncp::chamar(
            || pncp::agente().get(&url).set("User-Agent", UA),
            Instant::now() + Duration::from_secs(PRAZO_POR_PAGINA),
        )
        .and_then(|r| r.into_string().map_err(|e| e.into()))
        {
            Ok(html) => {
                let d = extrair_detalhe(&html);
                c.taxa = d.taxa;
                c.periodo = d.periodo;
                c.tipo_prova = d.tipo_prova;
                c.data_prova = d.data_prova;
                c.banca = d.banca;
                c.cargos_detalhe = d.cargos_detalhe;
                c.resumo = d.resumo;
                c.detalhado = true;
            }
            Err(e) => eprintln!("aviso: detalhe de {}: {e}", c.orgao),
        }
        feitos += 1;
        thread::sleep(Duration::from_millis(1200));
    }
    eprintln!("detalhados: {feitos}");
}

pub fn buscar() -> Result<Vec<Concurso>, Box<dyn Error>> {
    let mut todos: Vec<Concurso> = Vec::new();
    let mut vistos = std::collections::HashSet::new();

    for (i, secao) in SECOES.iter().enumerate() {
        if i > 0 {
            thread::sleep(Duration::from_secs(2));
        }
        let url = format!("{BASE}/{secao}/");
        let resposta = pncp::chamar(
            || pncp::agente().get(&url).set("User-Agent", UA),
            Instant::now() + Duration::from_secs(PRAZO_POR_PAGINA),
        );

        match resposta {
            Ok(r) => {
                let achados = extrair(&r.into_string()?);
                eprintln!("  {secao}: {} concursos", achados.len());
                // O mesmo concurso aparece na regional e na nacional.
                todos.extend(achados.into_iter().filter(|c| vistos.insert(c.id.clone())));
            }
            Err(e) => eprintln!("aviso: seção {secao}: {e}"),
        }
    }

    // Layout mudou ou o site bloqueou: melhor manter o arquivo de ontem do que
    // publicar uma lista vazia que apagaria a triagem da tela.
    if todos.len() < PISO {
        return Err(format!(
            "apenas {} concursos extraídos (piso {PISO}) — o layout do PCI pode ter mudado",
            todos.len()
        )
        .into());
    }

    Ok(todos)
}

/// Preserva o `visto` de quem já era conhecido, para o chip NOVA valer. Como o
/// id vem do link, prorrogação de inscrição não reinicia nada.
pub fn merge(novos: Vec<Concurso>, anteriores: &[Concurso], hoje: &str) -> Vec<Concurso> {
    let conhecidos: std::collections::HashMap<&str, &Concurso> =
        anteriores.iter().map(|c| (c.id.as_str(), c)).collect();

    novos
        .into_iter()
        .map(|mut c| {
            match conhecidos.get(c.id.as_str()) {
                Some(antes) => {
                    c.visto = antes.visto.clone();
                    // O detalhe custa um request por concurso: sem preservar
                    // aqui, os 547 seriam rebuscados todo dia.
                    if antes.detalhado {
                        c.taxa = antes.taxa.clone();
                        c.periodo = antes.periodo.clone();
                        c.tipo_prova = antes.tipo_prova.clone();
                        c.data_prova = antes.data_prova.clone();
                        c.banca = antes.banca.clone();
                        c.cargos_detalhe = antes.cargos_detalhe.clone();
                        c.resumo = antes.resumo.clone();
                        c.detalhado = true;
                    }
                }
                None => c.visto = hoje.to_string(),
            }
            c
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn extrai_os_campos_da_fixture() {
        let achados = extrair(include_str!("../tests/pci.html"));
        assert_eq!(achados.len(), 12);

        let cisop = &achados[0];
        assert!(cisop.orgao.starts_with("CISOP"));
        assert_eq!(cisop.uf, "PR");
        assert_eq!(cisop.vagas, "31 vagas");
        assert_eq!(cisop.salario_ate, Some(15471.12));
        assert_eq!(cisop.cargos, "Vários Cargos");
        assert_eq!(cisop.escolaridade.len(), 4);
        assert_eq!(cisop.inscricoes, "21/09/2026");
        assert!(cisop.id.contains("cisop"));

        // Todo registro precisa de id e órgão, senão não dá para triar nem
        // deduplicar entre as seções.
        assert!(achados.iter().all(|c| !c.id.is_empty() && !c.orgao.is_empty()));
    }

    #[test]
    fn cadastro_reserva_nao_vira_numero() {
        let achados = extrair(include_str!("../tests/pci.html"));
        let reserva = achados.iter().find(|c| c.vagas.contains("Cadastro"));
        if let Some(c) = reserva {
            assert!(c.salario_ate.is_some(), "reserva ainda informa salário");
        }
    }

    #[test]
    fn id_sobrevive_a_prorrogacao_de_inscricao() {
        let antes = Concurso {
            id: id_do_link("https://www.pciconcursos.com.br/noticias/prefeitura-de-castro-pr"),
            inscricoes: "24/09/2026".into(),
            visto: "2026-09-01".into(),
            ..Default::default()
        };
        let depois = Concurso {
            inscricoes: "10/10/2026".into(), // prorrogou
            visto: String::new(),
            ..antes.clone()
        };

        let resultado = merge(vec![depois], &[antes], "2026-09-12");

        // Se o id mudasse a cada prorrogação, o concurso voltaria como NOVA
        // todo dia e a triagem ficaria órfã.
        assert_eq!(resultado[0].visto, "2026-09-01");
    }


    #[test]
    fn extrai_o_detalhe_da_fixture() {
        let d = extrair_detalhe(include_str!("../tests/pci_detalhe.html"));

        // Medido em 8 páginas reais: período e tipo de prova saem em 8/8.
        assert!(d.periodo.contains("inscrições"), "período: {:?}", d.periodo);
        assert!(
            d.periodo.contains("agosto") || d.periodo.contains("setembro"),
            "o período precisa trazer as datas: {:?}",
            d.periodo
        );
        assert!(d.tipo_prova.to_lowercase().contains("objetiva"), "prova: {:?}", d.tipo_prova);
        assert!(!d.resumo.is_empty());
        assert!(d.resumo.chars().count() <= MAX_RESUMO);
        assert!(d.detalhado);
    }

    #[test]
    fn banca_nao_confunde_prova_objetiva_com_a_banca_objetiva() {
        // Este é o teste que trava o falso positivo que eu quase publiquei:
        // a primeira regra dava "11/12 de acerto" casando com a palavra
        // "objetiva" de "prova objetiva". O acerto real era 6/12.
        let html = "<p>A seleção terá prova objetiva de caráter eliminatório.</p>";
        assert_eq!(extrair_detalhe(html).banca, "");
    }

    #[test]
    fn banca_sai_do_nome_conhecido_ou_do_site_de_inscricao() {
        let com_nome = "<p>A organização está a cargo do IBAM, que divulgará o edital.</p>";
        assert_eq!(extrair_detalhe(com_nome).banca, "IBAM");

        let com_site = "<p>As inscrições devem ser feitas no site institutotupy.com.br até a data.</p>";
        assert_eq!(extrair_detalhe(com_site).banca, "institutotupy.com.br");

        // O próprio PCI e o site do órgão não são a banca.
        let sem_banca = "<p>Confira no site pciconcursos.com.br os detalhes.</p>";
        assert_eq!(extrair_detalhe(sem_banca).banca, "");
    }

    #[test]
    fn detalhe_sobrevive_ao_merge_para_nao_refazer_547_requests() {
        let mut antes = Concurso {
            id: "x".into(),
            visto: "2026-09-01".into(),
            taxa: "R$ 150,00".into(),
            banca: "IBAM".into(),
            detalhado: true,
            ..Default::default()
        };
        antes.periodo = "de 01 a 30 de outubro".into();

        // Recém-coletado da listagem: não tem nada do detalhe.
        let novo = Concurso { id: "x".into(), ..Default::default() };

        let r = merge(vec![novo], &[antes], "2026-09-12");

        assert_eq!(r[0].taxa, "R$ 150,00", "sem isso os 547 seriam rebuscados todo dia");
        assert_eq!(r[0].banca, "IBAM");
        assert!(r[0].detalhado);
        assert_eq!(r[0].visto, "2026-09-01");
    }

    #[test]
    fn pagina_sem_os_campos_nao_inventa_dados() {
        let d = extrair_detalhe("<p>Texto curto sem informação útil.</p>");
        assert_eq!(d.taxa, "");
        assert_eq!(d.periodo, "");
        assert_eq!(d.data_prova, "");
        // Mas marca como visitada, senão volta para a fila todo dia.
        assert!(d.detalhado);
    }

    #[test]
    fn html_quebrado_nao_vira_lista_vazia_silenciosa() {
        assert!(extrair("<html>site mudou</html>").is_empty());
    }
}
