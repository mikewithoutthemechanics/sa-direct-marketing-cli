/**
 * Minimal type declarations for the vendored SheetJS build.
 * The vendored package ships no .d.ts, so we declare only the surface
 * this project actually uses. Keep in sync with usage.
 */
declare module "*/vendor/xlsx/xlsx.js" {
  export interface WorkSheet {
    [cell: string]: unknown;
    "!ref"?: string;
  }
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export interface Sheet2JSONOpts {
    header?: 1 | "A";
    raw?: boolean;
    defval?: unknown;
  }
  export const utils: {
    book_new(): WorkBook;
    book_append_sheet(wb: WorkBook, ws: WorkSheet, name: string): void;
    sheet_to_json(ws: WorkSheet, opts?: Sheet2JSONOpts): unknown;
    aoa_to_sheet(rows: unknown[][]): WorkSheet;
  };
  export function readFile(path: string): WorkBook;
  export function writeFile(wb: WorkBook, path: string): void;
  export const version: string;
}