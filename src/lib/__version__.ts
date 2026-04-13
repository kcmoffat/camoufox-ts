export const CONSTRAINTS = {
  MIN_VERSION: "alpha.1",
  MAX_VERSION: "1",
  asRange(): string {
    return `>=${this.MIN_VERSION}, <${this.MAX_VERSION}`;
  },
} as const;
