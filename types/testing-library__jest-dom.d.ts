/**
 * Type definitions for @testing-library/jest-dom
 */

// This allows TypeScript to pick up the magic declaration in the same way that it picks up the built-in DOM declarations.
// See: https://github.com/microsoft/TypeScript/blob/01ccf18826fc9792fb03d37a4d8a93afa1a0d722/src/lib/dom.generated.d.ts#L21263-L21273
interface JestMatchers<R> {
  toBeInTheDocument(): R;
  toBeVisible(): R;
  toBeEmpty(): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toBeInvalid(): R;
  toBeRequired(): R;
  toBeValid(): R;
  toContainElement(element: HTMLElement | SVGElement | null): R;
  toContainHTML(htmlText: string): R;
  toHaveAccessibleDescription(
    expectedAccessibleDescription?: string | RegExp,
  ): R;
  toHaveAccessibleName(expectedAccessibleName?: string | RegExp): R;
  toHaveAttribute(attr: string, value?: any): R;
  toHaveClass(...classNames: string[]): R;
  toHaveFocus(): R;
  toHaveFormValues(expectedValues: Record<string, any>): R;
  toHaveStyle(css: string | Record<string, any>): R;
  toHaveTextContent(
    text: string | RegExp,
    options?: { normalizeWhitespace: boolean },
  ): R;
  toHaveValue(value?: string | string[] | number): R;
  toBeChecked(): R;
  toBePartiallyChecked(): R;
  toHaveDescription(expectedDescription?: string | RegExp): R;
}
