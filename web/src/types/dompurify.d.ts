/**
 * Type definitions for DOMPurify
 */

declare module 'dompurify' {
  export interface DOMPurifyI {
    sanitize(
      dirty: string | Node,
      options?: {
        RETURN_DOM?: boolean;
        RETURN_DOM_FRAGMENT?: boolean;
        RETURN_DOM_IMPORT?: boolean;
        ALLOWED_TAGS?: string[];
        ALLOWED_ATTR?: string[];
        FORBID_TAGS?: string[];
        FORBID_ATTR?: string[];
        USE_PROFILES?: {
          html?: boolean;
          svg?: boolean;
          svgFilters?: boolean;
          mathMl?: boolean;
        };
        ADD_URI_SAFE_ATTR?: string[];
        ADD_TAGS?: string[];
        [key: string]: any;
      },
    ): string | Node;
    setConfig(config: object): DOMPurifyI;
    clearConfig(): void;
    isValidAttribute(tag: string, attr: string, value: string): boolean;
    addHook(hook: string, cb: (...args: any[]) => any): DOMPurifyI;
    removeHook(hook: string): DOMPurifyI;
    removeHooks(hook: string): DOMPurifyI;
    removeAllHooks(): DOMPurifyI;
    VERSION: string;
  }

  const DOMPurify: DOMPurifyI;
  export default DOMPurify;
}
