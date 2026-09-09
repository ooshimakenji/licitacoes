//! Cliente da API de consulta do PNCP (contratações com proposta aberta) e
//! normalização para o contrato consumido pela SPA.

use serde::{Deserialize, Serialize};
use std::error::Error;
use std::thread;
use std::time::Duration;

const BASE_URL: &str = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";
const TAMANHO_PAGINA: u32 = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespostaPncp {
    data: Vec<ItemPncp>,
    paginas_restantes: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPncp {
    pub objeto_compra: String,
    pub valor_total_estimado: Option<f64>,
    // Campos que a API às vezes devolve null (ou omite) em dispensa e
    // inexigibilidade: um único item assim derrubaria a página inteira.
    #[serde(default)]
    pub data_abertura_proposta: Option<String>,
    pub data_encerramento_proposta: String,
    pub unidade_orgao: UnidadeOrgao,
    pub orgao_entidade: OrgaoEntidade,
    // "PNCP" vem todo maiúsculo no JSON — não segue camelCase padrão, exige rename explícito.
    #[serde(rename = "numeroControlePNCP")]
    pub numero_controle_pncp: String,
    pub ano_compra: i32,
    pub sequencial_compra: u64,
    pub modalidade_nome: String,
    #[serde(default)]
    pub link_sistema_origem: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnidadeOrgao {
    pub uf_sigla: String,
    pub municipio_nome: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgaoEntidade {
    pub razao_social: String,
    pub cnpj: String,
}

/// Contrato final consumido pela SPA (`web/`). Nomes de campo em snake_case
/// já batem com o JSON esperado, sem necessidade de rename.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Licitacao {
    pub id: String,
    pub objeto: String,
    pub valor: Option<f64>,
    pub uf: String,
    pub municipio: String,
    pub orgao: String,
    pub modalidade: String,
    pub abertura: String,
    pub encerramento: String,
    pub link: String,
    pub link_pncp: String,
    pub visto: String,
}

/// Converte um item bruto da API no contrato da SPA. `visto` fica vazio aqui
/// — quem preenche é o merge no main, que conhece o histórico.
pub fn normalize(item: &ItemPncp) -> Licitacao {
    // Pegadinha: o link usa o sequencial SEM zeros à esquerda, diferente do
    // id (numeroControlePNCP), que mantém o formato original com zeros.
    let link_pncp = format!(
        "https://pncp.gov.br/app/editais/{}/{}/{}",
        item.orgao_entidade.cnpj, item.ano_compra, item.sequencial_compra
    );

    Licitacao {
        id: item.numero_controle_pncp.clone(),
        objeto: item.objeto_compra.clone(),
        valor: item.valor_total_estimado,
        uf: item.unidade_orgao.uf_sigla.clone(),
        municipio: item.unidade_orgao.municipio_nome.clone(),
        orgao: item.orgao_entidade.razao_social.clone(),
        modalidade: item.modalidade_nome.clone(),
        abertura: item.data_abertura_proposta.clone().unwrap_or_default(),
        encerramento: item.data_encerramento_proposta.clone(),
        link: item.link_sistema_origem.clone().unwrap_or_default(),
        link_pncp,
        visto: String::new(),
    }
}

fn data_final(dias_a_frente: i64) -> Result<String, Box<dyn Error>> {
    let hoje = time::OffsetDateTime::now_utc().date();
    let alvo = hoje + time::Duration::days(dias_a_frente);
    let formato = time::macros::format_description!("[year][month][day]");
    Ok(alvo.format(formato)?)
}

/// Busca todas as licitações com proposta aberta para o cruzamento UF ×
/// modalidade. Não aborta em erro parcial: acumula falhas em `erros` e
/// segue para a próxima combinação.
pub fn buscar(ufs: &[String], modalidades: &[u32], dias_a_frente: i64) -> (Vec<Licitacao>, Vec<String>) {
    let mut licitacoes = Vec::new();
    let mut erros = Vec::new();

    let data_final = match data_final(dias_a_frente) {
        Ok(d) => d,
        Err(e) => {
            erros.push(format!("falha ao calcular dataFinal: {e}"));
            return (licitacoes, erros);
        }
    };

    for uf in ufs {
        for &modalidade in modalidades {
            if let Err(e) = buscar_uf_modalidade(uf, modalidade, &data_final, &mut licitacoes) {
                erros.push(format!("uf={uf} modalidade={modalidade}: {e}"));
            }
        }
    }

    (licitacoes, erros)
}

fn buscar_uf_modalidade(
    uf: &str,
    modalidade: u32,
    data_final: &str,
    licitacoes: &mut Vec<Licitacao>,
) -> Result<(), Box<dyn Error>> {
    let mut pagina = 1u32;
    loop {
        let resposta: RespostaPncp = ureq::get(BASE_URL)
            .query("dataFinal", data_final)
            .query("codigoModalidadeContratacao", &modalidade.to_string())
            .query("pagina", &pagina.to_string())
            .query("tamanhoPagina", &TAMANHO_PAGINA.to_string())
            .query("uf", uf)
            .call()?
            .into_json()?;

        licitacoes.extend(resposta.data.iter().map(normalize));

        if resposta.paginas_restantes == 0 {
            break;
        }

        thread::sleep(Duration::from_secs(1));
        pagina += 1;
    }

    Ok(())
}
