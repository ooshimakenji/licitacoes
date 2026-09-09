use coletor::merge::merge;
use coletor::pncp::{interessa, normalize, ItemPncp, Licitacao};

#[derive(serde::Deserialize)]
struct RespostaFixture {
    data: Vec<ItemPncp>,
}

#[test]
fn normaliza_primeiro_item_da_fixture() {
    let bruto = include_str!("fixture.json");
    let resposta: RespostaFixture = serde_json::from_str(bruto).expect("fixture deve desserializar");
    let item = resposta.data.first().expect("fixture deve ter ao menos um item");

    let lic = normalize(item);

    assert!(!lic.id.is_empty());
    assert_eq!(lic.uf, "SP");
    assert!(lic.valor.is_some());

    // Pegadinha: sequencialCompra=589 no fixture, mas o id/numeroControlePNCP
    // traz "000589" com zeros à esquerda. O link_pncp precisa do valor SEM zeros.
    assert_eq!(
        lic.link_pncp,
        "https://pncp.gov.br/app/editais/46137410000180/2025/589"
    );
    assert!(!lic.link_pncp.contains("/000589"));
}

#[test]
fn merge_preserva_visto_de_registro_ja_conhecido() {
    let anterior = Licitacao {
        id: "abc-1".to_string(),
        objeto: "objeto".to_string(),
        valor: Some(100.0),
        uf: "SP".to_string(),
        municipio: "Bauru".to_string(),
        orgao: "orgao".to_string(),
        modalidade: "Pregão".to_string(),
        abertura: "2026-09-01T08:00:00".to_string(),
        encerramento: "2026-09-20T09:00:00".to_string(),
        link: "".to_string(),
        link_pncp: "".to_string(),
        visto: "2026-08-01".to_string(),
    };

    let mut nova = anterior.clone();
    nova.visto = String::new(); // como viria recém-normalizada, antes do merge

    let resultado = merge(vec![nova], vec![anterior], "2026-09-09", 30);

    assert_eq!(resultado.len(), 1);
    assert_eq!(resultado[0].visto, "2026-08-01");
}

#[test]
fn filtro_do_config_desligado_deixa_tudo_passar() {
    let lic = exemplo("Coleta de resíduos sólidos urbanos", Some(9_000_000.0));

    assert!(interessa(&lic, None, &[]));
}

#[test]
fn filtro_corta_por_teto_de_valor_mas_nao_por_valor_ausente() {
    let cara = exemplo("obra", Some(2_000_000.0));
    let barata = exemplo("obra", Some(80_000.0));
    let sem_valor = exemplo("obra", None);

    assert!(!interessa(&cara, Some(500_000.0), &[]));
    assert!(interessa(&barata, Some(500_000.0), &[]));
    // Dispensa quase sempre vem sem valor estimado: reprovar seria perder
    // justamente o edital pequeno que o radar procura.
    assert!(interessa(&sem_valor, Some(500_000.0), &[]));
}

#[test]
fn filtro_por_palavra_chave_ignora_caixa() {
    let lic = exemplo("Contratação de COLETA de Resíduos", None);

    assert!(interessa(&lic, None, &["resíduos".to_string()]));
    assert!(!interessa(&lic, None, &["climatização".to_string()]));
    // Espaço em branco no config não pode virar um "contains" que casa tudo.
    assert!(!interessa(&lic, None, &["  ".to_string()]));
}

fn exemplo(objeto: &str, valor: Option<f64>) -> Licitacao {
    Licitacao {
        id: "abc-3".to_string(),
        objeto: objeto.to_string(),
        valor,
        uf: "SP".to_string(),
        municipio: "Bauru".to_string(),
        orgao: "orgao".to_string(),
        modalidade: "Pregão".to_string(),
        abertura: "2026-09-01T08:00:00".to_string(),
        encerramento: "2026-09-20T09:00:00".to_string(),
        link: String::new(),
        link_pncp: String::new(),
        visto: String::new(),
    }
}

#[test]
fn merge_descarta_registro_vencido_ha_muito_tempo() {
    let vencida = Licitacao {
        id: "abc-2".to_string(),
        objeto: "objeto".to_string(),
        valor: None,
        uf: "SP".to_string(),
        municipio: "Bauru".to_string(),
        orgao: "orgao".to_string(),
        modalidade: "Pregão".to_string(),
        abertura: "2026-01-01T08:00:00".to_string(),
        encerramento: "2026-01-10T09:00:00".to_string(),
        link: "".to_string(),
        link_pncp: "".to_string(),
        visto: "2026-01-01".to_string(),
    };

    // Sumiu da coleta atual (novas = vazio) e venceu há bem mais de 30 dias.
    let resultado = merge(vec![], vec![vencida], "2026-09-09", 30);

    assert!(resultado.is_empty());
}
