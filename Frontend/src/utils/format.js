/**
 * Format currency amount in Indian Rupee format
 * @param {number|string} amount
 * @returns {string}
 */
export const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(num);
};

/**
 * Format period string "MMYYYY" to human readable format (e.g., "092026" -> "Sep 2026")
 * @param {string} period
 * @returns {string}
 */
export const formatPeriod = (period) => {
  if (!period || period.length !== 6) return period || '';
  const monthNum = parseInt(period.slice(0, 2), 10);
  const year = period.slice(2, 6);
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = monthNames[monthNum - 1] || period.slice(0, 2);
  return `${month} ${year}`;
};

/**
 * Format ISO date string to localized date/time
 * @param {string} dateString
 * @returns {string}
 */
export const formatDate = (dateString) => {
  if (!dateString) return '—';
  try {
    return new Date(dateString).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return dateString;
  }
};

/**
 * Format date in Tally standard format: DD-MMM-YY (e.g. 29-Sep-26)
 */
export const formatTallyDate = (dateString) => {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  } catch {
    return String(dateString);
  }
};

/**
 * Indian GST State Code mapping to State Name
 */
export const STATE_NAMES = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh'
};

export const getStateName = (code) => {
  if (!code) return '—';
  const cleanCode = String(code).trim().slice(0, 2).padStart(2, '0');
  return STATE_NAMES[cleanCode] || cleanCode;
};

/**
 * Convert number amount to Indian Rupee Words format
 * e.g. 49560 -> "INR Forty Nine Thousand Five Hundred Sixty Only"
 */
export const numberToWords = (num) => {
  const n = Math.round(Number(num) * 100) / 100;
  if (isNaN(n) || n === 0) return 'INR Zero Only';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convertLessThanOneThousand = (val) => {
    let str = '';
    if (val >= 100) {
      str += a[Math.floor(val / 100)] + ' Hundred ';
      val %= 100;
    }
    if (val >= 20) {
      str += b[Math.floor(val / 10)] + (val % 10 !== 0 ? ' ' + a[val % 10] : '') + ' ';
    } else if (val > 0) {
      str += a[val] + ' ';
    }
    return str.trim();
  };

  const integerPart = Math.floor(Math.abs(n));
  const decimalPart = Math.round((Math.abs(n) - integerPart) * 100);

  let words = '';
  let remaining = integerPart;

  const crore = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakh = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousand = Math.floor(remaining / 1000);
  remaining %= 1000;
  const hundreds = remaining;

  if (crore > 0) words += convertLessThanOneThousand(crore) + ' Crore ';
  if (lakh > 0) words += convertLessThanOneThousand(lakh) + ' Lakh ';
  if (thousand > 0) words += convertLessThanOneThousand(thousand) + ' Thousand ';
  if (hundreds > 0) words += convertLessThanOneThousand(hundreds) + ' ';

  words = words.trim();
  if (!words) words = 'Zero';

  let result = `INR ${words}`;
  if (decimalPart > 0) {
    result += ` and ${convertLessThanOneThousand(decimalPart)} Paise`;
  }
  result += ' Only';

  return result;
};
