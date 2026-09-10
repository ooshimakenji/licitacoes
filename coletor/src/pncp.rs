//! Cliente da API de consulta do PNCP (contratações com proposta aberta) e
//! normalização para o contrato consumido pela SPA.

use serde::{Deserialize, Serialize};
use std::error::Error;
use std::thread;
use std::time::{Duration, Instant};

const BASE_URL: &str = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";
// O manual do PNCP diz máximo 500, mas a API real responde 400 "Tamanho de
// página inválido" acima de 50 (testado em 09/09/2026: 51 já reprova).
const TAMANHO_PAGINA: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespostaPncp {
    data: Vec<ItemPncp>,
    paginas_restantes: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPncp {
    // Todo texto vindo da API é Option: a desserialização é da página inteira,
    // então um único campo null derrubaria os outros 49 registros junto.
    #[serde(default)]
    pub objeto_compra: Option<String>,
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
    #[serde(default)]
    pub modalidade_nome: Option<String>,
    #[serde(default)]
    pub link_sistema_origem: Option<String>,
    // Campos que a consulta já devolve de graça e antes eram jogados fora.
    #[serde(default)]
    pub srp: Option<bool>,
    #[serde(default)]
    pub modalidade_id: Option<u32>,
    #[serde(default)]
    pub modo_disputa_nome: Option<String>,
    #[serde(default)]
    pub situacao_compra_nome: Option<String>,
    #[serde(default)]
    pub data_publicacao_pncp: Option<String>,
    #[serde(default)]
    pub amparo_legal: Option<AmparoLegal>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AmparoLegal {
    #[serde(default)]
    pub nome: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnidadeOrgao {
    #[serde(default)]
    pub uf_sigla: Option<String>,
    #[serde(default)]
    pub municipio_nome: Option<String>,
    // Qual secretaria pediu a compra, e o código IBGE (base do mapa e do
    // "perto de mim" calculado no navegador).
    #[serde(default)]
    pub nome_unidade: Option<String>,
    // O PNCP manda esse código às vezes como texto ("3506003"), às vezes como
    // número — Value aceita os dois em vez de derrubar a página inteira.
    #[serde(default)]
    pub codigo_ibge: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgaoEntidade {
    #[serde(default)]
    pub razao_social: Option<String>,
    #[serde(default)]
    pub cnpj: Option<String>,
    // "M"/"E"/"F" — municipal, estadual ou federal.
    #[serde(default)]
    pub esfera_id: Option<String>,
}

/// Contrato final consumido pela SPA (`web/`). Nomes de campo em snake_case
/// já batem com o JSON esperado, sem necessidade de rename.
///
/// **Todo campo novo precisa de `#[serde(default)]`**: o `main` trata JSON
/// anterior ilegível como erro fatal de propósito, e a primeira execução após
/// um campo novo lê o arquivo de ontem, que ainda não o tem.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    #[serde(default)]
    pub srp: bool,
    #[serde(default)]
    pub esfera: String,
    #[serde(default)]
    pub unidade: String,
    #[serde(default)]
    pub ibge: String,
    #[serde(default)]
    pub publicado: String,
    #[serde(default)]
    pub disputa: String,
    #[serde(default)]
    pub situacao: String,
    #[serde(default)]
    pub amparo: String,
    #[serde(default)]
    pub modalidade_id: Option<u32>,
    // Preenchidos pelo módulo `itens` (não vêm na consulta principal) e
    // preservados pelo merge, que é o que torna o enriquecimento incremental.
    #[serde(default)]
    pub tipo: String,
    #[serde(default)]
    pub beneficio: String,
    #[serde(default)]
    pub criterio: String,
    #[serde(default)]
    pub itens: Vec<ItemResumo>,
}

/// O que interessa de cada item para a tela: em edital com orçamento sigiloso,
/// descrição e quantidade continuam públicas mesmo com o valor zerado.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemResumo {
    pub descricao: String,
    pub quantidade: f64,
    pub unidade: String,
    pub valor_unitario: Option<f64>,
    pub tipo: String,
}

/// Converte um item bruto da API no contrato da SPA. `visto` fica vazio aqui
/// — quem preenche é o merge no main, que conhece o histórico.
pub fn normalize(item: &ItemPncp) -> Licitacao {
    // Pegadinha: o link usa o sequencial SEM zeros à esquerda, diferente do
    // id (numeroControlePNCP), que mantém o formato original com zeros.
    let cnpj = item.orgao_entidade.cnpj.clone().unwrap_or_default();
    let link_pncp = format!(
        "https://pncp.gov.br/app/editais/{}/{}/{}",
        cnpj, item.ano_compra, item.sequencial_compra
    );

    Licitacao {
        id: item.numero_controle_pncp.clone(),
        objeto: item.objeto_compra.clone().unwrap_or_default(),
        // Valor 0 significa orçamento sigiloso/não informado, não R$ 0 — tratar
        // como número faria a tela exibir "R$ 0,00" e o filtro de valor
        // descartar 7,7% dos editais em silêncio.
        valor: item.valor_total_estimado.filter(|v| *v > 0.0),
        uf: item.unidade_orgao.uf_sigla.clone().unwrap_or_default(),
        municipio: item.unidade_orgao.municipio_nome.clone().unwrap_or_default(),
        orgao: item.orgao_entidade.razao_social.clone().unwrap_or_default(),
        modalidade: item.modalidade_nome.clone().unwrap_or_default(),
        abertura: item.data_abertura_proposta.clone().unwrap_or_default(),
        encerramento: item.data_encerramento_proposta.clone(),
        link: item.link_sistema_origem.clone().unwrap_or_default(),
        link_pncp,
        visto: String::new(),
        srp: item.srp.unwrap_or(false),
        esfera: match item.orgao_entidade.esfera_id.as_deref() {
            Some("M") => "Municipal".to_string(),
            Some("E") => "Estadual".to_string(),
            Some("F") => "Federal".to_string(),
            outro => outro.unwrap_or_default().to_string(),
        },
        unidade: item.unidade_orgao.nome_unidade.clone().unwrap_or_default(),
        ibge: match &item.unidade_orgao.codigo_ibge {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Number(n)) => n.to_string(),
            _ => String::new(),
        },
        publicado: item.data_publicacao_pncp.clone().unwrap_or_default(),
        disputa: item.modo_disputa_nome.clone().unwrap_or_default(),
        situacao: item.situacao_compra_nome.clone().unwrap_or_default(),
        amparo: item
            .amparo_legal
            .as_ref()
            .and_then(|a| a.nome.clone())
            .unwrap_or_default(),
        modalidade_id: item.modalidade_id,
        tipo: String::new(),
        beneficio: String::new(),
        criterio: String::new(),
        itens: Vec::new(),
    }
}

/// Filtro opcional da coleta (`valor_max` e `palavras_chave` no `config.json`).
/// Nasce desligado — teto ausente e lista vazia deixam tudo passar.
pub fn interessa(lic: &Licitacao, valor_max: Option<f64>, palavras: &[String]) -> bool {
    // Valor ausente não reprova: dispensa costuma vir sem valor estimado e
    // descartar por isso jogaria fora justamente o edital pequeno.
    if let (Some(teto), Some(valor)) = (valor_max, lic.valor) {
        if valor > teto {
            return false;
        }
    }

    if palavras.is_empty() {
        return true;
    }

    // ponytail: comparação sem normalizar acento — "residuo" não casa "resíduo".
    // Upgrade: normalização Unicode se aparecer falso-negativo real na tela.
    let objeto = lic.objeto.to_lowercase();
    palavras
        .iter()
        .any(|p| !p.trim().is_empty() && objeto.contains(p.trim().to_lowercase().as_str()))
}

fn data_final(dias_a_frente: i64) -> Result<String, Box<dyn Error>> {
    let hoje = time::OffsetDateTime::now_utc().date();
    let alvo = hoje + time::Duration::days(dias_a_frente);
    let formato = time::macros::format_description!("[year][month][day]");
    Ok(alvo.format(formato)?)
}

/// Uma combinação UF × modalidade que não pôde ser coletada. Guardar os campos
/// em vez da frase pronta é o que permite repetir só o que falhou.
#[derive(Debug, Clone)]
pub struct Falha {
    pub uf: Option<String>,
    pub modalidade: u32,
}

impl Falha {
    /// Texto que vai para o `avisos` do index e aparece na tela.
    pub fn aviso(&self) -> String {
        format!(
            "modalidade {}{} não foi coletada nesta execução: a API do PNCP falhou",
            self.modalidade,
            self.uf.as_deref().map(|u| format!(" em {u}")).unwrap_or_default()
        )
    }
}

/// Espera antes da segunda passada. O padrão observado em quatro coletas foi de
/// falhas que se resolvem em minutos (duas delas morreram já na página 1), então
/// insistir depois de um intervalo custa pouco e recupera o dia.
const ESPERA_SEGUNDA_PASSADA: u64 = 300;

/// Busca todas as licitações com proposta aberta para o cruzamento UF ×
/// modalidade. Não aborta em erro parcial: acumula as combinações que falharam,
/// repete cada uma **uma vez** ao final e devolve as que continuaram falhando.
/// Falhas seguidas que fazem o coletor parar de esperar. Se três combinações
/// diferentes falham em sequência, o problema não é a consulta: é a API que
/// está fora — e aí insistir só queima o orçamento das que ainda podem dar certo.
const FALHAS_PARA_DESISTIR: u32 = 3;

pub fn buscar(
    ufs: &[String],
    modalidades: &[u32],
    dias_a_frente: i64,
    minutos_max: u64,
) -> (Vec<Licitacao>, Vec<Falha>) {
    let mut licitacoes = Vec::new();
    let mut falhas: Vec<Falha> = Vec::new();
    let prazo = Instant::now() + Duration::from_secs(minutos_max * 60);
    let mut consecutivas = 0u32;

    let data_final = match data_final(dias_a_frente) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("erro: falha ao calcular dataFinal: {e}");
            return (licitacoes, falhas);
        }
    };

    // Lista de UFs vazia = Brasil inteiro. `uf` é opcional na API, e omiti-lo
    // troca 27 varreduras por 1: cada registro traz a própria UF em
    // `unidadeOrgao.ufSigla`, então a tela não perde nada.
    let alvos: Vec<Option<&str>> = if ufs.is_empty() {
        vec![None]
    } else {
        ufs.iter().map(|uf| Some(uf.as_str())).collect()
    };

    let mut primeira = true;
    for uf in alvos {
        for &modalidade in modalidades {
            // O intervalo vale entre combinações também, não só entre páginas:
            // com 27 UFs seriam dezenas de requisições coladas.
            if !primeira {
                thread::sleep(Duration::from_secs(1));
            }
            primeira = false;

            if Instant::now() >= prazo {
                eprintln!("aviso: orçamento de {minutos_max} min esgotado — encerrando a coleta");
                falhas.push(Falha { uf: uf.map(String::from), modalidade });
                continue;
            }

            // Com o disjuntor aberto, o prazo vira "agora": tenta uma vez e
            // segue em frente, sem gastar minutos de espera por combinação.
            let prazo_efetivo = if consecutivas >= FALHAS_PARA_DESISTIR {
                Instant::now()
            } else {
                prazo
            };

            if let Err(e) = buscar_uf_modalidade(uf, modalidade, &data_final, &mut licitacoes, prazo_efetivo) {
                // Detalhe técnico vai para o log do job; a mensagem curta é
                // derivada da falha na hora de gravar e aparece na tela. Uma
                // modalidade inteira que falha (o pregão sumiu assim em 3 das 4
                // primeiras coletas) não pode passar como coleta completa.
                eprintln!("erro: uf={} modalidade={modalidade}: {e}", uf.unwrap_or("BR"));
                falhas.push(Falha {
                    uf: uf.map(String::from),
                    modalidade,
                });
                consecutivas += 1;
                if consecutivas == FALHAS_PARA_DESISTIR {
                    eprintln!(
                        "aviso: {FALHAS_PARA_DESISTIR} falhas seguidas — a API parece fora;                          seguindo sem esperas longas"
                    );
                }
            } else {
                consecutivas = 0;
            }
        }
    }

    let sobra = prazo.saturating_duration_since(Instant::now()).as_secs();
    if falhas.is_empty() || sobra < ESPERA_SEGUNDA_PASSADA + 60 {
        if !falhas.is_empty() {
            eprintln!("aviso: sem orçamento para a segunda passada ({sobra}s restantes)");
        }
        return (licitacoes, falhas);
    }

    // Segunda passada. Nos runs de 09-10/09/2026 o pregão morreu na página 1
    // com 500 e a API voltou minutos depois — o retry por página (30s/2min/5min)
    // não alcança isso, mas uma repetição no fim do job alcança.
    eprintln!(
        "aviso: {} combinações falharam; segunda passada em {}s",
        falhas.len(),
        ESPERA_SEGUNDA_PASSADA
    );
    thread::sleep(Duration::from_secs(ESPERA_SEGUNDA_PASSADA));

    let mut ainda_falham = Vec::new();
    for falha in falhas {
        let uf = falha.uf.as_deref();
        match buscar_uf_modalidade(uf, falha.modalidade, &data_final, &mut licitacoes, prazo) {
            Ok(()) => eprintln!(
                "segunda passada recuperou uf={} modalidade={}",
                uf.unwrap_or("BR"),
                falha.modalidade
            ),
            Err(e) => {
                eprintln!(
                    "erro: segunda passada falhou uf={} modalidade={}: {e}",
                    uf.unwrap_or("BR"),
                    falha.modalidade
                );
                ainda_falham.push(falha);
            }
        }
        thread::sleep(Duration::from_secs(1));
    }

    (licitacoes, ainda_falham)
}

