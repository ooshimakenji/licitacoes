use coletor::concursos;
use coletor::itens;
use coletor::merge;
use coletor::pncp::{self, ItemResumo, Licitacao};
use serde::{Deserialize, Serialize};
use flate2::write::GzEncoder;
use flate2::read::GzDecoder;
use flate2::Compression;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Read, Write};
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

/// Editais com proposta aberta agora — o que a tela mostra por padrão.
const ABERTOS: &str = "abertos";
const ITENS: &str = "itens";

/// A API do PNCP quer data como AAAAMMDD, sem hífen.
const FORMATO_API: &[time::format_description::FormatItem] =
    time::macros::format_description!("[year][month][day]");

/// Grava JSON comprimido. Medido nestes dados: 93% menor, o que é a diferença
/// entre 615 MB e ~45 MB de histórico anual — e entre baixar 5 MB ou 350 KB por
/// UF na tela. O navegador descomprime com `DecompressionStream`, nativo.
fn gravar_gz<T: Serialize>(caminho: &Path, dado: &T) -> Result<u64, Box<dyn Error>> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(&serde_json::to_vec(dado)?)?;
    let bytes = gz.finish()?;
    let tamanho = bytes.len() as u64;
    fs::write(caminho, bytes)?;
    Ok(tamanho)
}

fn ler_gz<T: for<'a> Deserialize<'a>>(caminho: &Path) -> Result<T, Box<dyn Error>> {
    let comprimido = fs::read(caminho)?;
    let mut texto = String::new();
    GzDecoder::new(&comprimido[..]).read_to_string(&mut texto)?;
    Ok(serde_json::from_str(&texto)?)
}

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
    /// Quantos dias para trás o delta diário cobre. 2 dá folga para fuso e
    /// para o edital publicado tarde no dia anterior.
    #[serde(default = "delta_padrao")]
    dias_delta: i64,
    /// Orçamento de tempo da coleta. Existe porque a API do PNCP cai: sem teto,
    /// as esperas de retry somadas estouravam o job e nada era publicado.
    #[serde(default = "orcamento_padrao")]
    minutos_max: u64,
}

fn orcamento_padrao() -> u64 {
    45
}

fn delta_padrao() -> i64 {
    2
}

