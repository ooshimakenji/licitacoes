use coletor::itens;
use coletor::merge;
use coletor::pncp::{self, Licitacao};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::thread;
use std::time::Duration;

/// Itens gravados por edital. A tela já mostra no máximo 20 e a mediana medida
/// é 2 — mas pregão com 50 itens fazia o registro custar ~6 KB, e 21 mil
/// registros assim davam 36 MB num arquivo só.
const MAX_ITENS_GRAVADOS: usize = 20;

/// Onde vai o registro cuja fonte não informou UF (acontece com diário
/// oficial). Sem isso ele desapareceria na hora de particionar.
const SEM_UF: &str = "SEM-UF";

#[derive(Debug, Deserialize)]
struct Config {
    ufs: Vec<String>,
    modalidades: Vec<u32>,
    dias_a_frente: i64,
    manter_vencidas_por_dias: i64,
    // Diretório da saída: um arquivo por UF mais o index. O arquivo único de
    // antes passou de 36 MB com 21 mil editais — a tela baixava tudo.
    saida_dir: String,
    // Filtros opcionais da coleta: ausentes ou vazios, nada é descartado.
    #[serde(default)]
    valor_max: Option<f64>,
    #[serde(default)]
    palavras_chave: Vec<String>,
    // Enriquecimento com os itens de cada edital (serviço/material, ME/EPP).
    #[serde(default)]
    enriquecer: bool,
    #[serde(default)]
    enriquecer_max: usize,
}

/// Um arquivo por UF.
#[derive(Debug, Serialize, Deserialize)]
struct ArquivoUf {
    gerado_em: String,
    #[serde(default)]
    licitacoes: Vec<Licitacao>,
}

/// `index.json`: o que a tela lê primeiro para saber o que existe antes de
/// baixar qualquer UF.
#[derive(Debug, Serialize)]
struct Index {
    gerado_em: String,
    avisos: Vec<String>,
    total: usize,
    /// Quantos ainda não passaram pelo enriquecimento — acompanha a drenagem.
    falta_enriquecer: usize,
    por_uf: BTreeMap<String, usize>,
}

/// Formato antigo (arquivo único). Existe só para a primeira execução
/// particionada não perder o que já foi coletado e enriquecido.
#[derive(Debug, Deserialize)]
struct SaidaLegado {
    #[serde(default)]
    licitacoes: Vec<Licitacao>,
}

fn main() {
    if let Err(e) = executar() {
        eprintln!("erro: {e}");
        process::exit(1);
    }
}

/// Lê os arquivos por UF da execução anterior. Se não houver nenhum, cai no
/// arquivo único legado: sem isso, a primeira execução particionada acharia
/// que não conhece nada, refazendo horas de enriquecimento e marcando todo
/// edital como NOVA.
fn ler_anteriores(dir: &Path) -> Result<Vec<Licitacao>, Box<dyn Error>> {
    let mut anteriores = Vec::new();
    let mut arquivos_uf = 0;

    if dir.exists() {
        for entrada in fs::read_dir(dir)? {
            let caminho = entrada?.path();
            let nome = caminho.file_stem().and_then(|n| n.to_str()).unwrap_or("");
            let json = caminho.extension().and_then(|e| e.to_str()) == Some("json");
            if !json || nome == "index" || nome == "licitacoes" {
                continue;
            }
            let conteudo = fs::read_to_string(&caminho)?;
            anteriores.extend(serde_json::from_str::<ArquivoUf>(&conteudo)?.licitacoes);
            arquivos_uf += 1;
        }
    }

    if arquivos_uf > 0 {
        eprintln!("anteriores: {} registros em {arquivos_uf} arquivos por UF", anteriores.len());
        return Ok(anteriores);
    }

    if let Ok(conteudo) = fs::read_to_string(dir.join("licitacoes.json")) {
        let legado = serde_json::from_str::<SaidaLegado>(&conteudo)?.licitacoes;
        eprintln!("transição: {} registros lidos do arquivo único legado", legado.len());
        return Ok(legado);
    }

    eprintln!("anteriores: nenhum arquivo encontrado — primeira coleta");
    Ok(Vec::new())
}