/// Timeout explícito: sem ele uma conexão pendurada consumiria os 30 minutos
/// do job no Actions sem gravar nada.
pub(crate) fn agente() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        // 120s porque o PNCP lento responde (mesmo que com erro) em 30-70s:
        // com 60s o coletor desistia antes de o servidor terminar.
        .timeout(Duration::from_secs(120))
        .build()
}

// Os dois modos de falha do PNCP pedem esperas bem diferentes. `5xx`/`504` é o
// servidor deles engasgando — em 09/09/2026 o portal passou a noite devolvendo
// 500 depois de 30-50s e 504 depois de 70s, e voltou sozinho. Timeout é o
// bloqueio de IP por rajada, que só sai depois de ~3 min: insistir em segundos
// apenas renova o bloqueio.
// Medido: durante uma instabilidade real do PNCP, três tentativas espaçadas de
// 45s falharam em sequência — esperas de segundos não alcançam o problema.
const ESPERA_5XX: [u64; 3] = [30, 120, 300];
const ESPERA_TIMEOUT: [u64; 2] = [180, 300];

/// Repete a mesma página enquanto houver espera prevista para aquele tipo de
/// falha. `4xx` é parâmetro inválido nosso: repetir não conserta.
pub(crate) fn chamar(
    montar: impl Fn() -> ureq::Request,
    prazo: Instant,
) -> Result<ureq::Response, Box<dyn Error>> {
    let mut tentativa = 0usize;
    loop {
        let erro = match montar().call() {
            Ok(resposta) => return Ok(resposta),
            Err(e) => e,
        };

        let espera = match &erro {
            ureq::Error::Status(codigo, _) if *codigo >= 500 => ESPERA_5XX.get(tentativa),
            ureq::Error::Transport(_) => ESPERA_TIMEOUT.get(tentativa),
            _ => None,
        };

        let Some(&espera) = espera else {
            return Err(Box::new(erro));
        };

        // Esperar só se couber no orçamento. Sem isso, com a API fora do ar,
        // cada combinação gastava 450s (30+120+300) e 21 delas somavam 157 min
        // — foi assim que o job morreu no timeout sem publicar nada.
        if Instant::now() + Duration::from_secs(espera) >= prazo {
            eprintln!("aviso: {erro} — sem tempo no orçamento para nova tentativa");
            return Err(Box::new(erro));
        }

        eprintln!("aviso: {erro} — nova tentativa em {espera}s");
        thread::sleep(Duration::from_secs(espera));
        tentativa += 1;
    }
}

