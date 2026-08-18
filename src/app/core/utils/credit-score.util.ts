import { CreditScoreCategory } from '../models/credit-score.model';

/**
 * Le score de solvabilité est désormais calculé et persisté côté serveur
 * (voir `CreditScoreCalculator` côté backend) ; ce fichier ne porte plus que
 * l'affichage (libellé/classe CSS) d'une catégorie déjà connue.
 */

/** Libellé français d'une catégorie de solvabilité, pour l'affichage. */
export function creditScoreCategoryLabel(category: CreditScoreCategory): string {
  switch (category) {
    case CreditScoreCategory.EXCELLENT:
      return 'Excellent';
    case CreditScoreCategory.BON:
      return 'Bon';
    case CreditScoreCategory.A_RISQUE:
      return 'À risque';
    case CreditScoreCategory.MAUVAIS_PAYEUR:
      return 'Mauvais payeur';
    default:
      return category;
  }
}

/** Classe CSS associée à une catégorie de solvabilité, pour l'affichage. */
export function creditScoreCategoryClass(category: CreditScoreCategory): string {
  switch (category) {
    case CreditScoreCategory.EXCELLENT:
      return 'score-excellent';
    case CreditScoreCategory.BON:
      return 'score-good';
    case CreditScoreCategory.A_RISQUE:
      return 'score-warning';
    case CreditScoreCategory.MAUVAIS_PAYEUR:
      return 'score-danger';
    default:
      return 'score-neutral';
  }
}
