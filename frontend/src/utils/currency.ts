/**
 * Currency Utilities
 * Centralized currency code to symbol mapping for frontend
 */

// Currency code to symbol mapping
const CURRENCY_MAP: Record<string, string> = {
  BDT: "৳", // Bangladeshi Taka
  USD: "$", // US Dollar
  EUR: "€", // Euro
  GBP: "£", // British Pound
  INR: "₹", // Indian Rupee
  PKR: "₨", // Pakistani Rupee
  AED: "د.إ", // UAE Dirham
  SAR: "﷼", // Saudi Riyal
  QAR: "﷼", // Qatari Riyal
  KWD: "د.ك", // Kuwaiti Dinar
  OMR: "﷼", // Omani Rial
  BHD: ".د.ب", // Bahraini Dinar
  JPY: "¥", // Japanese Yen
  CNY: "¥", // Chinese Yuan
  KRW: "₩", // South Korean Won
  SGD: "S$", // Singapore Dollar
  MYR: "RM", // Malaysian Ringgit
  THB: "฿", // Thai Baht
  IDR: "Rp", // Indonesian Rupiah
  PHP: "₱", // Philippine Peso
  VND: "₫", // Vietnamese Dong
  AUD: "A$", // Australian Dollar
  NZD: "NZ$", // New Zealand Dollar
  CAD: "C$", // Canadian Dollar
  CHF: "CHF", // Swiss Franc
  NOK: "kr", // Norwegian Krone
  SEK: "kr", // Swedish Krona
  DKK: "kr", // Danish Krone
  ZAR: "R", // South African Rand
  BRL: "R$", // Brazilian Real
  MXN: "$", // Mexican Peso
  ARS: "$", // Argentine Peso
  CLP: "$", // Chilean Peso
  COP: "$", // Colombian Peso
  PEN: "S/.", // Peruvian Sol
  TRY: "₺", // Turkish Lira
  RUB: "₽", // Russian Ruble
  PLN: "zł", // Polish Zloty
  CZK: "Kč", // Czech Koruna
  HUF: "Ft", // Hungarian Forint
  RON: "lei", // Romanian Leu
  BGN: "лв", // Bulgarian Lev
  HRK: "kn", // Croatian Kuna
  ILS: "₪", // Israeli Shekel
  EGP: "£", // Egyptian Pound
  NGN: "₦", // Nigerian Naira
  KES: "KSh", // Kenyan Shilling
  UGX: "USh", // Ugandan Shilling
  TZS: "TSh", // Tanzanian Shilling
  ETB: "Br", // Ethiopian Birr
  GHS: "GH₵", // Ghanaian Cedi
  XAF: "FCFA", // Central African CFA Franc
  XOF: "CFA", // West African CFA Franc
  MAD: "د.م.", // Moroccan Dirham
  TND: "د.ت", // Tunisian Dinar
  DZD: "د.ج", // Algerian Dinar
  LBP: "£", // Lebanese Pound
  JOD: "د.ا", // Jordanian Dinar
  IQD: "ع.د", // Iraqi Dinar
  IRR: "﷼", // Iranian Rial
  AFN: "؋", // Afghan Afghani
  NPR: "₨", // Nepalese Rupee
  LKR: "Rs", // Sri Lankan Rupee
  MMK: "K", // Myanmar Kyat
  KHR: "៛", // Cambodian Riel
  LAK: "₭", // Lao Kip
  MNT: "₮", // Mongolian Tugrik
  KZT: "₸", // Kazakhstani Tenge
  UZS: "лв", // Uzbekistani Som
  AZN: "₼", // Azerbaijani Manat
  AMD: "֏", // Armenian Dram
  GEL: "₾", // Georgian Lari
  BYN: "Br", // Belarusian Ruble
  MDL: "lei", // Moldovan Leu
  UAH: "₴", // Ukrainian Hryvnia
  KGS: "сом", // Kyrgyzstani Som
  TJS: "ЅМ", // Tajikistani Somoni
  TMT: "m", // Turkmenistani Manat
}

