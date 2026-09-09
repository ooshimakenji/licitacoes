//! Junção entre a coleta atual e o JSON gravado na execução anterior.

use crate::pncp::Licitacao;
use std::collections::{HashMap, HashSet};

/// Funde `novas` (já deduplicadas por id) com `anteriores`:
/// - registro já conhecido preserva o `visto` antigo;
/// - registro novo recebe `visto = hoje`;
/// - registro que sumiu da API mas ainda não venceu, ou venceu há poucos
///   dias (dentro de `manter_vencidas_por_dias`), é mantido;
/// - registro vencido há mais tempo que isso é descartado.
pub fn merge(
    novas: Vec<Licitacao>,
    anteriores: Vec<Licitacao>,
    hoje: &str,
    manter_vencidas_por_dias: i64,
) -> Vec<Licitacao> {
    let hoje_data = parse_data(hoje);
    let visto_antigo: HashMap<&str, &str> = anteriores
        .iter()
        .map(|lic| (lic.id.as_str(), lic.visto.as_str()))
        .collect();
    // Clonado de propósito: `novas` é consumido logo abaixo e o conjunto
    // precisa sobreviver ao move.
    let ids_novos: HashSet<String> = novas.iter().map(|lic| lic.id.clone()).collect();

    let mut resultado: Vec<Licitacao> = novas
        .into_iter()
        .map(|mut lic| {
            if let Some(&visto) = visto_antigo.get(lic.id.as_str()) {
                lic.visto = visto.to_string();
            } else {
                lic.visto = hoje.to_string();
            }
            lic
        })
        .collect();

    for lic in anteriores {
        if ids_novos.contains(&lic.id) {
            continue;
        }
        let manter = match (parse_data(&lic.encerramento), hoje_data) {
            (Some(enc), Some(hj)) => {
                let dias_vencida = (hj - enc).whole_days();
                dias_vencida <= manter_vencidas_por_dias
            }
            // Não foi possível interpretar a data: mantém por segurança
            // (nunca perder dado por falha de parsing).
            _ => true,
        };
        if manter {
            resultado.push(lic);
        }
    }

    resultado
}

fn parse_data(s: &str) -> Option<time::Date> {
    let formato = time::macros::format_description!("[year]-[month]-[day]");
    time::Date::parse(&s[..10.min(s.len())], formato).ok()
}
