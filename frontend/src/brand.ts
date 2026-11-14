// Конфиг бренда клиники — единственное место для замены данных клиники.
// Логотип: assets/spektr-logo.png (тил + красный, фирстиль spdmed.ru).
import logoUrl from './assets/spektr-logo.png'

export const brand = {
  name: 'Спектр-Диагностика',
  subtitle: 'Федеральная сеть медицинских центров',
  phone: '+7 (939) 441-03-38',
  site: 'spdmed.ru',
  siteUrl: 'https://spdmed.ru',
  logo: logoUrl,
}

// Поддомены городов реального сайта (снято со spdmed.ru, 2026-11-14):
// на каждом поддомене живёт онлайн-запись к врачам (виджет booking.spdmed.ru).
const CITY_SUBDOMAINS: Record<string, string> = {
  'Белая Калитва': 'belaya-kalitva',
  'Белгород': 'belgorod',
  'Брянск': 'bryansk',
  'Бутурлиновка': 'buturlinovka',
  'Вязьма': 'vyazma',
  'Воронеж': 'voronezh',
  'Калининград': 'kaliningrad',
  'Калуга': 'kaluga',
  'Каменск-Шахтинский': 'kamensk-shahtinskiy',
  'Клинцы': 'klintsyi',
  'Михайловка': 'mihaylovka',
  'Россошь': 'rossosh',
  'Сочи': 'sochi',
  'Таганрог': 'taganrog',
  'Тамбов': 'tambov',
}

/** Ссылка на сайт клиники города — там онлайн-запись к реальным врачам. */
export function clinicCityUrl(city?: string | null): string {
  const sub = city ? CITY_SUBDOMAINS[city] : undefined
  return sub ? `https://${sub}.spdmed.ru` : brand.siteUrl
}
