import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Valide que `confirmControlName` reprend exactement `controlName`, en posant l'erreur sur le champ de confirmation. */
export function passwordMatchValidator(controlName: string, confirmControlName: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const control = group.get(controlName);
    const confirmControl = group.get(confirmControlName);

    if (!control || !confirmControl) {
      return null;
    }

    if (confirmControl.value !== control.value) {
      confirmControl.setErrors({ ...confirmControl.errors, passwordMismatch: true });
    } else if (confirmControl.hasError('passwordMismatch')) {
      const { passwordMismatch, ...rest } = confirmControl.errors ?? {};
      confirmControl.setErrors(Object.keys(rest).length ? rest : null);
    }

    return null;
  };
}
