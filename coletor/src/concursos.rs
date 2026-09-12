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
}

/// Conteúdo de uma tag pelo atributo de classe, a partir de uma posição.
fn bloco(html: &str, classe: &str) -> Option<String> {
    let marca = format!("class=\"{classe}\">");
    let inicio = html.find(&marca)? + marca.len();
    let resto = &html[inicio..];
    let fim = resto.find("</div>")?;
    Some(resto[..fim].to_string())
}

fn sem_tags(s: &str) -> String {
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
        });
    }

    concursos
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
    let conhecidos: std::collections::HashMap<&str, &str> = anteriores
        .iter()
        .map(|c| (c.id.as_str(), c.visto.as_str()))
        .collect();

    novos
        .into_iter()
        .map(|mut c| {
            c.visto = conhecidos
                .get(c.id.as_str())
                .map(|v| v.to_string())
                .unwrap_or_else(|| hoje.to_string());
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
    fn html_quebrado_nao_vira_lista_vazia_silenciosa() {
        assert!(extrair("<html>site mudou</html>").is_empty());
    }
}