/// Grava um arquivo por UF e o index. Limpa os `.json` antigos primeiro, senão
/// uma UF que deixou de ter editais ficaria com dado velho para sempre.
fn gravar(
    dir: &Path,
    licitacoes: Vec<Licitacao>,
    avisos: Vec<String>,
    gerado_em: &str,
) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(dir)?;
    for entrada in fs::read_dir(dir)? {
        let caminho = entrada?.path();
        if caminho.extension().and_then(|e| e.to_str()) == Some("json") {
            fs::remove_file(caminho)?;
        }
    }

    let total = licitacoes.len();
    let falta_enriquecer = licitacoes.iter().filter(|l| l.tipo.is_empty()).count();

    let mut por_uf: BTreeMap<String, Vec<Licitacao>> = BTreeMap::new();
    for mut lic in licitacoes {
        lic.itens.truncate(MAX_ITENS_GRAVADOS);
        let uf = if lic.uf.trim().is_empty() {
            SEM_UF.to_string()
        } else {
            lic.uf.clone()
        };
        por_uf.entry(uf).or_default().push(lic);
    }

    let mut contagem = BTreeMap::new();
    for (uf, mut lics) in por_uf {
        lics.sort_by(|a, b| a.encerramento.cmp(&b.encerramento));
        contagem.insert(uf.clone(), lics.len());
        let arquivo = ArquivoUf {
            gerado_em: gerado_em.to_string(),
            licitacoes: lics,
        };
        let caminho = dir.join(format!("{uf}.json"));
        fs::write(&caminho, serde_json::to_string(&arquivo)?)?;
        eprintln!(
            "  {uf}: {} editais, {} bytes",
            contagem[&uf],
            fs::metadata(&caminho)?.len()
        );
    }

    let index = Index {
        gerado_em: gerado_em.to_string(),
        avisos,
        total,
        falta_enriquecer,
        por_uf: contagem,
    };
    fs::write(dir.join("index.json"), serde_json::to_string(&index)?)?;
    eprintln!("gravadas: {total} editais ({falta_enriquecer} ainda sem enriquecimento)");

    Ok(())
}

/// Busca os itens (serviço/material, ME/EPP) de quem ainda não tem. Roda
/// **depois** do merge, então só paga pelo que é realmente novo: quem já foi
/// enriquecido ontem chegou aqui com `tipo` preenchido. A lista chega ordenada
/// por encerramento, então a fila naturalmente começa por quem encerra antes.
fn enriquecer(licitacoes: &mut [Licitacao], hoje: &str, maximo: usize) {
    let mut feitos = 0;
    let mut falhas = 0;

    for lic in licitacoes.iter_mut() {
        if feitos >= maximo {
            break;
        }
        if !lic.tipo.is_empty() {
            continue;
        }
        // Edital encerrado não vale o request: está na base só como histórico.
        if lic.encerramento.as_str() < hoje {
            continue;
        }
        let Some((cnpj, ano, seq)) = itens::coordenadas(&lic.link_pncp) else {
            continue;
        };

        match itens::buscar(&cnpj, &ano, &seq) {
            Ok(e) => {
                lic.tipo = e.tipo;
                lic.beneficio = e.beneficio;
                lic.criterio = e.criterio;
                lic.itens = e.itens;
            }
            Err(e) => {
                // 404 é resposta definitiva ("não há itens publicados"), não
                // falha a repetir: sem o sentinela o registro voltaria para
                // esta fila todos os dias.
                if e.to_string().contains("404") {
                    lic.tipo = itens::vazio().tipo;
                } else {
                    falhas += 1;
                    eprintln!("aviso: itens de {}: {e}", lic.id);
                }
            }
        }

        feitos += 1;
        thread::sleep(Duration::from_millis(500));
    }

    eprintln!("enriquecidos: {feitos} (falhas: {falhas})");
}

#[cfg(test)]
mod testes {
    use super::*;
    use coletor::pncp::ItemResumo;

