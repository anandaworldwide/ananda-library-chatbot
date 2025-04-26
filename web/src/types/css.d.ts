declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

// Declare Tailwind directives as valid CSS at-rules
declare module 'postcss' {
  export interface AtRule {
    name: string;
    params: string;
    nodes: any[];
  }
}
