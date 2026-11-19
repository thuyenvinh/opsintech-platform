import { enUS } from "./locales/en-US";
import { zhCN } from "./locales/zh-CN";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { vi } from "./locales/vi";
import { getEnabledLocales, type Locale } from "./locale";

export { enUS, zhCN, ja, ko, vi };
export type { Translations } from "./locales/types";
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getActiveLocale,
  getDefaultLocale,
  getEnabledLocales,
  isLocale,
  normalizeLocale,
  tr,
} from "./locale";
export type { Locale } from "./locale";

const ALL_LANGUAGE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "en-US", label: enUS.locale.localName },
  { value: "zh-CN", label: zhCN.locale.localName },
  { value: "ja", label: ja.locale.localName },
  { value: "ko", label: ko.locale.localName },
  { value: "vi", label: vi.locale.localName },
];

export function getLanguageOptions(): { value: Locale; label: string }[] {
  const enabled = new Set(getEnabledLocales());
  return ALL_LANGUAGE_OPTIONS.filter((item) => enabled.has(item.value));
}
