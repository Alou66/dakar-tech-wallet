import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, retry, timer } from 'rxjs';

import { AdminLoansManagementData, DashboardService } from '../../../core/services/dashboard.service';
import { LoanService } from '../../../core/services/loan.service';
import { RepaymentService } from '../../../core/services/repayment.service';
import { UserService } from '../../../core/services/user.service';
import { TransactionService } from '../../../core/services/transaction.service';
import { AuthService } from '../../../core/services/auth.service';
import { Loan, LoanStatus } from '../../../core/models/loan.model';
import { User, UserStatus } from '../../../core/models/user.model';
import { CreditScore, CreditScoreCategory } from '../../../core/models/credit-score.model';
import { TransactionStatus, TransactionType } from '../../../core/models/transaction.model';
import { creditScoreCategoryClass, creditScoreCategoryLabel } from '../../../core/utils/credit-score.util';
import { scheduleTotalDue } from '../../../core/utils/loan-schedule.util';

type StatusFilter = LoanStatus | 'ALL';
type CategoryFilter = CreditScoreCategory | 'ALL';
type PendingAction = { loanId: string; action: 'approve' | 'reject' | 'resume-schedule' };

/**
 * json-server (--watch) recharge brièvement son routeur après chaque
 * écriture : une requête qui en suit une autre de très près peut tomber
 * pendant cette fenêtre et échouer avec une erreur de connexion. On
 * ré-essaie donc quelques fois avec un court délai croissant plutôt que de
 * remonter l'échec immédiatement.
 */
const ACTIVATION_RETRY_ATTEMPTS = 3;
const ACTIVATION_RETRY_BASE_DELAY_MS = 200;

