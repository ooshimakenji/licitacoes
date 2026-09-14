/// Saúde dos dados: o painel precisa dizer sozinho quando a automação parou.
///
/// Descobri que o enriquecimento nunca havia rodado só porque fui olhar os
/// workflows por fora — a tela não contava nada. Esta regra existe para isso
/// não depender de eu ir conferir.

/// Acima disso a coleta provavelmente falhou: ela roda todo dia às 9h UTC, e
/// 2 dias já cobre um fim de semana com um agendamento perdido.
export const DIAS_ATE_ALERTAR = 2;

export function diasDesde(iso, agora = Date.now()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((agora - d.getTime()) / 86400000);
}

/// A data que vale é a da coleta. `gerado_em` é o fallback para o index antigo,
/// publicado antes das datas por etapa existirem.
export function dadosVelhos(indice, agora = Date.now()) {
  const dias = diasDesde(indice?.ultima_coleta || indice?.gerado_em, agora);
  return dias != null && dias > DIAS_ATE_ALERTAR ? dias : null;
}
