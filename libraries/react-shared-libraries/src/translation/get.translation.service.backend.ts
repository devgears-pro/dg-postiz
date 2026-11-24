import i18next from './i18next';
import { fallbackLng, cookieName, headerName } from './i18n.config';
import { cookies, headers } from 'next/headers';

export async function getT(ns?: string, options?: any) {
  if (ns && !i18next.hasLoadedNamespace(ns)) {
    await i18next.loadNamespaces(ns);
  }

  let currentLang = i18next.resolvedLanguage;
  try {
    const cookieStore = await cookies();
    const cookieLang = cookieStore.get(cookieName)?.value;
    if (cookieLang) {
      currentLang = cookieLang;
    } else {
      const headerList = await headers();
      const headerLang = headerList.get(headerName);
      if (headerLang) {
        currentLang = headerLang;
      }
    }
  } catch (e) {
    // Outside request context
  }

  return i18next.getFixedT(
    currentLang || fallbackLng,
    Array.isArray(ns) ? ns[0] : ns,
    options?.keyPrefix
  );
}