/// Um arquivo por UF.
#[derive(Debug, Serialize, Deserialize)]
struct ArquivoUf {
    gerado_em: String,
    #[serde(default)]
    licitacoes: Vec<Licitacao>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ArquivoConcursos {
    gerado_em: String,
    #[serde(default)]
    concursos: Vec<concursos::Concurso>,
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
    /// Meses de histórico disponíveis, do mais recente para o mais antigo.
    meses: Vec<String>,
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

/// Lê os editais com proposta aberta da execução anterior, rejuntando os itens
/// (que moram em arquivo próprio). Se o layout novo ainda não existe, cai no
/// layout anterior — `{UF}.json` na raiz —, porque começar do zero significaria
/// refazer horas de enriquecimento e marcar todo edital como NOVA.
fn ler_anteriores(dir: &Path) -> Result<Vec<Licitacao>, Box<dyn Error>> {
    let dir_abertos = dir.join(ABERTOS);
    let mut anteriores = Vec::new();
    let mut achou = 0;

    if dir_abertos.exists() {
        for entrada in fs::read_dir(&dir_abertos)? {
            let caminho = entrada?.path();
            let uf = nome_uf(&caminho);
            if uf.is_empty() {
                continue;
            }
            let mut lics: Vec<Licitacao> = ler_gz::<ArquivoUf>(&caminho)?.licitacoes;
            rejuntar_itens(dir, &uf, &mut lics)?;
            anteriores.extend(lics);
            achou += 1;
        }
    }

    if achou > 0 {
        eprintln!("abertos anteriores: {} registros em {achou} arquivos", anteriores.len());
        return Ok(anteriores);
    }

    // Transição: layout antigo (arquivo por UF na raiz, sem compressão).
    if dir.exists() {
        for entrada in fs::read_dir(dir)? {
            let caminho = entrada?.path();
            let nome = caminho
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if caminho.extension().and_then(|e| e.to_str()) != Some("json") || nome == "index" {
                continue;
            }
            let mut lics =
                serde_json::from_str::<ArquivoUf>(&fs::read_to_string(&caminho)?)?.licitacoes;
            rejuntar_itens(dir, &nome, &mut lics)?;
            anteriores.extend(lics);
            achou += 1;
        }
    }
    if achou > 0 {
        eprintln!("transição: {} registros lidos do layout antigo", anteriores.len());
    } else {
        eprintln!("anteriores: nenhum arquivo encontrado — primeira coleta");
    }
    Ok(anteriores)
}

/// Os itens vivem separados desde que o arquivo por UF emagreceu. Sem reassociar
/// aqui, a gravação seguinte escreveria itens vazios para registros que já têm
/// `tipo` — e como a fila de enriquecimento olha `tipo`, eles nunca voltariam:
/// os itens sumiriam de vez, com o job verde.
fn rejuntar_itens(dir: &Path, uf: &str, lics: &mut [Licitacao]) -> Result<(), Box<dyn Error>> {
    let gz = dir.join(ITENS).join(format!("{uf}.json.gz"));
    let puro = dir.join(ITENS).join(format!("{uf}.json"));
    let mapa: HashMap<String, Vec<ItemResumo>> = if gz.exists() {
        ler_gz(&gz)?
    } else if puro.exists() {
        serde_json::from_str(&fs::read_to_string(&puro)?)?
    } else {
        return Ok(());
    };
    for lic in lics.iter_mut() {
        if lic.itens.is_empty() {
            if let Some(itens) = mapa.get(&lic.id) {
                lic.itens = itens.clone();
            }
        }
    }
    Ok(())
}

fn nome_uf(caminho: &Path) -> String {
    caminho
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_suffix(".json.gz"))
        .unwrap_or("")
        .to_string()
}

/// Grava os abertos (um arquivo por UF, comprimido) e os itens à parte.
fn gravar(
    dir: &Path,
    licitacoes: Vec<Licitacao>,
    avisos: Vec<String>,
    gerado_em: &str,
) -> Result<(), Box<dyn Error>> {
    let dir_abertos = dir.join(ABERTOS);
    fs::create_dir_all(&dir_abertos)?;
    fs::create_dir_all(dir.join(ITENS))?;

    let total = licitacoes.len();
    let falta_enriquecer = licitacoes.iter().filter(|l| l.tipo.is_empty()).count();

    let mut por_uf: BTreeMap<String, Vec<Licitacao>> = BTreeMap::new();
    for mut lic in licitacoes {
        lic.itens.truncate(MAX_ITENS_GRAVADOS);
        por_uf
            .entry(uf_ou_sem(&lic).to_string())
            .or_default()
            .push(lic);
    }

    // Só as UFs em escopo são reescritas: UF desativada fica arquivada, para
    // reabrir o escopo não custar horas de enriquecimento de novo.
    let escopo: HashSet<String> = por_uf.keys().cloned().collect();
    for entrada in fs::read_dir(&dir_abertos)? {
        let caminho = entrada?.path();
        if escopo.contains(&nome_uf(&caminho)) {
            fs::remove_file(caminho)?;
        }
    }

    let mut contagem = BTreeMap::new();
    for (uf, mut lics) in por_uf {
        lics.sort_by(|a, b| a.encerramento.cmp(&b.encerramento));
        contagem.insert(uf.clone(), lics.len());

        let mut itens: HashMap<String, Vec<ItemResumo>> = HashMap::new();
        for lic in lics.iter_mut() {
            if !lic.itens.is_empty() {
                itens.insert(lic.id.clone(), std::mem::take(&mut lic.itens));
            }
        }

        let n = lics.len();
        let bytes = gravar_gz(
            &dir_abertos.join(format!("{uf}.json.gz")),
            &ArquivoUf {
                gerado_em: gerado_em.to_string(),
                licitacoes: lics,
            },
        )?;
        let bytes_itens = gravar_gz(&dir.join(ITENS).join(format!("{uf}.json.gz")), &itens)?;
        eprintln!("  abertos {uf}: {n} editais, {bytes} B (+ {bytes_itens} B de itens)");
    }

    limpar_layout_antigo(dir)?;
    gravar_index(dir, gerado_em, total, falta_enriquecer, contagem, avisos)?;
    eprintln!("gravadas: {total} abertas ({falta_enriquecer} ainda sem enriquecimento)");
    Ok(())
}

/// O layout antigo sai do caminho na mesma execução: deixar os dois conviverem
/// faria a tela ler dado velho dependendo do caminho que pedisse.
fn limpar_layout_antigo(dir: &Path) -> Result<(), Box<dyn Error>> {
    for entrada in fs::read_dir(dir)? {
        let caminho = entrada?.path();
        let nome = caminho.file_stem().and_then(|n| n.to_str()).unwrap_or("");
        if caminho.extension().and_then(|e| e.to_str()) == Some("json") && nome != "index" {
            fs::remove_file(caminho)?;
        }
    }
    let itens = dir.join(ITENS);
    if itens.exists() {
        for entrada in fs::read_dir(&itens)? {
            let caminho = entrada?.path();
            if caminho.extension().and_then(|e| e.to_str()) == Some("json") {
                fs::remove_file(caminho)?;
            }
        }
    }
    Ok(())
}

/// Anexa os publicados ao arquivo do mês correspondente, deduplicando por id —
/// repetir o delta do mesmo dia, ou passar o backfill por cima, não pode dobrar
/// o mês.
fn anexar_mes(
    dir: &Path,
    publicados: Vec<Licitacao>,
    gerado_em: &str,
) -> Result<(), Box<dyn Error>> {
    let mut por_mes: BTreeMap<(String, String), Vec<Licitacao>> = BTreeMap::new();
    for mut lic in publicados {
        // Histórico não guarda itens: enriquecer centenas de milhares de
        // editais levaria centenas de horas e não é o objetivo deles.
        lic.itens.clear();
        let mes = mes_de(&lic);
        por_mes
            .entry((mes, uf_ou_sem(&lic).to_string()))
            .or_default()
            .push(lic);
    }

    for ((mes, uf), novos) in por_mes {
        let dir_mes = dir.join(&mes);
        fs::create_dir_all(&dir_mes)?;
        let caminho = dir_mes.join(format!("{uf}.json.gz"));

        let mut registros: Vec<Licitacao> = if caminho.exists() {
            ler_gz::<ArquivoUf>(&caminho)?.licitacoes
        } else {
            Vec::new()
        };
        let conhecidos: HashSet<String> = registros.iter().map(|l| l.id.clone()).collect();
        let antes = registros.len();
        registros.extend(novos.into_iter().filter(|l| !conhecidos.contains(&l.id)));
        registros.sort_by(|a, b| b.publicado.cmp(&a.publicado));

        let n = registros.len();
        let bytes = gravar_gz(
            &caminho,
            &ArquivoUf {
                gerado_em: gerado_em.to_string(),
                licitacoes: registros,
            },
        )?;
        eprintln!("  {mes}/{uf}: {n} editais ({} novos), {bytes} B", n - antes);
    }
    Ok(())
}

/// Mês de publicação (AAAA-MM). Sem data de publicação, cai no encerramento —
/// e só então numa gaveta à parte, para o registro nunca sumir.
fn mes_de(lic: &Licitacao) -> String {
    for campo in [&lic.publicado, &lic.encerramento] {
        if campo.len() >= 7 {
            return campo[..7].to_string();
        }
    }
    "sem-data".to_string()
}

fn gravar_index(
    dir: &Path,
    gerado_em: &str,
    total: usize,
    falta_enriquecer: usize,
    por_uf: BTreeMap<String, usize>,
    avisos: Vec<String>,
) -> Result<(), Box<dyn Error>> {
    // Meses existentes no disco: é o que a tela oferece como histórico.
    let mut meses: Vec<String> = Vec::new();
    for entrada in fs::read_dir(dir)? {
        let caminho = entrada?.path();
        if !caminho.is_dir() {
            continue;
        }
        let nome = caminho
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if nome.len() == 7 && nome.as_bytes()[4] == b'-' {
            meses.push(nome);
        }
    }
    meses.sort();
    meses.reverse();

    let index = Index {
        gerado_em: gerado_em.to_string(),
        avisos,
        total,
        falta_enriquecer,
        por_uf,
        meses,
    };
    fs::write(dir.join("index.json"), serde_json::to_string(&index)?)?;
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

        assert!(dir.join("abertos/SP.json.gz").exists());
        assert!(dir.join("abertos/SC.json.gz").exists());
        assert!(
            dir.join("abertos/SEM-UF.json.gz").exists(),
            "registro sem UF não pode desaparecer"
        );
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
    fn publicado_vai_para_o_mes_e_nao_para_abertos() {
        let dir = temp("mes");
        let mut pub1 = lic("p1", "SP");
        pub1.publicado = "2026-08-14T10:00:00".to_string();
        pub1.itens = vec![ItemResumo {
            descricao: "x".into(),
            quantidade: 1.0,
            unidade: "UN".into(),
            valor_unitario: Some(1.0),
            tipo: "Material".into(),
        }];

        anexar_mes(&dir, vec![pub1], "2026-09-11T00:00:00Z").unwrap();

        assert!(dir.join("2026-08/SP.json.gz").exists(), "histórico vai para o mês da publicação");
        assert!(!dir.join("abertos/SP.json.gz").exists(), "histórico não é aberto");

        // Histórico não carrega itens: enriquecer centenas de milhares de
        // editais levaria centenas de horas, e não é para isso que ele serve.
        let arq: ArquivoUf = ler_gz(&dir.join("2026-08/SP.json.gz")).unwrap();
        assert!(arq.licitacoes[0].itens.is_empty());
    }

    #[test]
    fn anexar_o_mesmo_dia_duas_vezes_nao_dobra_o_mes() {
        let dir = temp("dedup-mes");
        let mut p = lic("mesmo-id", "SC");
        p.publicado = "2026-09-02T08:00:00".to_string();

        anexar_mes(&dir, vec![p.clone()], "2026-09-11T00:00:00Z").unwrap();
        anexar_mes(&dir, vec![p], "2026-09-11T00:00:00Z").unwrap();

        let arq: ArquivoUf = ler_gz(&dir.join("2026-09/SC.json.gz")).unwrap();
        // Sem dedup por id, repetir o delta do dia (ou passar o backfill por
        // cima) duplicaria cada edital do mês.
        assert_eq!(arq.licitacoes.len(), 1);
    }

    #[test]
    fn transicao_le_o_layout_antigo_sem_compressao() {
        let dir = temp("transicao");
        fs::create_dir_all(&dir).unwrap();
        let antigo = serde_json::json!({
            "gerado_em": "2026-09-10T00:00:00Z",
            "licitacoes": [{
                "id": "velha", "objeto": "o", "valor": null, "uf": "SP", "municipio": "m",
                "orgao": "o", "modalidade": "Dispensa", "abertura": "", "encerramento": "2026-12-01T09:00:00",
                "link": "", "link_pncp": "", "visto": "2026-08-01", "tipo": "Material"
            }]
        });
        fs::write(dir.join("SP.json"), antigo.to_string()).unwrap();

        let lidos = ler_anteriores(&dir).expect("deve ler o layout antigo");
        assert_eq!(lidos.len(), 1);
        assert_eq!(lidos[0].tipo, "Material");

        // E a gravação seguinte não deixa os dois layouts convivendo.
        gravar(&dir, lidos, vec![], "2026-09-11T00:00:00Z").unwrap();
        assert!(!dir.join("SP.json").exists(), "layout antigo tem que sair do caminho");
        assert!(dir.join("abertos/SP.json.gz").exists());
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

    // Concursos não têm PNCP: a fonte é outra e o ciclo é curto (6 páginas),
    // então roda em execução própria.
    if modo == "concursos" {
        return coletar_concursos(&config, &raiz);
    }

    // Backfill roda sozinho e só mexe no histórico: pega um mês inteiro de
    // publicações e anexa ao arquivo daquele mês.
    if modo == "backfill" {
        let mes = std::env::var("MES")?;
        return backfill(&config, &raiz, &mes);
    }

    let (mut novas, falhas) = if so_enriquecer {
        eprintln!("modo: apenas enriquecimento (sem coleta)");
        (Vec::new(), Vec::new())
    } else {
        pncp::buscar(
            &config.ufs,
            &config.modalidades,
            config.dias_a_frente,
            config.minutos_max,
        )
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

    // Delta diário: é o que enxerga a dispensa de cidade pequena, que abre e
    // fecha entre duas coletas. Medido em MG: 4.395 dispensas publicadas em 30
    // dias contra 361 com proposta aberta — a consulta de "aberto agora" via 8%.
    if !so_enriquecer {
        let hoje = time::OffsetDateTime::now_utc().date();
        let de = (hoje - time::Duration::days(config.dias_delta)).format(FORMATO_API)?;
        let ate = hoje.format(FORMATO_API)?;
        eprintln!("delta de publicações: {de} a {ate}");

        let (publicados, falhas) = pncp::buscar_publicados(
            &config.ufs,
            &config.modalidades,
            &de,
            &ate,
            config.minutos_max,
        );
        for f in &falhas {
            eprintln!("aviso: delta — {}", f.aviso());
        }
        eprintln!("publicados no período: {}", publicados.len());
        anexar_mes(&dir_saida, publicados, &gerado_em)?;
    }

    Ok(())
}

/// Radar de concursos. Grava um arquivo só: são ~35 KB comprimidos, o que não
/// justifica partição nenhuma.
fn coletar_concursos(config: &Config, raiz: &Path) -> Result<(), Box<dyn Error>> {
    let dir = raiz.join(&config.saida_dir);
    fs::create_dir_all(&dir)?;
    let caminho = dir.join("concursos.json.gz");

    let novos = concursos::buscar()?;
    eprintln!("concursos encontrados: {}", novos.len());

    let anteriores: Vec<concursos::Concurso> = if caminho.exists() {
        ler_gz::<ArquivoConcursos>(&caminho)?.concursos
    } else {
        Vec::new()
    };

    let hoje = time::OffsetDateTime::now_utc()
        .date()
        .format(time::macros::format_description!("[year]-[month]-[day]"))?;
    let gerado_em =
        time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?;

    let mut lista = concursos::merge(novos, &anteriores, &hoje);
    lista.sort_by(|a, b| a.inscricoes.cmp(&b.inscricoes));
    let novos_hoje = lista.iter().filter(|c| c.visto == hoje).count();

    let bytes = gravar_gz(
        &caminho,
        &ArquivoConcursos { gerado_em, concursos: lista },
    )?;
    eprintln!("gravados: {bytes} B ({novos_hoje} novos desde a última coleta)");
    Ok(())
}

/// Um mês inteiro de publicações, para preencher o histórico de trás para a
/// frente. Roda em execução própria: são ~1.000 páginas por mês.
fn backfill(config: &Config, raiz: &Path, mes: &str) -> Result<(), Box<dyn Error>> {
    let (ano, m) = mes
        .split_once('-')
        .ok_or("MES deve estar no formato AAAA-MM")?;
    let ano: i32 = ano.parse()?;
    let m: u8 = m.parse()?;
    let primeiro = time::Date::from_calendar_date(ano, time::Month::try_from(m)?, 1)?;
    let ultimo = primeiro
        .replace_day(time::util::days_in_year_month(ano, time::Month::try_from(m)?))?;

    eprintln!("backfill de {mes}: {primeiro} a {ultimo}");
    let (publicados, falhas) = pncp::buscar_publicados(
        &config.ufs,
        &config.modalidades,
        &primeiro.format(FORMATO_API)?,
        &ultimo.format(FORMATO_API)?,
        config.minutos_max,
    );
    for f in &falhas {
        eprintln!("aviso: backfill — {}", f.aviso());
    }
    eprintln!("publicados em {mes}: {}", publicados.len());

    let dir_saida = raiz.join(&config.saida_dir);
    let gerado_em =
        time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?;
    anexar_mes(&dir_saida, publicados, &gerado_em)?;

    // Regrava os abertos sem mudá-los, só para o index passar a listar o mês novo.
    let abertos = ler_anteriores(&dir_saida)?;
    gravar(&dir_saida, abertos, Vec::new(), &gerado_em)?;
    Ok(())
}
