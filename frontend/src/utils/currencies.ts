/**
 * Comprehensive list of all countries and their currencies (A to Z)
 * ISO 4217 Currency Codes with country names
 */
export interface Currency {
  code: string
  name: string
  country: string
}

export const CURRENCIES: Currency[] = [
  // A
  { code: 'AFN', name: 'Afghan Afghani', country: 'Afghanistan' },
  { code: 'ALL', name: 'Albanian Lek', country: 'Albania' },
  { code: 'DZD', name: 'Algerian Dinar', country: 'Algeria' },
  { code: 'USD', name: 'US Dollar', country: 'American Samoa' },
  { code: 'EUR', name: 'Euro', country: 'Andorra' },
  { code: 'AOA', name: 'Angolan Kwanza', country: 'Angola' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Anguilla' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Antigua and Barbuda' },
  { code: 'ARS', name: 'Argentine Peso', country: 'Argentina' },
  { code: 'AMD', name: 'Armenian Dram', country: 'Armenia' },
  { code: 'AWG', name: 'Aruban Florin', country: 'Aruba' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Australia' },
  { code: 'EUR', name: 'Euro', country: 'Austria' },
  { code: 'AZN', name: 'Azerbaijani Manat', country: 'Azerbaijan' },
  
  // B
  { code: 'BSD', name: 'Bahamian Dollar', country: 'Bahamas' },
  { code: 'BHD', name: 'Bahraini Dinar', country: 'Bahrain' },
  { code: 'BDT', name: 'Bangladeshi Taka', country: 'Bangladesh' },
  { code: 'BBD', name: 'Barbadian Dollar', country: 'Barbados' },
  { code: 'BYN', name: 'Belarusian Ruble', country: 'Belarus' },
  { code: 'EUR', name: 'Euro', country: 'Belgium' },
  { code: 'BZD', name: 'Belize Dollar', country: 'Belize' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Benin' },
  { code: 'BMD', name: 'Bermudian Dollar', country: 'Bermuda' },
  { code: 'BTN', name: 'Bhutanese Ngultrum', country: 'Bhutan' },
  { code: 'BOB', name: 'Bolivian Boliviano', country: 'Bolivia' },
  { code: 'USD', name: 'US Dollar', country: 'Bonaire' },
  { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', country: 'Bosnia and Herzegovina' },
  { code: 'BWP', name: 'Botswanan Pula', country: 'Botswana' },
  { code: 'BRL', name: 'Brazilian Real', country: 'Brazil' },
  { code: 'GBP', name: 'British Pound', country: 'British Indian Ocean Territory' },
  { code: 'BND', name: 'Brunei Dollar', country: 'Brunei' },
  { code: 'BGN', name: 'Bulgarian Lev', country: 'Bulgaria' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Burkina Faso' },
  { code: 'BIF', name: 'Burundian Franc', country: 'Burundi' },
  
  // C
  { code: 'KHR', name: 'Cambodian Riel', country: 'Cambodia' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Cameroon' },
  { code: 'CAD', name: 'Canadian Dollar', country: 'Canada' },
  { code: 'CVE', name: 'Cape Verdean Escudo', country: 'Cape Verde' },
  { code: 'KYD', name: 'Cayman Islands Dollar', country: 'Cayman Islands' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Central African Republic' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Chad' },
  { code: 'CLP', name: 'Chilean Peso', country: 'Chile' },
  { code: 'CNY', name: 'Chinese Yuan', country: 'China' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Christmas Island' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Cocos Islands' },
  { code: 'COP', name: 'Colombian Peso', country: 'Colombia' },
  { code: 'KMF', name: 'Comorian Franc', country: 'Comoros' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Republic of the Congo' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Democratic Republic of the Congo' },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'Cook Islands' },
  { code: 'CRC', name: 'Costa Rican Colón', country: 'Costa Rica' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Côte d\'Ivoire' },
  { code: 'HRK', name: 'Croatian Kuna', country: 'Croatia' },
  { code: 'CUP', name: 'Cuban Peso', country: 'Cuba' },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', country: 'Curaçao' },
  { code: 'EUR', name: 'Euro', country: 'Cyprus' },
  { code: 'CZK', name: 'Czech Koruna', country: 'Czech Republic' },
  
  // D
  { code: 'DKK', name: 'Danish Krone', country: 'Denmark' },
  { code: 'DJF', name: 'Djiboutian Franc', country: 'Djibouti' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Dominica' },
  { code: 'DOP', name: 'Dominican Peso', country: 'Dominican Republic' },
  
  // E
  { code: 'USD', name: 'US Dollar', country: 'Ecuador' },
  { code: 'EGP', name: 'Egyptian Pound', country: 'Egypt' },
  { code: 'USD', name: 'US Dollar', country: 'El Salvador' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Equatorial Guinea' },
  { code: 'ERN', name: 'Eritrean Nakfa', country: 'Eritrea' },
  { code: 'EUR', name: 'Euro', country: 'Estonia' },
  { code: 'ETB', name: 'Ethiopian Birr', country: 'Ethiopia' },
  
  // F
  { code: 'FKP', name: 'Falkland Islands Pound', country: 'Falkland Islands' },
  { code: 'DKK', name: 'Danish Krone', country: 'Faroe Islands' },
  { code: 'FJD', name: 'Fijian Dollar', country: 'Fiji' },
  { code: 'EUR', name: 'Euro', country: 'Finland' },
  { code: 'EUR', name: 'Euro', country: 'France' },
  { code: 'EUR', name: 'Euro', country: 'French Guiana' },
  { code: 'XPF', name: 'CFP Franc', country: 'French Polynesia' },
  { code: 'XAF', name: 'Central African CFA Franc', country: 'Gabon' },
  
  // G
  { code: 'GMD', name: 'Gambian Dalasi', country: 'Gambia' },
  { code: 'GEL', name: 'Georgian Lari', country: 'Georgia' },
  { code: 'EUR', name: 'Euro', country: 'Germany' },
  { code: 'GHS', name: 'Ghanaian Cedi', country: 'Ghana' },
  { code: 'GIP', name: 'Gibraltar Pound', country: 'Gibraltar' },
  { code: 'EUR', name: 'Euro', country: 'Greece' },
  { code: 'DKK', name: 'Danish Krone', country: 'Greenland' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Grenada' },
  { code: 'EUR', name: 'Euro', country: 'Guadeloupe' },
  { code: 'USD', name: 'US Dollar', country: 'Guam' },
  { code: 'GTQ', name: 'Guatemalan Quetzal', country: 'Guatemala' },
  { code: 'GBP', name: 'British Pound', country: 'Guernsey' },
  { code: 'GNF', name: 'Guinean Franc', country: 'Guinea' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Guinea-Bissau' },
  { code: 'GYD', name: 'Guyanese Dollar', country: 'Guyana' },
  
  // H
  { code: 'HTG', name: 'Haitian Gourde', country: 'Haiti' },
  { code: 'HNL', name: 'Honduran Lempira', country: 'Honduras' },
  { code: 'HKD', name: 'Hong Kong Dollar', country: 'Hong Kong' },
  { code: 'HUF', name: 'Hungarian Forint', country: 'Hungary' },
  
  // I
  { code: 'ISK', name: 'Icelandic Króna', country: 'Iceland' },
  { code: 'INR', name: 'Indian Rupee', country: 'India' },
  { code: 'IDR', name: 'Indonesian Rupiah', country: 'Indonesia' },
  { code: 'IRR', name: 'Iranian Rial', country: 'Iran' },
  { code: 'IQD', name: 'Iraqi Dinar', country: 'Iraq' },
  { code: 'EUR', name: 'Euro', country: 'Ireland' },
  { code: 'GBP', name: 'British Pound', country: 'Isle of Man' },
  { code: 'ILS', name: 'Israeli New Shekel', country: 'Israel' },
  { code: 'EUR', name: 'Euro', country: 'Italy' },
  
  // J
  { code: 'JMD', name: 'Jamaican Dollar', country: 'Jamaica' },
  { code: 'JPY', name: 'Japanese Yen', country: 'Japan' },
  { code: 'GBP', name: 'British Pound', country: 'Jersey' },
  { code: 'JOD', name: 'Jordanian Dinar', country: 'Jordan' },
  
  // K
  { code: 'KZT', name: 'Kazakhstani Tenge', country: 'Kazakhstan' },
  { code: 'KES', name: 'Kenyan Shilling', country: 'Kenya' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Kiribati' },
  { code: 'KPW', name: 'North Korean Won', country: 'North Korea' },
  { code: 'KRW', name: 'South Korean Won', country: 'South Korea' },
  { code: 'KWD', name: 'Kuwaiti Dinar', country: 'Kuwait' },
  { code: 'KGS', name: 'Kyrgystani Som', country: 'Kyrgyzstan' },
  
  // L
  { code: 'LAK', name: 'Laotian Kip', country: 'Laos' },
  { code: 'EUR', name: 'Euro', country: 'Latvia' },
  { code: 'LBP', name: 'Lebanese Pound', country: 'Lebanon' },
  { code: 'LSL', name: 'Lesotho Loti', country: 'Lesotho' },
  { code: 'LRD', name: 'Liberian Dollar', country: 'Liberia' },
  { code: 'LYD', name: 'Libyan Dinar', country: 'Libya' },
  { code: 'CHF', name: 'Swiss Franc', country: 'Liechtenstein' },
  { code: 'EUR', name: 'Euro', country: 'Lithuania' },
  { code: 'EUR', name: 'Euro', country: 'Luxembourg' },
  
  // M
  { code: 'MOP', name: 'Macanese Pataca', country: 'Macau' },
  { code: 'MKD', name: 'Macedonian Denar', country: 'North Macedonia' },
  { code: 'MGA', name: 'Malagasy Ariary', country: 'Madagascar' },
  { code: 'MWK', name: 'Malawian Kwacha', country: 'Malawi' },
  { code: 'MYR', name: 'Malaysian Ringgit', country: 'Malaysia' },
  { code: 'MVR', name: 'Maldivian Rufiyaa', country: 'Maldives' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Mali' },
  { code: 'EUR', name: 'Euro', country: 'Malta' },
  { code: 'USD', name: 'US Dollar', country: 'Marshall Islands' },
  { code: 'EUR', name: 'Euro', country: 'Martinique' },
  { code: 'MRU', name: 'Mauritanian Ouguiya', country: 'Mauritania' },
  { code: 'MUR', name: 'Mauritian Rupee', country: 'Mauritius' },
  { code: 'EUR', name: 'Euro', country: 'Mayotte' },
  { code: 'MXN', name: 'Mexican Peso', country: 'Mexico' },
  { code: 'USD', name: 'US Dollar', country: 'Micronesia' },
  { code: 'MDL', name: 'Moldovan Leu', country: 'Moldova' },
  { code: 'EUR', name: 'Euro', country: 'Monaco' },
  { code: 'MNT', name: 'Mongolian Tugrik', country: 'Mongolia' },
  { code: 'EUR', name: 'Euro', country: 'Montenegro' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Montserrat' },
  { code: 'MAD', name: 'Moroccan Dirham', country: 'Morocco' },
  { code: 'MZN', name: 'Mozambican Metical', country: 'Mozambique' },
  { code: 'MMK', name: 'Myanma Kyat', country: 'Myanmar' },
  
  // N
  { code: 'NAD', name: 'Namibian Dollar', country: 'Namibia' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Nauru' },
  { code: 'NPR', name: 'Nepalese Rupee', country: 'Nepal' },
  { code: 'EUR', name: 'Euro', country: 'Netherlands' },
  { code: 'XPF', name: 'CFP Franc', country: 'New Caledonia' },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'New Zealand' },
  { code: 'NIO', name: 'Nicaraguan Córdoba', country: 'Nicaragua' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Niger' },
  { code: 'NGN', name: 'Nigerian Naira', country: 'Nigeria' },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'Niue' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Norfolk Island' },
  { code: 'USD', name: 'US Dollar', country: 'Northern Mariana Islands' },
  { code: 'NOK', name: 'Norwegian Krone', country: 'Norway' },
  
  // O
  { code: 'OMR', name: 'Omani Rial', country: 'Oman' },
  
  // P
  { code: 'PKR', name: 'Pakistani Rupee', country: 'Pakistan' },
  { code: 'USD', name: 'US Dollar', country: 'Palau' },
  { code: 'ILS', name: 'Israeli New Shekel', country: 'Palestine' },
  { code: 'PAB', name: 'Panamanian Balboa', country: 'Panama' },
  { code: 'PGK', name: 'Papua New Guinean Kina', country: 'Papua New Guinea' },
  { code: 'PYG', name: 'Paraguayan Guarani', country: 'Paraguay' },
  { code: 'PEN', name: 'Peruvian Sol', country: 'Peru' },
  { code: 'PHP', name: 'Philippine Peso', country: 'Philippines' },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'Pitcairn' },
  { code: 'PLN', name: 'Polish Zloty', country: 'Poland' },
  { code: 'EUR', name: 'Euro', country: 'Portugal' },
  { code: 'QAR', name: 'Qatari Rial', country: 'Qatar' },
  
  // R
  { code: 'RON', name: 'Romanian Leu', country: 'Romania' },
  { code: 'RUB', name: 'Russian Ruble', country: 'Russia' },
  { code: 'RWF', name: 'Rwandan Franc', country: 'Rwanda' },
  
  // S
  { code: 'SHP', name: 'Saint Helena Pound', country: 'Saint Helena' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Saint Kitts and Nevis' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Saint Lucia' },
  { code: 'EUR', name: 'Euro', country: 'Saint Martin' },
  { code: 'EUR', name: 'Euro', country: 'Saint Pierre and Miquelon' },
  { code: 'XCD', name: 'East Caribbean Dollar', country: 'Saint Vincent and the Grenadines' },
  { code: 'WST', name: 'Samoan Tala', country: 'Samoa' },
  { code: 'EUR', name: 'Euro', country: 'San Marino' },
  { code: 'STN', name: 'São Tomé and Príncipe Dobra', country: 'São Tomé and Príncipe' },
  { code: 'SAR', name: 'Saudi Riyal', country: 'Saudi Arabia' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Senegal' },
  { code: 'RSD', name: 'Serbian Dinar', country: 'Serbia' },
  { code: 'SCR', name: 'Seychellois Rupee', country: 'Seychelles' },
  { code: 'SLE', name: 'Sierra Leonean Leone', country: 'Sierra Leone' },
  { code: 'SGD', name: 'Singapore Dollar', country: 'Singapore' },
  { code: 'ANG', name: 'Netherlands Antillean Guilder', country: 'Sint Maarten' },
  { code: 'EUR', name: 'Euro', country: 'Slovakia' },
  { code: 'EUR', name: 'Euro', country: 'Slovenia' },
  { code: 'SBD', name: 'Solomon Islands Dollar', country: 'Solomon Islands' },
  { code: 'SOS', name: 'Somali Shilling', country: 'Somalia' },
  { code: 'ZAR', name: 'South African Rand', country: 'South Africa' },
  { code: 'GBP', name: 'British Pound', country: 'South Georgia and the South Sandwich Islands' },
  { code: 'SSP', name: 'South Sudanese Pound', country: 'South Sudan' },
  { code: 'EUR', name: 'Euro', country: 'Spain' },
  { code: 'LKR', name: 'Sri Lankan Rupee', country: 'Sri Lanka' },
  { code: 'SDG', name: 'Sudanese Pound', country: 'Sudan' },
  { code: 'SRD', name: 'Surinamese Dollar', country: 'Suriname' },
  { code: 'NOK', name: 'Norwegian Krone', country: 'Svalbard and Jan Mayen' },
  { code: 'SEK', name: 'Swedish Krona', country: 'Sweden' },
  { code: 'CHF', name: 'Swiss Franc', country: 'Switzerland' },
  { code: 'SYP', name: 'Syrian Pound', country: 'Syria' },
  
  // T
  { code: 'TWD', name: 'New Taiwan Dollar', country: 'Taiwan' },
  { code: 'TJS', name: 'Tajikistani Somoni', country: 'Tajikistan' },
  { code: 'TZS', name: 'Tanzanian Shilling', country: 'Tanzania' },
  { code: 'THB', name: 'Thai Baht', country: 'Thailand' },
  { code: 'USD', name: 'US Dollar', country: 'Timor-Leste' },
  { code: 'XOF', name: 'West African CFA Franc', country: 'Togo' },
  { code: 'NZD', name: 'New Zealand Dollar', country: 'Tokelau' },
  { code: 'TOP', name: 'Tongan Paʻanga', country: 'Tonga' },
  { code: 'TTD', name: 'Trinidad and Tobago Dollar', country: 'Trinidad and Tobago' },
  { code: 'TND', name: 'Tunisian Dinar', country: 'Tunisia' },
  { code: 'TRY', name: 'Turkish Lira', country: 'Turkey' },
  { code: 'TMT', name: 'Turkmenistani Manat', country: 'Turkmenistan' },
  { code: 'USD', name: 'US Dollar', country: 'Turks and Caicos Islands' },
  { code: 'AUD', name: 'Australian Dollar', country: 'Tuvalu' },
  
  // U
  { code: 'UGX', name: 'Ugandan Shilling', country: 'Uganda' },
  { code: 'UAH', name: 'Ukrainian Hryvnia', country: 'Ukraine' },
  { code: 'AED', name: 'UAE Dirham', country: 'United Arab Emirates' },
  { code: 'GBP', name: 'British Pound', country: 'United Kingdom' },
  { code: 'USD', name: 'US Dollar', country: 'United States' },
  { code: 'USD', name: 'US Dollar', country: 'United States Minor Outlying Islands' },
  { code: 'UYU', name: 'Uruguayan Peso', country: 'Uruguay' },
  { code: 'UZS', name: 'Uzbekistani Som', country: 'Uzbekistan' },
  
  // V
  { code: 'VUV', name: 'Vanuatu Vatu', country: 'Vanuatu' },
  { code: 'VES', name: 'Venezuelan Bolívar Soberano', country: 'Venezuela' },
  { code: 'VND', name: 'Vietnamese Dong', country: 'Vietnam' },
  { code: 'USD', name: 'US Dollar', country: 'US Virgin Islands' },
  { code: 'XPF', name: 'CFP Franc', country: 'Wallis and Futuna' },
  
  // W
  { code: 'MAD', name: 'Moroccan Dirham', country: 'Western Sahara' },
  
  // Y
  { code: 'YER', name: 'Yemeni Rial', country: 'Yemen' },
  
  // Z
  { code: 'ZMW', name: 'Zambian Kwacha', country: 'Zambia' },
  { code: 'ZWL', name: 'Zimbabwean Dollar', country: 'Zimbabwe' },
]

/**
 * Get unique currencies sorted by currency code
 * This removes duplicates and sorts alphabetically
 */
export const getUniqueCurrencies = (): Currency[] => {
  const uniqueMap = new Map<string, Currency>()
  
  CURRENCIES.forEach(currency => {
    if (!uniqueMap.has(currency.code)) {
      uniqueMap.set(currency.code, currency)
    } else {
      // If multiple countries use the same currency, combine country names
      const existing = uniqueMap.get(currency.code)!
      if (!existing.country.includes(currency.country)) {
        existing.country = `${existing.country}, ${currency.country}`
      }
    }
  })
  
  return Array.from(uniqueMap.values()).sort((a, b) => 
    a.code.localeCompare(b.code)
  )
}

/**
 * Get currencies grouped by country name (A to Z)
 */
export const getCurrenciesByCountry = (): Currency[] => {
  return [...CURRENCIES].sort((a, b) => 
    a.country.localeCompare(b.country)
  )
}

/**
 * Get currency by code
 */
export const getCurrencyByCode = (code: string): Currency | undefined => {
  return CURRENCIES.find(c => c.code === code.toUpperCase())
}

/**
 * Get currencies by country name (fuzzy search)
 */
export const searchCurrenciesByCountry = (searchTerm: string): Currency[] => {
  const term = searchTerm.toLowerCase()
  return CURRENCIES.filter(c => 
    c.country.toLowerCase().includes(term) ||
    c.name.toLowerCase().includes(term) ||
    c.code.toLowerCase().includes(term)
  )
}

