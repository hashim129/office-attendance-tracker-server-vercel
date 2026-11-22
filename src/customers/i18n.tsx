import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type PortalLang = 'en' | 'ur';

const STORAGE_KEY = 'bj_portal_lang';

/** English text -> Urdu. Any text not listed here simply stays in English. */
const UR: Record<string, string> = {
  // header
  'Customer Trip & Visa Portal': 'کسٹمر ٹرپ اور ویزا پورٹل',
  'Share Link': 'لنک شیئر کریں',
  'Copied!': 'کاپی ہو گیا!',
  'Print Summary': 'خلاصہ پرنٹ کریں',
  // hero
  'Track your journey to': 'اپنا سفر ٹریک کریں:',
  'invoices & visa progress.': 'انوائسز اور ویزا کی پیش رفت۔',
  'Enter your': 'اپنا',
  'Query Code': 'کوئری کوڈ',
  'CRM ID': 'CRM آئی ڈی',
  'Invoice Number': 'انوائس نمبر',
  'or': 'یا',
  'to view live invoice details, payment receipts, and visa milestones with Bahaar Journeys.':
    'درج کریں اور بہار جرنیز کے ساتھ اپنی انوائس کی تفصیلات، ادائیگی کی رسیدیں اور ویزا کی تازہ ترین صورتحال دیکھیں۔',
  'e.g. Q-1042, CRM-208, or INV-0091': 'مثال: Q-1042، CRM-208 یا INV-0091',
  'Track Booking': 'بکنگ ٹریک کریں',
  'Searching...': 'تلاش جاری ہے...',
  'Wait': 'انتظار کریں',
  'Only customer-safe summary fields are shown. Need help? Reference any code printed on your Bahaar Journeys invoice.':
    'صرف کسٹمر کے لیے محفوظ خلاصہ دکھایا جاتا ہے۔ مدد چاہیے؟ اپنی بہار جرنیز انوائس پر چھپا ہوا کوئی بھی کوڈ استعمال کریں۔',
  'Check your reference format': 'اپنے حوالہ کوڈ کا فارمیٹ چیک کریں',
  'Unable to complete lookup': 'تلاش مکمل نہیں ہو سکی',
  'Retry': 'دوبارہ کوشش کریں',
  'Clear Search': 'تلاش صاف کریں',
  // how tracking works
  'How tracking works': 'ٹریکنگ کیسے کام کرتی ہے',
  'Every stage of your booking, in one place': 'آپ کی بکنگ کا ہر مرحلہ، ایک ہی جگہ',
  'Enter your Query Code, CRM ID or Invoice Number above and see exactly where your trip stands.':
    'اوپر اپنا کوئری کوڈ، CRM آئی ڈی یا انوائس نمبر درج کریں اور دیکھیں کہ آپ کا سفر کس مرحلے پر ہے۔',
  'Payment': 'ادائیگی',
  'Your payment is confirmed by our accounts team.': 'ہماری اکاؤنٹس ٹیم آپ کی ادائیگی کی تصدیق کرتی ہے۔',
  'Visa progress': 'ویزا کی پیش رفت',
  'From documents received to visa issued.': 'دستاویزات موصول ہونے سے ویزا جاری ہونے تک۔',
  'Hotel booking': 'ہوٹل بکنگ',
  'Hotel name and stay dates, once confirmed.': 'تصدیق کے بعد ہوٹل کا نام اور قیام کی تاریخیں۔',
  'Air tickets': 'ہوائی ٹکٹ',
  'Your flights are issued and shared with you.': 'آپ کی پروازوں کے ٹکٹ جاری ہو کر آپ کو دیے جاتے ہیں۔',
  'Tours & transfers': 'ٹورز اور ٹرانسفرز',
  'Airport pickups and tours arranged.': 'ایئرپورٹ پک اپ اور ٹورز کا انتظام۔',
  'Travel ready': 'سفر کے لیے تیار',
  'Everything is in place. Safe travels.': 'سب کچھ تیار ہے۔ سفر مبارک!',
  // results
  'Customer Trip Journey, Booking & Visa Summary': 'کسٹمر کے سفر، بکنگ اور ویزا کا خلاصہ',
  'Verified Customer File': 'تصدیق شدہ کسٹمر فائل',
  'Filter Booking:': 'بکنگ فلٹر:',
  'Visa': 'ویزا',
  'Total Billed': 'کل بل شدہ رقم',
  'Cancelled': 'منسوخ',
  'Paid / Advance': 'ادا شدہ / ایڈوانس',
  'Outstanding Balance': 'بقایا رقم',
  'Settled': 'ادائیگی مکمل',
  'Active customer balance due': 'کسٹمر کی واجب الادا رقم',
  'Visa Progress': 'ویزا کی پیش رفت',
  'Issued': 'جاری ہو گیا',
  'Non-Visa Booking': 'غیر ویزا بکنگ',
  'No visa items in selection': 'منتخب میں کوئی ویزا آئٹم نہیں',
  'Customer Trip Journey & Visa Progress Timeline': 'سفر اور ویزا کی پیش رفت کی ٹائم لائن',
  'Invoice:': 'انوائس:',
  'Visa Progress:': 'ویزا کی پیش رفت:',
  'Visa Started (In Progress)': 'ویزا شروع (جاری)',
  'Visa Issued': 'ویزا جاری ہو گیا',
  'Hotel Booking:': 'ہوٹل بکنگ:',
  'Invoice Total': 'انوائس کا کل',
  'Description': 'تفصیل',
  'Qty': 'تعداد',
  'Unit Price': 'فی یونٹ قیمت',
  'Subtotal': 'ذیلی کل',
  'Discount': 'رعایت',
  'Advance Paid': 'ایڈوانس ادا شدہ',
  'Total': 'کل',
  'Balance Due': 'بقایا رقم',
  'Payment Receipts': 'ادائیگی کی رسیدیں',
  'Amount Received': 'موصول شدہ رقم',
  'paid': 'ادا شدہ',
  // destinations
  'Curated Global Portfolio': 'منتخب عالمی منزلیں',
  'Explore Worldwide Destinations': 'دنیا بھر کی منزلیں دریافت کریں',
  'Handpicked religious, cultural, alpine, and island journeys crafted with Bahaar Journeys visa and concierge care.':
    'مذہبی، ثقافتی، پہاڑی اور جزیروں کے منتخب سفر، بہار جرنیز کی ویزا اور کنسیئرج سروس کے ساتھ۔',
  'All': 'سب',
  'Religious & Heritage': 'مذہبی اور تاریخی',
  'Middle East': 'مشرق وسطیٰ',
  'Central Asia & Caucasus': 'وسطی ایشیا اور قفقاز',
  'Europe': 'یورپ',
  'Asia Pacific': 'ایشیا پیسیفک',
  'In season now': 'ابھی موسم کے مطابق',
  'Surprise me': 'مجھے حیران کریں',
  'Matched to Your Trip': 'آپ کے سفر سے مطابقت',
  'Recommended from Your Itinerary:': 'آپ کے سفری پروگرام کے مطابق تجویز:',
  'Get a quote & let our representative contact you': 'قیمت حاصل کریں اور ہمارے نمائندے کو رابطہ کرنے دیں',
  'Get a quote and let our representative contact you': 'قیمت حاصل کریں اور ہمارے نمائندے کو رابطہ کرنے دیں',
  'Trip Highlights': 'سفر کی خاص باتیں',
  'Best Season': 'بہترین موسم',
  'Visa Support': 'ویزا سپورٹ',
  'Explore': 'دیکھیں',
  'Gallery': 'گیلری',
  // quote form
  'Bahaar Journeys Concierge Desk': 'بہار جرنیز کنسیئرج ڈیسک',
  'Your Name': 'آپ کا نام',
  'e.g. Muhammad Hashir': 'مثال: محمد ہاشر',
  'Done': 'مکمل',
  'Cancel': 'منسوخ کریں',
  // extras
  'Chat on WhatsApp': 'واٹس ایپ پر بات کریں',
  'Send to family on WhatsApp': 'واٹس ایپ پر گھر والوں کو بھیجیں',
  'Current offers': 'موجودہ آفرز',
  'Until': 'تک',
  'Ask about this offer': 'اس آفر کے بارے میں پوچھیں',
  'Message from our team': 'ہماری ٹیم کی طرف سے پیغام',
  'Amounts for this booking are not shown online. Please contact our team for payment details.': 'اس بکنگ کی رقم آن لائن نہیں دکھائی جاتی۔ ادائیگی کی تفصیلات کے لیے ہماری ٹیم سے رابطہ کریں۔',
  'Install app': 'ایپ انسٹال کریں',
  'Add to Home Screen': 'ہوم اسکرین پر شامل کریں',
  'Tap Share, then "Add to Home Screen".': 'شیئر دبائیں، پھر "Add to Home Screen" منتخب کریں۔',
  'VISA ISSUED': 'ویزا جاری',
  'Paid': 'ادا شدہ',
  'of': 'میں سے',
  'Days': 'دن',
  'Hours': 'گھنٹے',
  'Min': 'منٹ',
  'Sec': 'سیکنڈ',
  'Countdown to your trip': 'آپ کے سفر تک باقی وقت',
  'Weather now': 'موجودہ موسم',
  'Currency converter': 'کرنسی کنورٹر',
  'Approximate market rate, for guidance only.': 'تقریباً مارکیٹ ریٹ، صرف راہنمائی کے لیے۔',
  'Travel checklist': 'سفر کی چیک لسٹ',
  'A general list. Requirements can differ by nationality; please confirm with our team.': 'یہ عمومی فہرست ہے۔ ضروریات قومیت کے لحاظ سے مختلف ہو سکتی ہیں، براہ کرم ہماری ٹیم سے تصدیق کریں۔',
  'Track': 'ٹریک',
  'Destinations': 'منزلیں',
  'Chat': 'چیٹ',
  'Passport valid for at least 6 months': 'پاسپورٹ کم از کم 6 ماہ کے لیے کارآمد ہو',
  'Visa approval copy (printed and on your phone)': 'ویزا اپروول کی کاپی (پرنٹ اور فون میں)',
  'Hotel booking confirmation': 'ہوٹل بکنگ کی تصدیق',
  'Return flight ticket': 'واپسی کی فلائٹ کا ٹکٹ',
  'Travel insurance (recommended)': 'ٹریول انشورنس (تجویز کردہ)',
  'Some local currency and a working bank card': 'کچھ مقامی کرنسی اور چلتا ہوا بینک کارڈ',
  'Phone charger and a travel adapter': 'فون چارجر اور ٹریول اڈاپٹر',
  'Modest, comfortable clothing': 'سادہ، آرام دہ لباس',
  'Comfortable walking shoes': 'چلنے کے لیے آرام دہ جوتے',
  'Prayer essentials and a small bag for the Haram': 'عبادت کا ضروری سامان اور حرم کے لیے چھوٹا بیگ',
  'Light, breathable clothing and sunscreen': 'ہلکے، ہوادار کپڑے اور سن اسکرین',
  'A light jacket for air-conditioned places': 'ایئر کنڈیشنڈ جگہوں کے لیے ہلکی جیکٹ',
  'Layers, as mornings and evenings can be cool': 'تہہ در تہہ کپڑے، کیونکہ صبح اور شام ٹھنڈی ہو سکتی ہیں',
  'Warm layers and a rain jacket': 'گرم کپڑے اور برساتی جیکٹ',
  'Light clothing, sunscreen and an umbrella': 'ہلکے کپڑے، سن اسکرین اور چھتری',
  'Insect repellent': 'کیڑوں سے بچاؤ کا اسپرے',
};

type Ctx = { lang: PortalLang; setLang: (l: PortalLang) => void; t: (en: string) => string };

const LangContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (s) => s });

function readStored(): PortalLang {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<PortalLang>(readStored);

  const setLang = useCallback((l: PortalLang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode: language just won't be remembered */
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('lang-ur', lang === 'ur');
    root.setAttribute('lang', lang === 'ur' ? 'ur' : 'en');
    return () => {
      root.classList.remove('lang-ur');
      root.setAttribute('lang', 'en');
    };
  }, [lang]);

  const t = useCallback((en: string) => (lang === 'ur' ? UR[en] ?? en : en), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
