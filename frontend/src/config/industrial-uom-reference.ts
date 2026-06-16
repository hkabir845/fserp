/**
 * Reference catalog for industrial / process ERPs (display + onboarding).
 * Live tenant UOMs come from GET /uoms; this supplements when the API is empty.
 */
export type UomRefGroup = { category: string; description: string; units: { code: string; name: string }[] }

export const industrialUomReference: UomRefGroup[] = [
  {
    category: 'Weight & mass',
    description: 'Raw materials, ingredients, bulk solids',
    units: [
      { code: 'G', name: 'Gram' },
      { code: 'KG', name: 'Kilogram' },
      { code: 'T', name: 'Metric ton (tonne)' },
      { code: 'MT', name: 'Metric ton (alternate code)' },
      { code: 'LB', name: 'Pound' },
      { code: 'OZ', name: 'Ounce' },
    ],
  },
  {
    category: 'Volume & flow',
    description: 'Liquids, fuels, chemicals, dosing',
    units: [
      { code: 'ML', name: 'Millilitre' },
      { code: 'L', name: 'Litre' },
      { code: 'KL', name: 'Kilolitre' },
      { code: 'M3', name: 'Cubic metre' },
      { code: 'GAL', name: 'Gallon (US)' },
      { code: 'BBL', name: 'Barrel (industry-specific)' },
    ],
  },
  {
    category: 'Length & area',
    description: 'Sheet, roll, cable, flooring',
    units: [
      { code: 'MM', name: 'Millimetre' },
      { code: 'CM', name: 'Centimetre' },
      { code: 'M', name: 'Metre' },
      { code: 'KM', name: 'Kilometre' },
      { code: 'M2', name: 'Square metre' },
      { code: 'FT', name: 'Foot' },
      { code: 'IN', name: 'Inch' },
    ],
  },
  {
    category: 'Count & packaging',
    description: 'Finished goods, spare parts, pallets',
    units: [
      { code: 'EA', name: 'Each' },
      { code: 'PCS', name: 'Pieces' },
      { code: 'PK', name: 'Pack' },
      { code: 'BOX', name: 'Box' },
      { code: 'CS', name: 'Case' },
      { code: 'PAL', name: 'Pallet' },
      { code: 'DRM', name: 'Drum' },
      { code: 'BAG', name: 'Bag' },
      { code: 'ROLL', name: 'Roll' },
    ],
  },
  {
    category: 'Time & services',
    description: 'Maintenance, rental, labour (where used)',
    units: [
      { code: 'H', name: 'Hour' },
      { code: 'D', name: 'Day' },
      { code: 'MO', name: 'Month' },
    ],
  },
]