// Currency names
const CURRENCY_NAMES: Record<string, string> = {
  BDT: "Bangladeshi Taka",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  INR: "Indian Rupee",
  PKR: "Pakistani Rupee",
  AED: "UAE Dirham",
  SAR: "Saudi Riyal",
  QAR: "Qatari Riyal",
  KWD: "Kuwaiti Dinar",
  OMR: "Omani Rial",
  BHD: "Bahraini Dinar",
  JPY: "Japanese Yen",
  CNY: "Chinese Yuan",
  KRW: "South Korean Won",
  SGD: "Singapore Dollar",
  MYR: "Malaysian Ringgit",
  THB: "Thai Baht",
  IDR: "Indonesian Rupiah",
  PHP: "Philippine Peso",
  VND: "Vietnamese Dong",
  AUD: "Australian Dollar",
  NZD: "New Zealand Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  NOK: "Norwegian Krone",
  SEK: "Swedish Krona",
  DKK: "Danish Krone",
  ZAR: "South African Rand",
  BRL: "Brazilian Real",
  MXN: "Mexican Peso",
  ARS: "Argentine Peso",
  CLP: "Chilean Peso",
  COP: "Colombian Peso",
  PEN: "Peruvian Sol",
  TRY: "Turkish Lira",
  RUB: "Russian Ruble",
  PLN: "Polish Zloty",
  CZK: "Czech Koruna",
  HUF: "Hungarian Forint",
  RON: "Romanian Leu",
  BGN: "Bulgarian Lev",
  HRK: "Croatian Kuna",
  ILS: "Israeli Shekel",
  EGP: "Egyptian Pound",
  NGN: "Nigerian Naira",
  KES: "Kenyan Shilling",
  UGX: "Ugandan Shilling",
  TZS: "Tanzanian Shilling",
  ETB: "Ethiopian Birr",
  GHS: "Ghanaian Cedi",
  XAF: "Central African CFA Franc",
  XOF: "West African CFA Franc",
  MAD: "Moroccan Dirham",
  TND: "Tunisian Dinar",
  DZD: "Algerian Dinar",
  LBP: "Lebanese Pound",
  JOD: "Jordanian Dinar",
  IQD: "Iraqi Dinar",
  IRR: "Iranian Rial",
  AFN: "Afghan Afghani",
  NPR: "Nepalese Rupee",
  LKR: "Sri Lankan Rupee",
  MMK: "Myanmar Kyat",
  KHR: "Cambodian Riel",
  LAK: "Lao Kip",
  MNT: "Mongolian Tugrik",
  KZT: "Kazakhstani Tenge",
  UZS: "Uzbekistani Som",
  AZN: "Azerbaijani Manat",
  AMD: "Armenian Dram",
  GEL: "Georgian Lari",
  BYN: "Belarusian Ruble",
  MDL: "Moldovan Leu",
  UAH: "Ukrainian Hryvnia",
  KGS: "Kyrgyzstani Som",
  TJS: "Tajikistani Somoni",
  TMT: "Turkmenistani Manat",
}

/**
 * Get currency symbol from currency code
 * @param currencyCode ISO 4217 currency code (e.g., "BDT", "USD")
 * @returns Currency symbol (e.g., "৳", "$")
 */
export function getCurrencySymbol(currencyCode: string = "BDT"): string {
  if (!currencyCode) {
    return "৳" // Default to BDT symbol
  }
  const code = currencyCode.toUpperCase().trim()
  return CURRENCY_MAP[code] || code
}

/**
 * Get currency name from currency code
 * @param currencyCode ISO 4217 currency code (e.g., "BDT", "USD")
 * @returns Currency name (e.g., "Bangladeshi Taka", "US Dollar")
 */
export function getCurrencyName(currencyCode: string = "BDT"): string {
  if (!currencyCode) {
    return "Bangladeshi Taka"
  }
  const code = currencyCode.toUpperCase().trim()
  return CURRENCY_NAMES[code] || code
}

