// Demo crates for an empty local database. No soldiers – import the real roster from the Soldiers screen.
// Item tuple: [name, total, faulty, minRequired]
const RAW = [
  { id: "c01", number: "01", name: "קשר", category: "תקשוב", location: "מחסן א׳", items: [
    ["מכשיר קשר אישי", 24, 0, 6], ["סוללה למכשיר קשר", 60, 0, 20], ["אוזניית קשר", 30, 0, 8],
    ["אנטנה מתקפלת", 12, 0, 4], ["מטען רב-עמדות", 6, 0, 2],
  ] },
  { id: "c02", number: "02", name: "אופטיקה ותצפית", category: "תצפית", location: "מחסן א׳", items: [
    ["משקפת 7x50", 10, 0, 3], ["משקפת לילה", 6, 0, 2], ["חצובה", 8, 0, 2], ["מד טווח", 4, 0, 1],
  ] },
  { id: "c03", number: "03", name: "רפואה", category: "רפואה", location: "מרפאה", items: [
    ["ערכת חובש", 8, 0, 6], ["חוסם עורקים", 50, 0, 30], ["תחבושת אישית", 120, 0, 60],
    ["אלונקה מתקפלת", 4, 1, 2], ["שמיכת הישרדות", 40, 0, 15],
  ] },
  { id: "c04", number: "04", name: "ניווט ותאורה", category: "ניווט", location: "מחסן ב׳", items: [
    ["מצפן", 30, 0, 8], ["פנס ראש", 70, 3, 20], ["סטיקלייט", 200, 0, 50], ["GPS יד", 6, 0, 2],
  ] },
  { id: "c05", number: "05", name: "שטח ומחנאות", category: "לוגיסטיקה", location: "מחסן ב׳", items: [
    ["יריעת הסוואה", 16, 2, 6], ["כלי חפירה", 20, 0, 8], ["חבל 30 מ׳", 10, 0, 4], ["ג׳ריקן מים", 24, 1, 10],
  ] },
  { id: "c06", number: "06", name: "לינה", category: "לוגיסטיקה", location: "מחסן ג׳", items: [
    ["שק שינה", 110, 0, 10], ["מזרן שטח", 110, 0, 10], ["כילה", 40, 0, 5],
  ] },
  { id: "c07", number: "07", name: "כלי עבודה", category: "טכני", location: "סדנה", items: [
    ["ערכת כלים", 5, 0, 2], ["מקדחה נטענת", 3, 1, 2], ["אזיקוני פלסטיק (חב׳)", 15, 0, 5], ["סרט הדבקה", 30, 0, 10],
  ] },
  { id: "c08", number: "08", name: "סוללות וטעינה", category: "תקשוב", location: "מחסן א׳", items: [
    ["סוללות AA (מארז)", 40, 0, 10], ["סוללות AAA (מארז)", 30, 0, 8], ["מטען סולארי", 6, 0, 2], ["סוללת גיבוי", 20, 0, 6],
  ] },
];

/** Initial content for an empty local database, in the normalized schema (see schema.js). */
export function buildSeed() {
  const snap = { crates: [], items: [], soldiers: [], assignments: [] };
  for (const { items, ...crate } of RAW) {
    snap.crates.push(crate);
    items.forEach(([name, total, faulty, min], n) => {
      snap.items.push({ id: `${crate.id}-i${n + 1}`, crateId: crate.id, name, total, faulty, min });
    });
  }
  return snap;
}