@Component({
  selector: 'app-admin-loans',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-loans.component.html',
  styleUrl: './admin-loans.component.css',
})
export class AdminLoansComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly loanService = inject(LoanService);
  private readonly repaymentService = inject(RepaymentService);
  private readonly userService = inject(UserService);
  private readonly transactionService = inject(TransactionService);
  private readonly authService = inject(AuthService);

  readonly LoanStatus = LoanStatus;
  readonly CreditScoreCategory = CreditScoreCategory;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly data = signal<AdminLoansManagementData | null>(null);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<StatusFilter>('ALL');
  readonly categoryFilter = signal<CategoryFilter>('ALL');

  readonly pendingAction = signal<PendingAction | null>(null);
  readonly actionSubmitting = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly actionSuccess = signal<string | null>(null);

  readonly hasLoans = computed(() => (this.data()?.loans.length ?? 0) > 0);

  private readonly usersById = computed(() => {
    const map = new Map<string, User>();
    for (const user of this.data()?.users ?? []) {
      map.set(user.id, user);
    }
    return map;
  });

  private readonly creditScoreByUserId = computed(() => {
    const map = new Map<string, CreditScore>();
    for (const score of this.data()?.creditScores ?? []) {
      map.set(score.userId, score);
    }
    return map;
  });

  readonly filteredLoans = computed(() => {
    const loans = this.data()?.loans ?? [];
    const term = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();
    const category = this.categoryFilter();
    const usersById = this.usersById();
    const creditScoreByUserId = this.creditScoreByUserId();

    return loans
      .filter((loan) => {
        if (status !== 'ALL' && loan.status !== status) return false;

        if (category !== 'ALL') {
          const score = creditScoreByUserId.get(loan.userId);
          if (!score || score.category !== category) return false;
        }

        if (term) {
          const user = usersById.get(loan.userId);
          if (!this.userMatchesTerm(user, term)) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());
  });

  readonly hasFilteredResults = computed(() => this.filteredLoans().length > 0);

  readonly hasActiveFilters = computed(
    () => this.searchTerm().trim() !== '' || this.statusFilter() !== 'ALL' || this.categoryFilter() !== 'ALL',
  );

  readonly pendingActionLoan = computed(() => {
    const pending = this.pendingAction();
    if (!pending) return null;
    return this.data()?.loans.find((loan) => loan.id === pending.loanId) ?? null;
  });

  ngOnInit(): void {
    this.load();
  }

  retry(): void {
    this.load();
  }

  onSearchChange(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  onStatusFilterChange(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value as StatusFilter);
  }

  onCategoryFilterChange(event: Event): void {
    this.categoryFilter.set((event.target as HTMLSelectElement).value as CategoryFilter);
  }

  resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('ALL');
    this.categoryFilter.set('ALL');
  }

  userFor(userId: string): User | undefined {
    return this.usersById().get(userId);
  }

  userLabel(userId: string): string {
    const user = this.userFor(userId);
    return user ? `${user.firstName} ${user.lastName}` : '—';
  }

  userAccountNumber(userId: string): string | undefined {
    return this.userFor(userId)?.accountNumber;
  }

  creditScoreFor(userId: string): CreditScore | undefined {
    return this.creditScoreByUserId().get(userId);
  }

  isPending(loan: Loan): boolean {
    return loan.status === LoanStatus.EN_ATTENTE;
  }

  /**
   * Un prêt reste au statut APPROUVE (au lieu de passer en EN_COURS) si la
   * génération de son échéancier a échoué après l'approbation et le
   * décaissement (voir `activateLoan`). Cette action permet à l'admin de
   * reprendre uniquement cette étape, sans jamais recréditer le
   * portefeuille ni recréer de transaction de décaissement.
   */
  canResumeSchedule(loan: Loan): boolean {
    return loan.status === LoanStatus.APPROUVE;
  }

  requestApprove(loan: Loan): void {
    if (!this.isPending(loan) || this.actionSubmitting()) return;
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.pendingAction.set({ loanId: loan.id, action: 'approve' });
  }

  requestReject(loan: Loan): void {
    if (!this.isPending(loan) || this.actionSubmitting()) return;
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.pendingAction.set({ loanId: loan.id, action: 'reject' });
  }

  requestResumeSchedule(loan: Loan): void {
    if (!this.canResumeSchedule(loan) || this.actionSubmitting()) return;
    this.actionError.set(null);
    this.actionSuccess.set(null);
    this.pendingAction.set({ loanId: loan.id, action: 'resume-schedule' });
  }

  cancelAction(): void {
    if (this.actionSubmitting()) return;
    this.pendingAction.set(null);
    this.actionError.set(null);
  }

  confirmAction(): void {
    const pending = this.pendingAction();
    if (!pending || this.actionSubmitting()) return;

    if (pending.action === 'resume-schedule') {
      this.confirmResumeSchedule(pending.loanId);
      return;
    }

    const admin = this.authService.getCurrentUser();
    if (!admin) {
      this.actionError.set('Administrateur non connecté.');
      return;
    }

    this.actionSubmitting.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);

    // JSON Server ne garantit aucune atomicité entre requêtes : on relit le
    // prêt côté serveur juste avant de le traiter, pour ne pas se fier à un
    // état local qui pourrait être périmé et éviter une double
    // validation/rejet si la demande a déjà été traitée entre-temps.
    this.loanService.getById(pending.loanId).subscribe({
      next: (freshLoan) => {
        if (freshLoan.status !== LoanStatus.EN_ATTENTE) {
          this.patchLoanInData(freshLoan);
          this.actionError.set('Cette demande a déjà été traitée.');
          this.actionSubmitting.set(false);
          this.pendingAction.set(null);
          return;
        }

        if (pending.action === 'approve') {
          this.approveLoan(freshLoan, admin.id);
        } else {
          this.rejectLoan(freshLoan, admin.id);
        }
      },
      error: () => {
        this.actionError.set('Impossible de vérifier l’état de la demande. Veuillez réessayer.');
        this.actionSubmitting.set(false);
      },
    });
  }

  private approveLoan(freshLoan: Loan, adminId: string): void {
    this.userService.getById(freshLoan.userId).subscribe({
      next: (freshUser) => {
        // Le client est revérifié côté serveur juste avant d'approuver et de
        // décaisser : un compte suspendu entre-temps (ex. depuis la demande)
        // ne doit jamais recevoir de prêt.
        if (freshUser.status === UserStatus.SUSPENDED) {
          this.actionError.set('Ce client est suspendu : impossible d’approuver ou de décaisser ce prêt.');
          this.actionSubmitting.set(false);
          this.pendingAction.set(null);
          return;
        }

        const now = new Date().toISOString();

        this.loanService
          .update(freshLoan.id, {
            status: LoanStatus.APPROUVE,
            approvedBy: adminId,
            approvalDate: now,
          })
          .subscribe({
            next: (updatedLoan) => {
              // Le statut du prêt est déjà acquis côté serveur à ce stade :
              // on l'applique immédiatement dans `data`, indépendamment du
              // résultat du décaissement ci-dessous.
              this.patchLoanInData(updatedLoan);

              // La transaction est créée avant le crédit du portefeuille (et
              // non en parallèle) afin de toujours savoir, en cas d'échec,
              // laquelle des deux écritures a réellement abouti : si le
              // crédit échoue, on corrige explicitement son statut en
              // ECHOUEE plutôt que de laisser un décaissement "réussi" sans
              // crédit du client (voir `TransactionStatus`).
              this.transactionService
                .create({
                  type: TransactionType.DECAISSEMENT_PRET,
                  status: TransactionStatus.REUSSIE,
                  amount: freshLoan.amount,
                  receiverId: freshUser.id,
                  relatedLoanId: freshLoan.id,
                  description: `Décaissement prêt ${freshLoan.purpose ?? freshLoan.id}`,
                })
                .subscribe({
                  next: (createdTransaction) => {
                    this.userService
                      .update(freshUser.id, { walletBalance: freshUser.walletBalance + freshLoan.amount })
                      .subscribe({
                        next: (user) => {
                          this.patchUserInData(user);
                          this.activateLoan(freshLoan, now);
                        },
                        error: () => {
                          this.transactionService
                            .update(createdTransaction.id, { status: TransactionStatus.ECHOUEE })
                            .subscribe();
                          this.actionError.set(
                            'Le prêt a été approuvé mais le décaissement (crédit du portefeuille) a échoué. Vérifiez le compte client et réessayez si besoin.',
                          );
                          this.actionSubmitting.set(false);
                          this.pendingAction.set(null);
                        },
                      });
                  },
                  error: () => {
                    this.actionError.set(
                      'Le prêt a été approuvé mais le décaissement (création de la transaction) a échoué. Vérifiez le compte client et réessayez si besoin.',
                    );
                    this.actionSubmitting.set(false);
                    this.pendingAction.set(null);
                  },
                });
            },
            error: () => {
              this.actionError.set('Impossible de valider la demande. Veuillez réessayer.');
              this.actionSubmitting.set(false);
            },
          });
      },
      error: () => {
        this.actionError.set('Impossible de récupérer le compte du client. Veuillez réessayer.');
        this.actionSubmitting.set(false);
      },
    });
  }

  /**
   * Une fois le prêt décaissé, génère son échéancier (une échéance PLANIFIE
   * par mois de `durationMonths`) et fait passer le prêt d'APPROUVE à
   * EN_COURS, avec `startDate` et un `remainingBalance` égal au total
   * réellement dû (capital + intérêts), cohérent avec la somme des
   * échéances générées.
   *
   * `createSchedule` est idempotente (elle ne recrée jamais une échéance
   * déjà persistée) et le PATCH du prêt l'est tout autant (il réapplique
   * les mêmes valeurs) : cette étape peut donc être rappelée sans risque,
   * que ce soit via le retry automatique ci-dessous ou via
   * `confirmResumeSchedule` après un échec définitif.
   */
  private activateLoan(freshLoan: Loan, startDate: string): void {
    forkJoin({
      schedule: this.repaymentService.createSchedule(freshLoan, new Date(startDate)),
      loan: this.loanService
        .update(freshLoan.id, {
          status: LoanStatus.EN_COURS,
          startDate,
          remainingBalance: scheduleTotalDue(freshLoan),
        })
        .pipe(
          retry({
            count: ACTIVATION_RETRY_ATTEMPTS,
            delay: (_error, retryCount) => timer(ACTIVATION_RETRY_BASE_DELAY_MS * retryCount),
          }),
        ),
    }).subscribe({
      next: ({ loan }) => {
        this.patchLoanInData(loan);
        this.actionSuccess.set('Demande validée : le prêt a été approuvé, décaissé et son échéancier généré.');
        this.actionSubmitting.set(false);
        this.pendingAction.set(null);
      },
      error: () => {
        this.actionError.set(
          'Le prêt a été approuvé et décaissé, mais la génération de l’échéancier a échoué. Cliquez sur « Générer l’échéancier » pour réessayer sans risque de double décaissement.',
        );
        this.actionSubmitting.set(false);
        this.pendingAction.set(null);
      },
    });
  }

  /**
   * Reprend uniquement la génération de l'échéancier d'un prêt resté
   * bloqué à APPROUVE après un échec de `activateLoan`. Ne touche jamais au
   * portefeuille ni ne crée de nouvelle transaction : on vérifie d'abord
   * qu'un décaissement REUSSIE existe déjà pour ce prêt avant de
   * poursuivre, pour ne jamais faire passer en EN_COURS un prêt qui
   * n'aurait en réalité jamais été décaissé.
   */
  private confirmResumeSchedule(loanId: string): void {
    this.actionSubmitting.set(true);
    this.actionError.set(null);
    this.actionSuccess.set(null);

    this.loanService.getById(loanId).subscribe({
      next: (freshLoan) => {
        if (freshLoan.status !== LoanStatus.APPROUVE) {
          this.patchLoanInData(freshLoan);
          this.actionError.set('Ce prêt n’est plus en attente de génération d’échéancier.');
          this.actionSubmitting.set(false);
          this.pendingAction.set(null);
          return;
        }

        this.transactionService.getByLoan(freshLoan.id).subscribe({
          next: (transactions) => {
            const disbursed = transactions.some(
              (transaction) =>
                transaction.type === TransactionType.DECAISSEMENT_PRET &&
                transaction.status === TransactionStatus.REUSSIE,
            );

            if (!disbursed) {
              this.actionError.set(
                'Aucun décaissement confirmé n’a été trouvé pour ce prêt : la génération de l’échéancier ne peut pas être reprise automatiquement.',
              );
              this.actionSubmitting.set(false);
              this.pendingAction.set(null);
              return;
            }

            this.activateLoan(freshLoan, freshLoan.approvalDate ?? new Date().toISOString());
          },
          error: () => {
            this.actionError.set('Impossible de vérifier le décaissement de ce prêt. Veuillez réessayer.');
            this.actionSubmitting.set(false);
          },
        });
      },
      error: () => {
        this.actionError.set('Impossible de vérifier l’état de ce prêt. Veuillez réessayer.');
        this.actionSubmitting.set(false);
      },
    });
  }

  private rejectLoan(freshLoan: Loan, adminId: string): void {
    this.loanService.update(freshLoan.id, { status: LoanStatus.REJETE, approvedBy: adminId }).subscribe({
      next: (updatedLoan) => {
        this.patchLoanInData(updatedLoan);
        this.actionSuccess.set('Demande rejetée.');
        this.actionSubmitting.set(false);
        this.pendingAction.set(null);
      },
      error: () => {
        this.actionError.set('Impossible de rejeter la demande. Veuillez réessayer.');
        this.actionSubmitting.set(false);
      },
    });
  }

  /**
   * Applique dans `data` le prêt et/ou le client tels que renvoyés par le
   * serveur après une requête réussie. On évite volontairement de tout
   * recharger via `getAdminLoansManagement()` après une action : JSON
   * Server (--watch) redémarre brièvement après chaque écriture, ce qui
   * peut faire échouer une relecture immédiate et laisser l'écran affiché
   * incohérent avec le succès annoncé, alors que le résultat de la requête
   * qui vient de réussir est, lui, fiable.
   */
  private patchLoanInData(loan: Loan): void {
    this.data.update((current) =>
      current ? { ...current, loans: current.loans.map((l) => (l.id === loan.id ? loan : l)) } : current,
    );
  }

  private patchUserInData(user: User): void {
    this.data.update((current) =>
      current ? { ...current, users: current.users.map((u) => (u.id === user.id ? user : u)) } : current,
    );
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value) + ' FCFA';
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  statusLabel(status: LoanStatus): string {
    switch (status) {
      case LoanStatus.EN_ATTENTE:
        return 'En attente';
      case LoanStatus.APPROUVE:
        return 'Approuvé';
      case LoanStatus.REJETE:
        return 'Rejeté';
      case LoanStatus.EN_COURS:
        return 'En cours';
      case LoanStatus.EN_RETARD:
        return 'En retard';
      case LoanStatus.REMBOURSE:
        return 'Remboursé';
      default:
        return status;
    }
  }

  statusClass(status: LoanStatus): string {
    switch (status) {
      case LoanStatus.EN_ATTENTE:
        return 'badge-warning';
      case LoanStatus.APPROUVE:
        return 'badge-info';
      case LoanStatus.EN_COURS:
        return 'badge-active';
      case LoanStatus.EN_RETARD:
        return 'badge-danger';
      case LoanStatus.REMBOURSE:
        return 'badge-success';
      case LoanStatus.REJETE:
        return 'badge-neutral';
      default:
        return 'badge-neutral';
    }
  }

  creditScoreCategoryLabel(category: CreditScoreCategory): string {
    return creditScoreCategoryLabel(category);
  }

  creditScoreCategoryClass(category: CreditScoreCategory): string {
    return creditScoreCategoryClass(category);
  }

  private userMatchesTerm(user: User | undefined, term: string): boolean {
    if (!user) return false;
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    return (
      fullName.includes(term) ||
      user.email.toLowerCase().includes(term) ||
      user.accountNumber.toLowerCase().includes(term)
    );
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pendingAction.set(null);
    this.actionError.set(null);
    this.actionSuccess.set(null);

    this.dashboardService.getAdminLoansManagement().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Impossible de charger la liste des prêts.');
        this.loading.set(false);
      },
    });
  }
}
