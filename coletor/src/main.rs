use coletor::itens;
use coletor::merge;
use coletor::pncp::{self, ItemResumo, Licitacao};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
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

/// Registro dentro do escopo de UFs configurado. Sem UF (fonte de diário
/// oficial) passa sempre: não é "outra UF", é UF desconhecida.
fn no_escopo(lic: &Licitacao, ufs: &[String]) -> bool {
    ufs.is_empty() || lic.uf.trim().is_empty() || ufs.contains(&lic.uf)
}

/// Em qual arquivo o registro vai. Fonte de diário oficial não informa UF, e
/// sem isso ele desapareceria na hora de particionar.
fn uf_ou_sem(lic: &Licitacao) -> &str {
    if lic.uf.trim().is_empty() {
        SEM_UF
    } else {
        lic.uf.as_str()
    }
}

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
            let mut lics = serde_json::from_str::<ArquivoUf>(&conteudo)?.licitacoes;

            // Os itens moram em arquivo próprio desde que o {UF}.json emagreceu.
            // Sem reassociar aqui, a próxima gravação escreveria itens vazios
            // para registros que já têm `tipo` — e como a fila de
            // enriquecimento olha `tipo`, eles nunca voltariam para refazer:
            // os itens sumiriam de vez, com o job verde.
            let caminho_itens = dir.join("itens").join(format!("{nome}.json"));
            if let Ok(bruto) = fs::read_to_string(&caminho_itens) {
                let mut mapa: HashMap<String, Vec<ItemResumo>> = serde_json::from_str(&bruto)?;
                for lic in lics.iter_mut() {
                    if lic.itens.is_empty() {
                        if let Some(itens) = mapa.remove(&lic.id) {
                            lic.itens = itens;
                        }
                    }
                }
            }

            anteriores.extend(lics);
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
    fs::create_dir_all(dir.join("itens"))?;

    // Apaga só o que vai ser reescrito. UF fora do escopo atual fica arquivada
    // no branch em vez de ser jogada fora: reabrir o escopo depois não deve
    // custar horas de enriquecimento de novo.
    let escopo: HashSet<String> = licitacoes
        .iter()
        .map(|l| uf_ou_sem(l).to_string())
        .chain(std::iter::once("index".to_string()))
        .collect();
    for entrada in fs::read_dir(dir)? {
        let caminho = entrada?.path();
        let nome = caminho.file_stem().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if caminho.extension().and_then(|e| e.to_str()) == Some("json") && escopo.contains(&nome) {
            fs::remove_file(caminho)?;
        }
    }

    let total = licitacoes.len();
    let falta_enriquecer = licitacoes.iter().filter(|l| l.tipo.is_empty()).count();

    let mut por_uf: BTreeMap<String, Vec<Licitacao>> = BTreeMap::new();
    for mut lic in licitacoes {
        lic.itens.truncate(MAX_ITENS_GRAVADOS);
        por_uf.entry(uf_ou_sem(&lic).to_string()).or_default().push(lic);
    }

    let mut contagem = BTreeMap::new();
    for (uf, mut lics) in por_uf {
        lics.sort_by(|a, b| a.encerramento.cmp(&b.encerramento));
        contagem.insert(uf.clone(), lics.len());

        // Os itens saem do arquivo principal: só de SP eles respondiam por
        // metade dos 8,3 MB, e a tela só precisa deles ao expandir uma linha.
        let mut itens: HashMap<String, Vec<ItemResumo>> = HashMap::new();
        for lic in lics.iter_mut() {
            if !lic.itens.is_empty() {
                itens.insert(lic.id.clone(), std::mem::take(&mut lic.itens));
            }
        }

        let caminho = dir.join(format!("{uf}.json"));
        fs::write(
            &caminho,
            serde_json::to_string(&ArquivoUf {
                gerado_em: gerado_em.to_string(),
                licitacoes: lics,
            })?,
        )?;
        let caminho_itens = dir.join("itens").join(format!("{uf}.json"));
        fs::write(&caminho_itens, serde_json::to_string(&itens)?)?;

        eprintln!(
            "  {uf}: {} editais, {} bytes (+ {} bytes de itens)",
            contagem[&uf],
            fs::metadata(&caminho)?.len(),
            fs::metadata(&caminho_itens)?.len()
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
    fn itens_sobrevivem_a_duas_gravacoes() {
        let dir = temp("itens-rejoin");
        let mut com_itens = lic("e", "SP");
        com_itens.itens = vec![ItemResumo {
            descricao: "bota de borracha".to_string(),
            quantidade: 10.0,
            unidade: "PAR".to_string(),
            valor_unitario: Some(45.0),
            tipo: "Material".to_string(),
        }];

        // 1ª gravação: itens saem para o arquivo separado.
        gravar(&dir, vec![com_itens], vec![], "2026-09-10T00:00:00Z").unwrap();
        let lido = ler_anteriores(&dir).unwrap();
        assert_eq!(lido[0].itens.len(), 1, "rejoin do arquivo de itens falhou");

        // 2ª gravação a partir do que foi lido: é aqui que os itens sumiriam
        // para sempre se o rejoin não existisse — `tipo` já está preenchido,
        // então o registro nunca voltaria para a fila de enriquecimento.
        gravar(&dir, lido, vec![], "2026-09-11T00:00:00Z").unwrap();
        let relido = ler_anteriores(&dir).unwrap();
        assert_eq!(relido[0].itens.len(), 1, "itens perdidos na segunda gravação");
        assert_eq!(relido[0].itens[0].descricao, "bota de borracha");
    }

    #[test]
    fn escopo_de_ufs_ignora_as_desativadas_mas_nunca_as_sem_uf() {
        let sul_sudeste: Vec<String> = ["SP", "SC"].iter().map(|s| s.to_string()).collect();

        assert!(no_escopo(&lic("a", "SP"), &sul_sudeste));
        assert!(!no_escopo(&lic("b", "BA"), &sul_sudeste));
        // Fonte de diário oficial não informa UF — não pode ser confundida com
        // "UF fora do escopo" e sumir da base.
        assert!(no_escopo(&lic("c", ""), &sul_sudeste));
        // Lista vazia = sem restrição (Brasil inteiro).
        assert!(no_escopo(&lic("d", "BA"), &[]));
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

    // Dois modos, porque coleta e enriquecimento viraram workflows separados.
    // No modo `enriquecer` não há coleta — e o guard de "coleta vazia" abaixo,
    // que existe para nunca sobrescrever dado bom com nada, mataria o job antes
    // de qualquer trabalho.
    let modo = std::env::var("MODO").unwrap_or_default();
    let so_enriquecer = modo == "enriquecer";
    let so_coletar = modo == "coletar";

    let (mut novas, falhas) = if so_enriquecer {
        eprintln!("modo: apenas enriquecimento (sem coleta)");
        (Vec::new(), Vec::new())
    } else {
        pncp::buscar(&config.ufs, &config.modalidades, config.dias_a_frente)
    };

    if !so_enriquecer && novas.is_empty() {
        eprintln!("erro: coleta não retornou nenhuma licitação — arquivos mantidos como estavam");
        process::exit(1);
    }

    let avisos: Vec<String> = falhas.iter().map(pncp::Falha::aviso).collect();
    for aviso in &avisos {
        eprintln!("aviso: {aviso}");
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
    let mut anteriores = ler_anteriores(&dir_saida)?;

    // Fora do escopo atual de UFs, o registro deixa de entrar no merge — senão
    // as UFs desativadas ficariam vivas por mais 30 dias como fantasmas. O
    // arquivo delas continua no branch, arquivado, e volta quando o escopo
    // voltar. Registro sem UF (fonte de diário) nunca cai neste filtro.
    if !config.ufs.is_empty() {
        let antes = anteriores.len();
        anteriores.retain(|lic| no_escopo(lic, &config.ufs));
        if antes != anteriores.len() {
            eprintln!(
                "fora do escopo: {} registros arquivados (UFs {:?})",
                antes - anteriores.len(),
                config.ufs
            );
        }
    }

    let hoje = time::OffsetDateTime::now_utc()
        .date()
        .format(time::macros::format_description!("[year]-[month]-[day]"))?;

    let mut licitacoes = merge::merge(novas, anteriores, &hoje, config.manter_vencidas_por_dias);
    // Ordenar antes de enriquecer faz a fila começar por quem encerra primeiro,
    // que é o edital que precisa de decisão hoje.
    licitacoes.sort_by(|a, b| a.encerramento.cmp(&b.encerramento));

    // No workflow de coleta o enriquecimento não roda: eram as duas etapas
    // disputando o mesmo relógio que levou o job a 2h08 de um teto de 2h30.
    if config.enriquecer && !so_coletar {
        enriquecer(&mut licitacoes, &hoje, config.enriquecer_max);
    }

    let gerado_em =
        time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?;
    gravar(&dir_saida, licitacoes, avisos, &gerado_em)?;

    Ok(())
}
