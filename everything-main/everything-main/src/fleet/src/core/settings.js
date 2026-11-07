/** Fleet-wide settings, stored as one small KV item. */

export const STATUS_COLORS = ['green', 'orange', 'red', 'blue', 'gray', 'purple', 'teal'];

export function defaultSettings() {
  return {
    company: { name: '' },
    currency: 'USD',
    units: {
      distance: 'mi', // 'mi' | 'km'
      volume: 'gal', // 'gal' (US) | 'L'
    },
    weekStart: 0,
    vehicleStatuses: [
      { id: 'active', label: 'Active', color: 'green' },
      { id: 'in_shop', label: 'In shop', color: 'orange' },
      { id: 'out_of_service', label: 'Out of service', color: 'red' },
      { id: 'inactive', label: 'Inactive', color: 'blue' },
      { id: 'sold', label: 'Sold', color: 'gray' },
    ],
    vehicleTypes: ['Car', 'SUV', 'Pickup truck', 'Van', 'Box truck', 'Semi truck', 'Bus', 'Trailer', 'Forklift', 'Equipment', 'Other'],
    fuelTypes: ['Gasoline', 'Diesel', 'Electric', 'Hybrid', 'Plug-in hybrid', 'CNG', 'Propane'],
    groups: [],
    expenseTypes: ['Insurance', 'Registration', 'Tolls', 'Parking', 'Vehicle payment', 'Depreciation', 'Licensing', 'Cleaning', 'Fines', 'Other'],
    vehicleRenewalTypes: ['Registration', 'Insurance', 'Emission test', 'Safety inspection', 'Permit', 'Lease'],
    contactRenewalTypes: ['Driver license', 'Medical card', 'Hazmat endorsement', 'Certification', 'Training'],
    serviceCategories: ['Engine', 'Brakes', 'Tires and wheels', 'Electrical', 'Suspension', 'HVAC', 'Transmission', 'Body', 'Fluids', 'Inspection', 'Other'],
    partCategories: ['Filters', 'Fluids', 'Brakes', 'Tires', 'Electrical', 'Belts and hoses', 'Lighting', 'Other'],
    partLocations: ['Main shop'],
    laborRate: null, // default shop labor rate, cents per hour
    dueSoon: { days: 14, meter: 500 },
    issues: { fromInspections: true },
    numbering: { issue: 1, workOrder: 1, purchaseOrder: 1 },
    onboarded: false,
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge for plain objects; arrays and scalars replace. */
export function mergeSettings(base, changes) {
  const out = { ...base };
  for (const [k, v] of Object.entries(changes || {})) {
    out[k] = isObj(v) && isObj(base?.[k]) ? mergeSettings(base[k], v) : v;
  }
  return out;
}

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'MXN', 'BRL', 'INR', 'ZAR', 'JPY', 'SEK', 'NOK', 'DKK', 'CHF', 'SGD', 'AED'];
