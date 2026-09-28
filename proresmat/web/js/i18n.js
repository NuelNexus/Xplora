// Language-ready strings. English is complete; Twi covers navigation and the main customer actions.
// Twi strings are drafts for review by PRORESMAT's language reviewers before launch.
const STRINGS = {
  en: {
    home: 'Home', consult: 'Consult', products: 'Products', orders: 'Orders', profile: 'Profile',
    today: 'Today', patients: 'Patients', earnings: 'Earnings', dashboard: 'Dashboard', payouts: 'Payouts', compliance: 'Compliance',
    overview: 'Overview', approvals: 'Approvals', care: 'Care', finance: 'Finance', risk: 'Risk',
    promise: 'Trusted traditional and integrative care, verified by PRORESMAT.',
    greeting: 'Akwaaba', search: 'Search practitioners, clinics or products', bookConsult: 'Book a consultation', shopProducts: 'Approved herbal products',
    practitionersNear: 'Available verified practitioners', seeAll: 'See all', learn: 'Health information', signIn: 'Sign in', signOut: 'Sign out',
    addToCart: 'Add to cart', pay: 'Pay', upcoming: 'Coming up', notifications: 'Notifications', cart: 'Cart',
  },
  tw: {
    home: 'Fie', consult: 'Ayaresa', products: 'Nnuro', orders: 'Adetɔ', profile: 'Me ho',
    today: 'Nnɛ', patients: 'Ayarefo', earnings: 'Akatua', dashboard: 'Dashboard', payouts: 'Sika tua', compliance: 'Mmara',
    overview: 'Nhwɛso', approvals: 'Mpenedie', care: 'Ahwɛyie', finance: 'Sikasɛm', risk: 'Asiane',
    promise: 'Ayaresa a wogye di, a PRORESMAT asɔ ahwɛ.',
    greeting: 'Akwaaba', search: 'Hwehwɛ ayaresafo, ayaresabea anaa nnuro', bookConsult: 'Hyɛ ayaresa da', shopProducts: 'Nhaban nnuro a wɔapene so',
    practitionersNear: 'Ayaresafo a wɔasɔ wɔn ahwɛ', seeAll: 'Hwɛ ne nyinaa', learn: 'Apɔmuden ho nsɛm', signIn: 'Wura mu', signOut: 'Fi mu',
    addToCart: 'Fa gu kɛntɛn mu', pay: 'Tua ka', upcoming: 'Nea ɛreba', notifications: 'Nkra', cart: 'Kɛntɛn',
  },
};

let lang = 'en';
export const setLang = (l) => { lang = STRINGS[l] ? l : 'en'; document.documentElement.lang = lang === 'tw' ? 'ak' : 'en'; };
export const getLang = () => lang;
export const t = (key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
