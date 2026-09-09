use coletor::merge;
use coletor::pncp::{self, Licitacao};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

#[derive(Debug, Deserialize)]
struct Config {
    ufs: Vec<String>,
    modalidades: Vec<u32>,
    dias_a_frente: i64,
    manter_vencidas_por_dias: i64,
    saida: String,
    // Filtros opcionais da coleta: ausentes ou vazios, nada é descartado.
    #[serde(default)]
    valor_max: Option<f64>,
    #[serde(default)]
    palavras_chave: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Saida {
    gerado_em: String,
    // O que faltou nesta execução. A tela mostra isso: coleta parcial exibida
    // como se fosse completa é pior que coleta nenhuma.
    #[serde(default)]
    avisos: Vec<String>,
    licitacoes: Vec<Licitacao>,
}

fn main() {
    if let Err(e) = executar() {
        eprintln!("erro: {e}");
        process::exit(1);
    }
}

fn executar() -> Result<(), Box<dyn Error>> {
    // O binário roda com cwd = raiz do repo no CI, mas também pode ser
    // executado de dentro de coletor/ em dev local.
    let raiz = if Path::new("config.json").exists() {
        PathBuf::from(".")
    } else {
        PathBuf::from("..")
    };
    let config: Config = serde_json::from_str(&fs::read_to_string(raiz.join("config.json"))?)?;

    let (mut novas, erros) = pncp::buscar(&config.ufs, &config.modalidades, config.dias_a_frente);

    // Coleta vazia é sempre suspeita, com ou sem erro reportado: nunca
    // sobrescrever um JSON bom com nada.
    if novas.is_empty() {
        for erro in &erros {
            eprintln!("erro: {erro}");
        }
        eprintln!("erro: coleta não retornou nenhuma licitação — arquivo mantido como estava");
        process::exit(1);
    }

    for erro in &erros {
        eprintln!("aviso: {erro}");
    }

    // O mesmo edital pode aparecer em mais de uma combinação UF/modalidade.
    let mut ids_vistos = HashSet::new();
    novas.retain(|lic| ids_vistos.insert(lic.id.clone()));

    let coletadas = novas.len();
    novas.retain(|lic| pncp::interessa(lic, config.valor_max, &config.palavras_chave));
    eprintln!("coletadas: {coletadas} — após filtro do config: {}", novas.len());

    let caminho_saida = raiz.join(&config.saida);
    // Arquivo ilegível é erro, não "começar do zero": engolir isso resetaria
    // todo o `visto` e descartaria os editais que já sumiram da API.
    let anteriores = match fs::read_to_string(&caminho_saida) {
        Ok(conteudo) => serde_json::from_str::<Saida>(&conteudo)?.licitacoes,
        Err(_) => Vec::new(),
    };

    let hoje = time::OffsetDateTime::now_utc()
        .date()
        .format(time::macros::format_description!("[year]-[month]-[day]"))?;

    let mut licitacoes = merge::merge(novas, anteriores, &hoje, config.manter_vencidas_por_dias);
    licitacoes.sort_by(|a, b| a.encerramento.cmp(&b.encerramento));

    let saida = Saida {
        gerado_em: time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?,
        avisos: erros,
        licitacoes,
    };

    if let Some(pai) = caminho_saida.parent() {
        fs::create_dir_all(pai)?;
    }
    // Minificado: o arquivo é consumido por máquina e pode passar de dezenas de
    // MB no escopo nacional — indentar só engorda o download da tela.
    fs::write(&caminho_saida, serde_json::to_string(&saida)?)?;
    eprintln!(
        "gravadas: {} — {} bytes em {}",
        saida.licitacoes.len(),
        fs::metadata(&caminho_saida)?.len(),
        caminho_saida.display()
    );

    Ok(())
}