fn buscar_uf_modalidade(
    uf: Option<&str>,
    modalidade: u32,
    data_final: &str,
    licitacoes: &mut Vec<Licitacao>,
    prazo: Instant,
) -> Result<(), Box<dyn Error>> {
    let mut pagina = 1u32;
    loop {
        let http = chamar(
            || {
                let req = agente()
                .get(BASE_URL)
                .query("dataFinal", data_final)
                .query("codigoModalidadeContratacao", &modalidade.to_string())
                .query("pagina", &pagina.to_string())
                    .query("tamanhoPagina", &TAMANHO_PAGINA.to_string());
                match uf {
                    Some(uf) => req.query("uf", uf),
                    None => req,
                }
            },
            prazo,
        )?;

        // Sem resultados o PNCP responde 204 com corpo vazio (acontece com
        // inexigibilidade, que raramente tem proposta aberta) — não é erro.
        if http.status() == 204 {
            break;
        }

        let resposta: RespostaPncp = http.into_json()?;

        licitacoes.extend(resposta.data.iter().map(normalize));

        // `data` vazio também encerra: se a API errar o `paginasRestantes`,
        // o laço pararia de qualquer forma em vez de girar para sempre.
        if resposta.paginas_restantes == 0 || resposta.data.is_empty() {
            break;
        }

        thread::sleep(Duration::from_secs(1));
        pagina += 1;
    }

    Ok(())
}
