const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Nombre de jours écoulés entre une date d'échéance et une date de référence
 * (aujourd'hui par défaut). Retourne 0 tant que l'échéance n'est pas dépassée.
 *
 * La détection des retards et le calcul de la pénalité se font désormais
 * côté serveur (voir `RepaymentLateCalculator` côté backend) ; cette
 * fonction ne sert plus ici qu'à l'affichage du nombre de jours de retard.
 */
export function computeDaysLate(dueDate: string, now: Date = new Date()): number {
  const diff = now.getTime() - new Date(dueDate).getTime();
  return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}
