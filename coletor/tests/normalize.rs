use coletor::merge::merge;
use coletor::pncp::{interessa, normalize, ItemPncp, ItemResumo, Licitacao};

#[derive(serde::Deserialize)]
struct RespostaFixture {
    data: Vec<ItemPncp>,
}

/// Registro mínimo para os testes: só o que cada caso precisa, o resto no
/// default do contrato.
fn exemplo(id: &str, objeto: &str, valor: Option<f64>, encerramento: &str) -> Licitacao {
    Licitacao {
        id: id.to_string(),
        objeto: objeto.to_string(),
        valor,
        uf: "SP".to_string(),
        municipio: "Bauru".to_string(),
        encerramento: encerramento.to_string(),
        ..Default::default()
    }
}

#[test]
fn normaliza_primeiro_item_da_fixture() {
    let bruto = include_str!("fixture.json");
    let resposta: RespostaFixture = serde_json::from_str(bruto).expect("fixture deve desserializar");
    let item = resposta.data.first().expect("fixture deve ter ao menos um item");

    let lic = normalize(item);

    assert!(!lic.id.is_empty());
    assert_eq!(lic.uf, "SP");

    // Pegadinha: sequencialCompra=589 no fixture, mas o id/numeroControlePNCP
    // traz "000589" com zeros à esquerda. O link_pncp precisa do valor SEM zeros.
    assert_eq!(
        lic.link_pncp,
        "https://pncp.gov.br/app/editais/46137410000180/2025/589"
    );
    assert!(!lic.link_pncp.contains("/000589"));
}

#[test]
fn campos_novos_saem_da_mesma_resposta() {
    let resposta: RespostaFixture =
        serde_json::from_str(include_str!("fixture.json")).expect("fixture deve desserializar");
    let lic = normalize(resposta.data.first().unwrap());

    assert_eq!(lic.esfera, "Municipal"); // esferaId = "M"
    assert_eq!(lic.ibge, "3506003");
    assert_eq!(lic.modalidade_id, Some(6));
    assert!(!lic.unidade.is_empty());
    assert!(!lic.situacao.is_empty());
    assert!(lic.amparo.starts_with("Lei 14.133"));
    assert!(!lic.srp);

    // valorTotalEstimado = 0.0 na fixture: orçamento sigiloso, não R$ 0. Virar
    // número faria a tela mostrar "R$ 0,00" e o filtro de valor descartar.
    assert_eq!(lic.valor, None);
}

#[test]
fn merge_preserva_visto_de_registro_ja_conhecido() {
    let mut anterior = exemplo("abc-1", "objeto", Some(100.0), "2026-09-20T09:00:00");
    anterior.visto = "2026-08-01".to_string();

    let mut nova = anterior.clone();
    nova.visto = String::new(); // como viria recém-normalizada, antes do merge

    let resultado = merge(vec![nova], vec![anterior], "2026-09-09", 30);

    assert_eq!(resultado.len(), 1);
    assert_eq!(resultado[0].visto, "2026-08-01");
}

#[test]
fn merge_preserva_enriquecimento_para_nao_refazer_requests() {
    let mut anterior = exemplo("abc-4", "objeto", Some(100.0), "2026-09-20T09:00:00");
    anterior.visto = "2026-08-01".to_string();
    anterior.tipo = "Serviço".to_string();
    anterior.beneficio = "Participação exclusiva para ME/EPP".to_string();
    anterior.criterio = "Menor preço".to_string();
    anterior.itens = vec![ItemResumo {
        descricao: "bota de borracha".to_string(),
        quantidade: 10.0,
        unidade: "PAR".to_string(),
        valor_unitario: Some(45.0),
        tipo: "Material".to_string(),
    }];

    // Recém-coletada: a API não devolve nada disso, os campos vêm vazios.
    let nova = exemplo("abc-4", "objeto", Some(100.0), "2026-09-20T09:00:00");

    let resultado = merge(vec![nova], vec![anterior], "2026-09-09", 30);

    // Se isso quebrar, o enriquecimento volta a custar um request por edital
    // por dia — de incremental passa a diário.
    assert_eq!(resultado[0].tipo, "Serviço");
    assert_eq!(resultado[0].beneficio, "Participação exclusiva para ME/EPP");
    assert_eq!(resultado[0].itens.len(), 1);
    assert_eq!(resultado[0].itens[0].descricao, "bota de borracha");
}

#[test]
fn filtro_do_config_desligado_deixa_tudo_passar() {
    let lic = exemplo("abc-5", "Coleta de resíduos sólidos urbanos", Some(9_000_000.0), "");

    assert!(interessa(&lic, None, &[]));
}

#[test]
fn filtro_corta_por_teto_de_valor_mas_nao_por_valor_ausente() {
    let cara = exemplo("a", "obra", Some(2_000_000.0), "");
    let barata = exemplo("b", "obra", Some(80_000.0), "");
    let sem_valor = exemplo("c", "obra", None, "");

    assert!(!interessa(&cara, Some(500_000.0), &[]));
    assert!(interessa(&barata, Some(500_000.0), &[]));
    // Dispensa quase sempre vem sem valor estimado: reprovar seria perder
    // justamente o edital pequeno que o radar procura.
    assert!(interessa(&sem_valor, Some(500_000.0), &[]));
}

#[test]
fn filtro_por_palavra_chave_ignora_caixa() {
    let lic = exemplo("d", "Contratação de COLETA de Resíduos", None, "");

    assert!(interessa(&lic, None, &["resíduos".to_string()]));
    assert!(!interessa(&lic, None, &["climatização".to_string()]));
    // Espaço em branco no config não pode virar um "contains" que casa tudo.
    assert!(!interessa(&lic, None, &["  ".to_string()]));
}

#[test]
fn merge_descarta_registro_vencido_ha_muito_tempo() {
    let mut vencida = exemplo("abc-2", "objeto", None, "2026-01-10T09:00:00");
    vencida.visto = "2026-01-01".to_string();

    // Sumiu da coleta atual (novas = vazio) e venceu há bem mais de 30 dias.
    let resultado = merge(vec![], vec![vencida], "2026-09-09", 30);

    assert!(resultado.is_empty());
}
