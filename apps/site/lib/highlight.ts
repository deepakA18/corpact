import { codeToHtml } from 'shiki';
import { CODE_THEMES } from './docs';

/** Dual-theme highlighted HTML; colours switch with the site theme via CSS variables. */
export function highlight(code: string, lang: string): Promise<string> {
  return codeToHtml(code.trim(), { lang, themes: CODE_THEMES, defaultColor: false });
}