    fn temp(nome: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coletor-teste-{nome}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn lic(id: &str, uf: &str) -> Licitacao {
        Licitacao {
            id: id.to_string(),
            uf: uf.to_string(),
            encerramento: "2026-12-01T09:00:00".to_string(),
            tipo: "Serviço".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn particiona_por_uf_e_le_de_volta() {
        let dir = temp("particiona");
        let sem_uf = lic("c", ""); // diário oficial não informa UF

        gravar(
            &dir,
            vec![lic("a", "SP"), lic("b", "SC"), sem_uf],
            vec!["aviso".to_string()],
            "2026-09-10T00:00:00Z",
        )
        .expect("deve gravar");

        assert!(dir.join("SP.json").exists());
        assert!(dir.join("SC.json").exists());
        assert!(dir.join("SEM-UF.json").exists(), "registro sem UF não pode desaparecer");
        assert!(dir.join("index.json").exists());

        // O que foi gravado tem que voltar inteiro, senão o merge do dia
        // seguinte perde o `visto` e o enriquecimento já pago.
        let devolta = ler_anteriores(&dir).expect("deve ler");
        assert_eq!(devolta.len(), 3);
        assert!(devolta.iter().all(|l| l.tipo == "Serviço"));
    }

    #[test]
    fn grava_no_maximo_vinte_itens_por_edital() {
        let dir = temp("itens");
        let mut cheia = lic("d", "SP");
        cheia.itens = (0..50)
            .map(|i| ItemResumo {
                descricao: format!("item {i}"),
                quantidade: 1.0,
                unidade: "UN".to_string(),
                valor_unitario: Some(10.0),
                tipo: "Material".to_string(),
            })
            .collect();

        gravar(&dir, vec![cheia], vec![], "2026-09-10T00:00:00Z").expect("deve gravar");

        let devolta = ler_anteriores(&dir).expect("deve ler");
        assert_eq!(devolta[0].itens.len(), MAX_ITENS_GRAVADOS);
    }

    #[test]
    fn primeira_execucao_particionada_le_o_arquivo_unico_legado() {
        let dir = temp("legado");
        fs::create_dir_all(&dir).unwrap();
        let legado = serde_json::json!({
            "gerado_em": "2026-09-09T00:00:00Z",
            "licitacoes": [{
                "id": "antiga", "objeto": "o", "valor": null, "uf": "SP", "municipio": "m",
                "orgao": "o", "modalidade": "Dispensa", "abertura": "", "encerramento": "2026-12-01T09:00:00",
                "link": "", "link_pncp": "", "visto": "2026-08-01", "tipo": "Material"
            }]
        });
        fs::write(dir.join("licitacoes.json"), legado.to_string()).unwrap();

        let anteriores = ler_anteriores(&dir).expect("deve ler o legado");

        // Se isso quebrar, a primeira execução particionada joga fora horas de
        // enriquecimento e marca todo edital como NOVA.
        assert_eq!(anteriores.len(), 1);
        assert_eq!(anteriores[0].tipo, "Material");
        assert_eq!(anteriores[0].visto, "2026-08-01");
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
    // sobrescrever dados bons com nada.
    if novas.is_empty() {
        for erro in &erros {
            eprintln!("erro: {erro}");
        }
        eprintln!("erro: coleta não retornou nenhuma licitação — arquivos mantidos como estavam");
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

    let dir_saida = raiz.join(&config.saida_dir);
    // Arquivo ilegível é erro, não "começar do zero": engolir isso resetaria
    // todo o `visto` e o enriquecimento já pago.
    let anteriores = ler_anteriores(&dir_saida)?;

    let hoje = time::OffsetDateTime::now_utc()
        .date()
        .format(time::macros::format_description!("[year]-[month]-[day]"))?;

    let mut licitacoes = merge::merge(novas, anteriores, &hoje, config.manter_vencidas_por_dias);
    // Ordenar antes de enriquecer faz a fila começar por quem encerra primeiro,
    // que é o edital que precisa de decisão hoje.
    licitacoes.sort_by(|a, b| a.encerramento.cmp(&b.encerramento));

    if config.enriquecer {
        enriquecer(&mut licitacoes, &hoje, config.enriquecer_max);
    }

    let gerado_em =
        time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?;
    gravar(&dir_saida, licitacoes, erros, &gerado_em)?;

    Ok(())
}
