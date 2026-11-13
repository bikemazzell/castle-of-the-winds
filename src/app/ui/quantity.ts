/** Shared integer quantity control. Invalid typed values remain visible for correction. */
export function quantityControl(options: {
  field: string; max: number; value?: number; disabled?: boolean;
  onChange: (value: number, valid: boolean) => void;
}): { el: HTMLElement; input: HTMLInputElement } {
  const el = document.createElement('div');
  el.className = 'merchant-quantity quantity-control';
  const label = document.createElement('label');
  label.textContent = 'Quantity';
  const input = document.createElement('input');
  input.type = 'number'; input.min = '1'; input.max = String(options.max); input.step = '1';
  input.value = String(options.value ?? 1); input.dataset.field = options.field;
  input.disabled = !!options.disabled;
  label.append(input);
  const minus = document.createElement('button');
  const plus = document.createElement('button');
  minus.type = plus.type = 'button';
  minus.textContent = '−'; plus.textContent = '+';
  minus.dataset.action = 'quantity-minus'; plus.dataset.action = 'quantity-plus';
  minus.setAttribute('aria-label', 'Decrease quantity'); plus.setAttribute('aria-label', 'Increase quantity');
  const update = (): void => {
    const value = input.valueAsNumber;
    const valid = Number.isInteger(value) && value >= 1 && value <= options.max;
    input.setAttribute('aria-invalid', String(!valid));
    minus.disabled = !!options.disabled || value <= 1;
    plus.disabled = !!options.disabled || value >= options.max;
    options.onChange(value, valid);
  };
  input.addEventListener('input', update);
  for (const [button, delta] of [[minus, -1], [plus, 1]] as const) {
    button.addEventListener('click', () => {
      const value = input.valueAsNumber;
      input.value = String(Math.max(1, Math.min(options.max, Number.isFinite(value) ? Math.floor(value) + delta : 1)));
      update();
    });
  }
  el.append(minus, label, plus); update();
  return { el, input };
}
