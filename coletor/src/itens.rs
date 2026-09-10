//! Itens de uma contratação. É o único lugar da API do PNCP que diz se o
//! objeto é **serviço ou material** e se a disputa é **exclusiva para ME/EPP** —
//! as duas informações que decidem se vale concorrer. Não vem na consulta
//! principal, então custa um request por edital, feito de forma incremental.

use crate::pncp::{self, ItemResumo};
use serde::Deserialize;
use std::error::Error;

// Note o caminho: é /api/pncp/v1, não o /api/consulta/v1 da busca de editais.
const BASE_URL: &str = "https://pncp.gov.br/api/pncp/v1/orgaos";
// ponytail: uma única página de 50 itens, sem paginar — a resposta é um array
// puro, sem envelope com total. Contratação com mais de 50 itens pode ser
// classificada pelo recorte; upgrade é paginar se aparecer caso real.
const TAMANHO_PAGINA: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemApi {
    #[serde(default)]
    descricao: Option<String>,
    #[serde(default)]
    quantidade: Option<f64>,
    #[serde(default)]
    unidade_medida: Option<String>,
    #[serde(default)]
    valor_unitario_estimado: Option<f64>,
    #[serde(default)]
    material_ou_servico_nome: Option<String>,
    #[serde(default)]
    tipo_beneficio_nome: Option<String>,
    #[serde(default)]
    criterio_julgamento_nome: Option<String>,
}

pub struct Enriquecimento {
    pub tipo: String,
    pub beneficio: String,
    pub criterio: String,
    pub itens: Vec<ItemResumo>,
}

/// Sentinela para contratação sem itens publicados. Sem gravar algo, o registro
/// voltaria para a fila de enriquecimento todos os dias, pelos 30 dias em que
/// fica na base.
pub const SEM_ITENS: &str = "não informado";

/// Extrai `cnpj`, `ano` e `sequencial` do link público, que é exatamente
/// `.../editais/{cnpj}/{ano}/{sequencial}` e já vem sem zeros à esquerda.
pub fn coordenadas(link_pncp: &str) -> Option<(String, String, String)> {
    let partes: Vec<&str> = link_pncp.trim_end_matches('/').rsplit('/').take(3).collect();
    // Exigir o formato de verdade, não só "três pedaços": um link truncado
    // viraria request com lixo no lugar do CNPJ.
    match partes.as_slice() {
        [seq, ano, cnpj]
            if cnpj.len() == 14
                && cnpj.bytes().all(|b| b.is_ascii_digit())
                && ano.len() == 4
                && ano.bytes().all(|b| b.is_ascii_digit())
                && !seq.is_empty()
                && seq.bytes().all(|b| b.is_ascii_digit()) =>
        {
            Some((cnpj.to_string(), ano.to_string(), seq.to_string()))
        }
        _ => None,
    }
}

/// "Serviço" e "Material" quando todos os itens concordam, "Misto" quando não.
fn classificar(itens: &[ItemApi]) -> String {
    let mut servico = false;
    let mut material = false;
    for i in itens {
        match i.material_ou_servico_nome.as_deref() {
            Some("Serviço") => servico = true,
            Some("Material") => material = true,
            _ => {}
        }
    }
    match (servico, material) {
        (true, true) => "Misto".to_string(),
        (true, false) => "Serviço".to_string(),
        (false, true) => "Material".to_string(),
        _ => SEM_ITENS.to_string(),
    }
}

pub fn buscar(cnpj: &str, ano: &str, sequencial: &str) -> Result<Enriquecimento, Box<dyn Error>> {
    let url = format!("{BASE_URL}/{cnpj}/compras/{ano}/{sequencial}/itens");
    let http = pncp::chamar(|| {
        pncp::agente()
            .get(&url)
            .query("pagina", "1")
            .query("tamanhoPagina", &TAMANHO_PAGINA.to_string())
    })?;

    // 204 = contratação sem itens publicados. Vale o mesmo sentinela do 404
    // tratado pelo chamador: é resposta definitiva, não falha a repetir.
    if http.status() == 204 {
        return Ok(vazio());
    }

    let itens: Vec<ItemApi> = http.into_json()?;

    Ok(Enriquecimento {
        tipo: classificar(&itens),
        // O benefício ME/EPP é por item; para a tela vale o do primeiro item
        // que declare algo além de "Não se aplica".
        beneficio: itens
            .iter()
            .filter_map(|i| i.tipo_beneficio_nome.clone())
            .find(|b| b != "Não se aplica")
            .unwrap_or_default(),
        criterio: itens
            .iter()
            .filter_map(|i| i.criterio_julgamento_nome.clone())
            .next()
            .unwrap_or_default(),
        itens: itens
            .iter()
            .map(|i| ItemResumo {
                descricao: i.descricao.clone().unwrap_or_default(),
                quantidade: i.quantidade.unwrap_or(0.0),
                unidade: i.unidade_medida.clone().unwrap_or_default(),
                // Mesmo tratamento do valor total: zero aqui é orçamento
                // sigiloso, e a quantidade continua pública.
                valor_unitario: i.valor_unitario_estimado.filter(|v| *v > 0.0),
                tipo: i.material_ou_servico_nome.clone().unwrap_or_default(),
            })
            .collect(),
    })
}

pub fn vazio() -> Enriquecimento {
    Enriquecimento {
        tipo: SEM_ITENS.to_string(),
        beneficio: String::new(),
        criterio: String::new(),
        itens: Vec::new(),
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn item(tipo: &str) -> ItemApi {
        ItemApi {
            descricao: Some("x".into()),
            quantidade: Some(1.0),
            unidade_medida: Some("UN".into()),
            valor_unitario_estimado: Some(10.0),
            material_ou_servico_nome: Some(tipo.into()),
            tipo_beneficio_nome: None,
            criterio_julgamento_nome: None,
        }
    }

    #[test]
    fn classifica_servico_material_e_misto() {
        assert_eq!(classificar(&[item("Serviço")]), "Serviço");
        assert_eq!(classificar(&[item("Material"), item("Material")]), "Material");
        assert_eq!(classificar(&[item("Serviço"), item("Material")]), "Misto");
        assert_eq!(classificar(&[]), SEM_ITENS);
    }

    #[test]
    fn coordenadas_saem_do_link_publico() {
        assert_eq!(
            coordenadas("https://pncp.gov.br/app/editais/46137410000180/2025/589"),
            Some(("46137410000180".into(), "2025".into(), "589".into()))
        );
        assert_eq!(coordenadas("https://pncp.gov.br/app/editais/"), None);
    }
}
