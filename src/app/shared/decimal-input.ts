import { Directive, ElementRef, EventEmitter, HostListener, Output, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { parseDecimale } from '../core/decimal-utils';

/**
 * Campo importo/numero che accetta sia la virgola sia il punto.
 * Sostituisce type="number": su iPhone (tastiera italiana) il tastierino
 * numerico scrive la virgola, che un input number non sa interpretare.
 *
 * - Con i form (formControlName/ngModel): il valore del controllo è
 *   number | null, come con NumberValueAccessor.
 * - Senza form: (decimaleChange) emette il numero (NaN se vuoto/non valido).
 */
@Directive({
  selector: 'input[decimale]',
  host: { type: 'text', inputmode: 'decimal', autocomplete: 'off' },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DecimalInput), multi: true }],
})
export class DecimalInput implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  @Output() decimaleChange = new EventEmitter<number>();

  private onChange: (v: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  @HostListener('input')
  onInput(): void {
    const numero = parseDecimale(this.el.nativeElement.value);
    this.decimaleChange.emit(numero);
    this.onChange(Number.isNaN(numero) ? null : numero);
  }

  @HostListener('blur')
  onBlur(): void {
    this.onTouched();
  }

  writeValue(valore: number | null): void {
    this.el.nativeElement.value = valore === null || valore === undefined ? '' : String(valore);
  }
  registerOnChange(fn: (v: number | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.el.nativeElement.disabled = disabled;
  }
}