/** ECMAScript / Intl: fraction digits must be integers in 0..20 */
function normalizeFractionDigits(decimals: unknown, fallback: number = 2): number {
  const raw = typeof decimals === "number" ? decimals : Number(decimals)
  if (!Number.isFinite(raw)) return fallback
  return Math.max(0, Math.min(20, Math.trunc(raw)))
}

function parseAmountToNumber(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined || amount === "") return NaN
  if (typeof amount === "number") return amount
  const cleaned = String(amount).trim().replace(/,/g, "")
  return parseFloat(cleaned)
}

/**
 * Round to a fixed number of decimal places (half-up via `toFixed`).
 */
export function roundToDecimals(
  amount: number | string | null | undefined,
  decimals: number = 2
): number {
  const d = normalizeFractionDigits(decimals, 2)
  const numAmount = parseAmountToNumber(amount)
  if (!Number.isFinite(numAmount)) return 0
  return Number(numAmount.toFixed(d))
}

/**
 * Two decimal places, no thousands separators — for API payloads and parsers that expect plain decimals.
 */
export function formatAmountPlain(
  amount: number | string | null | undefined,
  decimals: number = 2
): string {
  const d = normalizeFractionDigits(decimals, 2)
  const rounded = roundToDecimals(amount, d)
  return rounded.toFixed(d)
}

/** Money and quantity display: thousands separators + fraction digits (default 2). */
export function formatAmount(
  amount: number | string | null | undefined,
  decimals: number = 2
): string {
  return formatNumber(amount, decimals)
}

/**
 * Format number with thousand separators (commas).
 * App standard for fractional quantities and money is two fraction digits (`decimals` default 2).
 * @param amount Amount to format
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted number string (e.g., "1,000.00" or "1,000,000.50")
 */
export function formatNumber(
  amount: number | string | null | undefined,
  decimals: number = 2
): string {
  const d = normalizeFractionDigits(decimals, 2)
  if (amount === null || amount === undefined || amount === "") {
    return "0" + (d > 0 ? "." + "0".repeat(d) : "")
  }

  const numAmount = parseAmountToNumber(amount)

  if (isNaN(numAmount) || !Number.isFinite(numAmount)) {
    return "0" + (d > 0 ? "." + "0".repeat(d) : "")
  }

  const rounded = Number(numAmount.toFixed(d))

  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}

/**
 * Format currency amount with symbol
 * @param amount Amount to format
 * @param currencyCode ISO 4217 currency code (e.g., "BDT", "USD")
 * @param showSymbol Whether to show currency symbol
 * @returns Formatted currency string (e.g., "৳1,000.00" or "1,000.00 BDT")
 */
export function formatCurrency(
  amount: number | string,
  currencyCode: string = "BDT",
  showSymbol: boolean = true
): string {
  if (!currencyCode) {
    currencyCode = "BDT"
  }
  const code = currencyCode.toUpperCase().trim()
  
  // Convert to number if string
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount
  
  // Format number with thousand separators and 2 decimal places
  const formattedAmount = formatNumber(numAmount, 2)
  
  if (showSymbol) {
    const symbol = getCurrencySymbol(code)
    return `${symbol}${formattedAmount}`
  } else {
    return `${formattedAmount} ${code}`
  }
}

/**
 * Get all supported currencies
 * @returns Array of currency objects with code, name, and symbol
 */
export function getAllCurrencies(): Array<{ code: string; name: string; symbol: string }> {
  return Object.keys(CURRENCY_MAP).map((code) => ({
    code,
    name: getCurrencyName(code),
    symbol: getCurrencySymbol(code),
  }))
}

/**
 * Get currency options for dropdowns
 * @returns Array of currency options with value and label
 */
export function getCurrencyOptions(): Array<{ value: string; label: string }> {
  return Object.keys(CURRENCY_MAP).map((code) => ({
    value: code,
    label: `${code} - ${getCurrencyName(code)} (${getCurrencySymbol(code)})`,
  }))
}

