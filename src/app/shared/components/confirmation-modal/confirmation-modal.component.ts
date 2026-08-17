import { Component, HostListener, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ConfirmationDetail {
  label: string;
  value: string;
}

/**
 * Modal de confirmation générique et réutilisable pour toute opération
 * financière irréversible (demande de prêt, virement, remboursement...).
 * Le parent garde l'entière responsabilité de la logique métier : ce
 * composant ne fait qu'afficher un récapitulatif et notifier `confirm`/
 * `cancel`, sans jamais appeler de service lui-même.
 */
@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirmation-modal.component.html',
  styleUrl: './confirmation-modal.component.css',
})
export class ConfirmationModalComponent {
  readonly open = input(false);
  readonly title = input("Confirmer l'opération");
  readonly message = input<string | null>(null);
  readonly details = input<ConfirmationDetail[]>([]);
  readonly confirmLabel = input('Confirmer');
  readonly cancelLabel = input('Annuler');
  readonly loading = input(false);

  readonly confirm = output<void>();
  readonly cancel = output<void>();

  /**
   * Protection locale contre le double-clic : indépendante du signal
   * `loading` du parent (qui ne repasse à `true` qu'après un aller-retour de
   * detection de changement), elle bloque toute émission supplémentaire de
   * `confirm` dès le tout premier clic, pour la durée de cette ouverture.
   */
  private readonly confirmRequested = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        this.confirmRequested.set(false);
      }
    });
  }

  onConfirm(): void {
    if (this.loading() || this.confirmRequested()) return;
    this.confirmRequested.set(true);
    this.confirm.emit();
  }

  onCancel(): void {
    if (this.loading()) return;
    this.cancel.emit();
  }

  onBackdropClick(): void {
    this.onCancel();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.open()) return;
    this.onCancel();
  }
}
